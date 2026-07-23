use std::collections::HashMap;

use remote_auth_broker_protocol::{sha256_hex, GdmChallenge, GdmClaim, PamService, ProtocolVersion, RemoteHost, Target};
use remote_auth_broker_verifier_core::{LockedSecret, ReplayContext, ReplayDomain, ReplayStore};

use crate::{error::{DaemonError, Result}, live::LiveSnapshot};

const MAX_LIFECYCLE_ENTRIES: usize = 64;
const LIFECYCLE_RETENTION_MS: u64 = 120_000;

#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum LifecycleStatus {
    Pending,
    Claimed,
    Succeeded,
    Expired,
    Failed,
}

#[derive(Debug)]
struct LifecycleEntry {
    nonce: String,
    issue_id: String,
    status: LifecycleStatus,
    expires_boottime_ms: u64,
    retain_until_boottime_ms: u64,
}

#[derive(Debug, Clone)]
struct IssuedChallenge {
    wire: GdmChallenge,
    context_digest: [u8; 32],
}

#[derive(Debug)]
pub struct PendingPassword {
    pub request_id: String,
    pub nonce: String,
    pub issue_id: String,
    pub sentinel_hash: String,
    pub username: String,
    pub uid: u32,
    pub pam_service: PamService,
    pub seat: String,
    pub tty: String,
    pub rhost: RemoteHost,
    pub greeter_generation: u64,
    pub controller_generation: u64,
    pub context_digest: [u8; 32],
    pub expires_boottime_ms: u64,
    pub password: LockedSecret,
}

impl PendingPassword {
    fn claim_matches(&self, claim: &GdmClaim) -> bool {
        self.request_id == claim.request_id
            && self.nonce == claim.nonce
            && self.issue_id == claim.issue_id
            && self.sentinel_hash == sha256_hex(claim.sentinel.as_bytes())
            && self.username == claim.username
            && self.uid == claim.uid
            && self.pam_service == claim.pam_service
            && self.seat == claim.seat
            && self.tty == claim.tty
            && self.rhost == claim.rhost
            && self.greeter_generation == claim.greeter_generation
            && self.controller_generation == claim.controller_generation
    }
}

#[derive(Debug)]
pub struct ConsumeMap<T> {
    entries: HashMap<String, T>,
}

impl<T> Default for ConsumeMap<T> {
    fn default() -> Self {
        Self {
            entries: HashMap::new(),
        }
    }
}

impl<T> ConsumeMap<T> {
    pub fn len(&self) -> usize { self.entries.len() }
    pub fn is_empty(&self) -> bool { self.entries.is_empty() }
    pub fn contains(&self, key: &str) -> bool { self.entries.contains_key(key) }
    pub fn get(&self, key: &str) -> Option<&T> { self.entries.get(key) }
    pub fn insert(&mut self, key: String, value: T) -> Option<T> { self.entries.insert(key, value) }
    pub fn consume(&mut self, key: &str) -> Option<T> { self.entries.remove(key) }
    pub fn retain(&mut self, keep: impl FnMut(&String, &mut T) -> bool) { self.entries.retain(keep); }
}

#[derive(Debug)]
pub struct PreparedEnvelope {
    pub challenge: GdmChallenge,
    pub body_digest: [u8; 32],
    pub pending: PendingPassword,
}

#[derive(Debug, Default)]
pub struct ServerState {
    challenges: HashMap<String, IssuedChallenge>,
    pending: ConsumeMap<PendingPassword>,
    lifecycles: HashMap<String, LifecycleEntry>,
    replay: ReplayStore,
}

impl ServerState {
    pub fn issue_challenge(
        &mut self,
        challenge_id: String,
        challenge_nonce: String,
        live: &LiveSnapshot,
        policy_digest: &str,
        now_boottime_ms: u64,
        lifetime_ms: u64,
        maximum_outstanding: usize,
    ) -> Result<GdmChallenge> {
        self.purge_expired(now_boottime_ms);
        if self.challenges.len() >= maximum_outstanding {
            return Err(DaemonError::Capacity);
        }
        let expires_boottime_ms = now_boottime_ms.checked_add(lifetime_ms).ok_or(DaemonError::Configuration)?;
        let wire = GdmChallenge {
            protocol_version: ProtocolVersion,
            challenge_id: challenge_id.clone(),
            challenge: challenge_nonce,
            boot_id: live.boot_id.clone(),
            issued_boottime_ms: now_boottime_ms,
            expires_boottime_ms,
            policy_digest: policy_digest.to_owned(),
        };
        remote_auth_broker_protocol::Validate::validate(&wire).map_err(DaemonError::Protocol)?;
        if self.challenges.insert(challenge_id, IssuedChallenge { wire: wire.clone(), context_digest: live.context_digest }).is_some() {
            return Err(DaemonError::Replay);
        }
        Ok(wire)
    }

    pub fn install_verified(&mut self, prepared: PreparedEnvelope, now_boottime_ms: u64, maximum_pending: usize) -> Result<()> {
        self.purge_expired(now_boottime_ms);
        if self.pending.len() >= maximum_pending || self.lifecycles.len() >= MAX_LIFECYCLE_ENTRIES {
            return Err(DaemonError::Capacity);
        }
        let issued = self.challenges.get(&prepared.challenge.challenge_id).ok_or(DaemonError::ChallengeInvalid)?;
        if issued.wire != prepared.challenge
            || issued.context_digest != prepared.pending.context_digest
            || now_boottime_ms < issued.wire.issued_boottime_ms
            || now_boottime_ms >= issued.wire.expires_boottime_ms
        {
            return Err(DaemonError::ChallengeInvalid);
        }
        let replay = ReplayContext {
            domain: ReplayDomain::GdmEnvelope,
            identifier: &prepared.pending.request_id,
            body_digest: prepared.body_digest,
            context_digest: prepared.pending.context_digest,
            expires_boottime_ms: prepared.pending.expires_boottime_ms,
        };
        self.replay.record_once(replay, now_boottime_ms)?;
        self.challenges.remove(&prepared.challenge.challenge_id);
        let key = prepared.pending.request_id.clone();
        let lifecycle = LifecycleEntry {
            nonce: prepared.pending.nonce.clone(),
            issue_id: prepared.pending.issue_id.clone(),
            status: LifecycleStatus::Pending,
            expires_boottime_ms: prepared.pending.expires_boottime_ms,
            retain_until_boottime_ms: prepared.pending.expires_boottime_ms
                .saturating_add(LIFECYCLE_RETENTION_MS),
        };
        if self.pending.insert(key.clone(), prepared.pending).is_some()
            || self.lifecycles.insert(key, lifecycle).is_some()
        {
            return Err(DaemonError::Replay);
        }
        Ok(())
    }

    pub fn claim(
        &mut self,
        claim: &GdmClaim,
        body_digest: [u8; 32],
        live: &LiveSnapshot,
        now_boottime_ms: u64,
    ) -> Result<LockedSecret> {
        self.replay.purge_expired(now_boottime_ms);
        let claim_replay = ReplayContext {
            domain: ReplayDomain::GdmClaim,
            identifier: &claim.request_id,
            body_digest,
            context_digest: live.context_digest,
            expires_boottime_ms: now_boottime_ms.saturating_add(1),
        };
        let Some(pending) = self.pending.get(&claim.request_id) else {
            self.replay.ensure_unseen(&claim_replay, now_boottime_ms)?;
            return Err(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected));
        };
        if now_boottime_ms >= pending.expires_boottime_ms {
            self.pending.consume(&claim.request_id);
            return Err(DaemonError::Expired);
        }
        if pending.context_digest != live.context_digest {
            return Err(DaemonError::PolicyMismatch);
        }
        if !pending.claim_matches(claim) {
            return Err(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected));
        }

        let claim_replay = ReplayContext {
            expires_boottime_ms: pending.expires_boottime_ms,
            ..claim_replay
        };
        self.replay.record_once(claim_replay, now_boottime_ms)?;
        let pending = self.pending
            .consume(&claim.request_id)
            .ok_or(DaemonError::Replay)?;
        let lifecycle = self.lifecycles
            .get_mut(&claim.request_id)
            .ok_or(DaemonError::Integrity)?;
        if lifecycle.status != LifecycleStatus::Pending
            || lifecycle.issue_id != claim.issue_id
            || lifecycle.nonce != claim.nonce
        {
            return Err(DaemonError::Integrity);
        }
        lifecycle.status = LifecycleStatus::Claimed;
        Ok(pending.password)
    }

    pub fn mark_claim_failed(
        &mut self,
        request_id: &str,
        issue_id: &str,
        nonce: &str,
        now_boottime_ms: u64,
    ) -> Result<()> {
        self.purge_expired(now_boottime_ms);
        let lifecycle = self.lifecycle_mut(request_id, issue_id, nonce)?;
        if lifecycle.status != LifecycleStatus::Claimed {
            return Err(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected));
        }
        lifecycle.status = LifecycleStatus::Failed;
        Ok(())
    }

    pub fn acknowledge_success(
        &mut self,
        request_id: &str,
        issue_id: &str,
        nonce: &str,
        now_boottime_ms: u64,
    ) -> Result<LifecycleStatus> {
        self.purge_expired(now_boottime_ms);
        let lifecycle = self.lifecycle_mut(request_id, issue_id, nonce)?;
        match lifecycle.status {
            LifecycleStatus::Claimed => {
                lifecycle.status = LifecycleStatus::Succeeded;
                Ok(lifecycle.status)
            }
            LifecycleStatus::Succeeded => Ok(lifecycle.status),
            _ => Err(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected)),
        }
    }

    pub fn status(
        &mut self,
        request_id: &str,
        issue_id: &str,
        nonce: &str,
        now_boottime_ms: u64,
    ) -> Result<LifecycleStatus> {
        self.purge_expired(now_boottime_ms);
        Ok(self.lifecycle_mut(request_id, issue_id, nonce)?.status)
    }

    fn lifecycle_mut(
        &mut self,
        request_id: &str,
        issue_id: &str,
        nonce: &str,
    ) -> Result<&mut LifecycleEntry> {
        let lifecycle = self.lifecycles
            .get_mut(request_id)
            .ok_or(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected))?;
        if lifecycle.issue_id != issue_id || lifecycle.nonce != nonce {
            return Err(DaemonError::Protocol(remote_auth_broker_protocol::PublicError::ClaimRejected));
        }
        Ok(lifecycle)
    }

    fn purge_expired(&mut self, now_boottime_ms: u64) {
        self.challenges.retain(|_, challenge| challenge.wire.expires_boottime_ms > now_boottime_ms);
        self.pending.retain(|_, pending| pending.expires_boottime_ms > now_boottime_ms);
        self.lifecycles.retain(|_, lifecycle| {
            if now_boottime_ms >= lifecycle.expires_boottime_ms
                && matches!(lifecycle.status, LifecycleStatus::Pending | LifecycleStatus::Claimed)
            {
                lifecycle.status = LifecycleStatus::Expired;
            }
            now_boottime_ms < lifecycle.retain_until_boottime_ms
        });
        self.replay.purge_expired(now_boottime_ms);
    }
}

pub fn pending_from_target(
    request_id: String,
    nonce: String,
    issue_id: String,
    sentinel_hash: String,
    target: &Target,
    context_digest: [u8; 32],
    expires_boottime_ms: u64,
    password: LockedSecret,
) -> Result<PendingPassword> {
    let Target::Gdm { username, uid, pam_service, seat, tty, rhost, greeter_generation, controller_generation, .. } = target else {
        return Err(DaemonError::TargetMismatch);
    };
    Ok(PendingPassword {
        request_id, nonce, issue_id, sentinel_hash,
        username: username.clone(), uid: *uid, pam_service: *pam_service,
        seat: seat.clone(), tty: tty.clone(), rhost: *rhost,
        greeter_generation: *greeter_generation, controller_generation: *controller_generation,
        context_digest, expires_boottime_ms, password,
    })
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{Arc, Mutex},
        thread,
    };

    use super::{ConsumeMap, LifecycleEntry, LifecycleStatus, ServerState};

    #[test]
    fn consume_is_atomic_across_contenders() {
        let values = Arc::new(Mutex::new(ConsumeMap::default()));
        values.lock().unwrap().insert("request".to_owned(), 7_u8);
        let mut threads = Vec::new();
        for _ in 0..16 {
            let values = Arc::clone(&values);
            threads.push(thread::spawn(move || {
                values.lock().unwrap().consume("request")
            }));
        }
        let winners = threads.into_iter().filter_map(|thread| thread.join().unwrap()).collect::<Vec<_>>();
        assert_eq!(winners, vec![7]);
        assert!(values.lock().unwrap().is_empty());
    }

    fn lifecycle(status: LifecycleStatus) -> LifecycleEntry {
        LifecycleEntry {
            nonce: "nonce".to_owned(),
            issue_id: "issue".to_owned(),
            status,
            expires_boottime_ms: 100,
            retain_until_boottime_ms: 200,
        }
    }

    #[test]
    fn success_requires_claim_then_acknowledgement() {
        let mut state = ServerState::default();
        state.lifecycles.insert("request".to_owned(), lifecycle(LifecycleStatus::Pending));
        assert!(state.acknowledge_success("request", "issue", "nonce", 50).is_err());

        state.lifecycles.get_mut("request").unwrap().status = LifecycleStatus::Claimed;
        assert_eq!(
            state.acknowledge_success("request", "issue", "nonce", 50),
            Ok(LifecycleStatus::Succeeded)
        );
        assert_eq!(
            state.status("request", "issue", "nonce", 100),
            Ok(LifecycleStatus::Succeeded)
        );
    }

    #[test]
    fn claimed_without_clear_expires_and_cannot_later_succeed() {
        let mut state = ServerState::default();
        state.lifecycles.insert("request".to_owned(), lifecycle(LifecycleStatus::Claimed));
        assert_eq!(
            state.status("request", "issue", "nonce", 100),
            Ok(LifecycleStatus::Expired)
        );
        assert!(state.acknowledge_success("request", "issue", "nonce", 101).is_err());
    }

    #[test]
    fn failed_claim_is_terminal_and_never_successful() {
        let mut state = ServerState::default();
        state.lifecycles.insert("request".to_owned(), lifecycle(LifecycleStatus::Claimed));
        assert_eq!(state.mark_claim_failed("request", "issue", "nonce", 50), Ok(()));
        assert_eq!(
            state.status("request", "issue", "nonce", 50),
            Ok(LifecycleStatus::Failed)
        );
        assert!(state.acknowledge_success("request", "issue", "nonce", 50).is_err());
    }
}
