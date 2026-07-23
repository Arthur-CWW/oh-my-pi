use std::collections::{hash_map::Entry, HashMap};

use crate::{Result, VerifierError};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub enum ReplayDomain {
    GdmChallenge,
    GdmEnvelope,
    GdmClaim,
    SudoRequest,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ReplayContext<'a> {
    pub domain: ReplayDomain,
    pub identifier: &'a str,
    pub body_digest: [u8; 32],
    pub context_digest: [u8; 32],
    pub expires_boottime_ms: u64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ReplayRecord {
    body_digest: [u8; 32],
    context_digest: [u8; 32],
    expires_boottime_ms: u64,
}

#[derive(Debug, Default)]
pub struct ReplayStore {
    records: HashMap<(ReplayDomain, String), ReplayRecord>,
}

impl ReplayStore {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn len(&self) -> usize {
        self.records.len()
    }

    pub fn is_empty(&self) -> bool {
        self.records.is_empty()
    }

    pub fn ensure_unseen(
        &mut self,
        context: &ReplayContext<'_>,
        now_boottime_ms: u64,
    ) -> Result<()> {
        self.purge_expired(now_boottime_ms);
        let key = (context.domain, context.identifier.to_owned());
        match self.records.get(&key) {
            Some(existing) => classify(existing, context),
            None => Ok(()),
        }
    }

    /// Records an accepted request exactly once. Existing identifiers are never
    /// replaced: identical content is a replay, differing content is a body
    /// conflict, and a changed trusted context is reported separately.
    pub fn record_once(&mut self, context: ReplayContext<'_>, now_boottime_ms: u64) -> Result<()> {
        self.purge_expired(now_boottime_ms);
        if context.identifier.is_empty() || context.expires_boottime_ms <= now_boottime_ms {
            return Err(VerifierError::InvalidConfiguration);
        }

        let key = (context.domain, context.identifier.to_owned());
        match self.records.entry(key) {
            Entry::Vacant(entry) => {
                entry.insert(ReplayRecord {
                    body_digest: context.body_digest,
                    context_digest: context.context_digest,
                    expires_boottime_ms: context.expires_boottime_ms,
                });
                Ok(())
            }
            Entry::Occupied(entry) => classify(entry.get(), &context),
        }
    }

    pub fn purge_expired(&mut self, now_boottime_ms: u64) {
        self.records
            .retain(|_, record| record.expires_boottime_ms > now_boottime_ms);
    }
}

fn classify(existing: &ReplayRecord, context: &ReplayContext<'_>) -> Result<()> {
    if existing.body_digest != context.body_digest {
        Err(VerifierError::BodyConflict)
    } else if existing.context_digest != context.context_digest {
        Err(VerifierError::ContextChanged)
    } else {
        Err(VerifierError::Replay)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn context<'a>(identifier: &'a str, body: u8, trusted: u8) -> ReplayContext<'a> {
        ReplayContext {
            domain: ReplayDomain::GdmEnvelope,
            identifier,
            body_digest: [body; 32],
            context_digest: [trusted; 32],
            expires_boottime_ms: 200,
        }
    }

    #[test]
    fn distinguishes_replay_body_conflict_and_context_change() {
        let mut store = ReplayStore::new();
        store.record_once(context("request", 1, 2), 100).unwrap();
        assert_eq!(store.record_once(context("request", 1, 2), 100), Err(VerifierError::Replay));
        assert_eq!(store.record_once(context("request", 3, 2), 100), Err(VerifierError::BodyConflict));
        assert_eq!(store.record_once(context("request", 1, 4), 100), Err(VerifierError::ContextChanged));
    }

    #[test]
    fn expired_records_are_forgotten_without_weakening_live_records() {
        let mut store = ReplayStore::new();
        store.record_once(context("request", 1, 2), 100).unwrap();
        store.record_once(
            ReplayContext {
                expires_boottime_ms: 300,
                ..context("request", 1, 2)
            },
            200,
        )
        .unwrap();
        assert_eq!(store.len(), 1);
    }

    #[test]
    fn refuses_to_record_already_expired_input() {
        let mut store = ReplayStore::new();
        assert_eq!(store.record_once(context("request", 1, 2), 200), Err(VerifierError::InvalidConfiguration));
        assert!(store.is_empty());
    }
}
