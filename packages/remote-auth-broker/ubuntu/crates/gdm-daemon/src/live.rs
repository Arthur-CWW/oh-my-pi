use remote_auth_broker_protocol::{ExecutionRequest, PamService, RemoteHost, Target};
use remote_auth_broker_verifier_core::{
    load_boot_id_from, load_controller_live_state, load_greeter_live_state, load_machine_id_from,
    sha256_bytes,
};
use serde::Deserialize;

use crate::{config::Config, error::{DaemonError, Result}};

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct GreeterLiveState {
    schema_version: u32,
    username: String,
    uid: u32,
    pam_service: PamService,
    seat: String,
    tty: String,
    rhost: RemoteHost,
    generation: u64,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ControllerLiveState {
    schema_version: u32,
    jetkvm_device_id: String,
    generation: u64,
    ssh_host_key_digest: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct LiveSnapshot {
    pub machine_id: String,
    pub boot_id: String,
    pub username: String,
    pub uid: u32,
    pub pam_service: PamService,
    pub seat: String,
    pub tty: String,
    pub rhost: RemoteHost,
    pub greeter_generation: u64,
    pub jetkvm_device_id: String,
    pub controller_generation: u64,
    pub ssh_host_key_digest: String,
    pub context_digest: [u8; 32],
}

impl LiveSnapshot {
    pub fn load(config: &Config) -> Result<Self> {
        let machine_id = load_machine_id_from(&config.machine_id_path).map_err(|_| DaemonError::Integrity)?;
        let boot_id = load_boot_id_from(&config.boot_id_path).map_err(|_| DaemonError::Integrity)?;
        let greeter_file = load_greeter_live_state(&config.greeter_state_path).map_err(|_| DaemonError::Integrity)?;
        let controller_file = load_controller_live_state(&config.controller_state_path).map_err(|_| DaemonError::Integrity)?;
        let greeter: GreeterLiveState = serde_json::from_slice(greeter_file.as_bytes()).map_err(|_| DaemonError::Integrity)?;
        let controller: ControllerLiveState = serde_json::from_slice(controller_file.as_bytes()).map_err(|_| DaemonError::Integrity)?;

        if greeter.schema_version != 1
            || controller.schema_version != 1
            || greeter.generation == 0
            || controller.generation == 0
            || !valid_text(&greeter.username)
            || !valid_text(&greeter.seat)
            || !valid_text(&greeter.tty)
            || !valid_text(&controller.jetkvm_device_id)
            || controller.ssh_host_key_digest != config.ssh_host_key_digest
            || !config.user_is_allowed(&greeter.username, greeter.uid)
        {
            return Err(DaemonError::TargetMismatch);
        }

        let context_digest = context_digest(
            &machine_id,
            &boot_id,
            greeter_file.digest(),
            controller_file.digest(),
            &config.policy_digest,
        );
        Ok(Self {
            machine_id,
            boot_id,
            username: greeter.username,
            uid: greeter.uid,
            pam_service: greeter.pam_service,
            seat: greeter.seat,
            tty: greeter.tty,
            rhost: greeter.rhost,
            greeter_generation: greeter.generation,
            jetkvm_device_id: controller.jetkvm_device_id,
            controller_generation: controller.generation,
            ssh_host_key_digest: controller.ssh_host_key_digest,
            context_digest,
        })
    }

    pub fn validate_request(&self, request: &ExecutionRequest) -> Result<()> {
        let Target::Gdm {
            ssh_host_key_digest,
            machine_id,
            boot_id,
            username,
            uid,
            pam_service,
            seat,
            tty,
            rhost,
            greeter_generation,
            jetkvm_device_id,
            controller_generation,
        } = &request.target else {
            return Err(DaemonError::TargetMismatch);
        };

        if ssh_host_key_digest != &self.ssh_host_key_digest
            || machine_id != &self.machine_id
            || boot_id != &self.boot_id
            || username != &self.username
            || uid != &self.uid
            || pam_service != &self.pam_service
            || seat != &self.seat
            || tty != &self.tty
            || rhost != &self.rhost
            || greeter_generation != &self.greeter_generation
            || jetkvm_device_id != &self.jetkvm_device_id
            || controller_generation != &self.controller_generation
        {
            return Err(DaemonError::TargetMismatch);
        }
        Ok(())
    }
}

fn context_digest(
    machine_id: &str,
    boot_id: &str,
    greeter_digest: &[u8; 32],
    controller_digest: &[u8; 32],
    policy_digest: &str,
) -> [u8; 32] {
    let mut bytes = Vec::with_capacity(machine_id.len() + boot_id.len() + policy_digest.len() + 66);
    bytes.extend_from_slice(machine_id.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(boot_id.as_bytes());
    bytes.push(0);
    bytes.extend_from_slice(greeter_digest);
    bytes.extend_from_slice(controller_digest);
    bytes.extend_from_slice(policy_digest.as_bytes());
    sha256_bytes(&bytes)
}

fn valid_text(value: &str) -> bool {
    !value.is_empty() && value.chars().count() <= 256 && !value.chars().any(char::is_control)
}

#[cfg(test)]
mod tests {
    use super::*;
    use remote_auth_broker_protocol::{
        AuthorizationMode, Domain, Operation, Principal, ProtocolVersion,
    };

    fn snapshot() -> LiveSnapshot {
        LiveSnapshot {
            machine_id: "machine".into(),
            boot_id: "boot".into(),
            username: "arthur".into(),
            uid: 1000,
            pam_service: PamService::GdmPassword,
            seat: "seat0".into(),
            tty: "/dev/tty1".into(),
            rhost: RemoteHost::Empty,
            greeter_generation: 7,
            jetkvm_device_id: "jetkvm".into(),
            controller_generation: 11,
            ssh_host_key_digest: "1".repeat(64),
            context_digest: [3; 32],
        }
    }

    fn request() -> ExecutionRequest {
        let live = snapshot();
        ExecutionRequest {
            protocol_version: ProtocolVersion,
            request_id: "AAECAwQFBgcICQoLDA0ODw".into(),
            nonce: "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8".into(),
            created_at: 100,
            expires_at: 1100,
            principal: Principal {
                session_id: "session".into(), owner_epoch: "00112233-4455-4677-8899-aabbccddeeff".into(),
                pid: 2, uid: 501, code_identity: "authority".into(), build_digest: "2".repeat(64),
                runner_instance_identity: "runner".into(),
                ownership_socket_path: format!("/tmp/owners-v1/{}/claim/owner.sock", "3".repeat(64)),
            },
            authorization_mode_requested: AuthorizationMode::BiometricOneShot,
            domain: Domain::DesktopBrowser,
            operation: Operation::GdmLogin,
            target: Target::Gdm {
                ssh_host_key_digest: live.ssh_host_key_digest, machine_id: live.machine_id,
                boot_id: live.boot_id, username: live.username, uid: live.uid,
                pam_service: live.pam_service, seat: live.seat, tty: live.tty, rhost: live.rhost,
                greeter_generation: live.greeter_generation, jetkvm_device_id: live.jetkvm_device_id,
                controller_generation: live.controller_generation,
            },
            purpose: "fixture".into(),
            grant_id: None,
        }
    }

    #[test]
    fn exact_live_binding_is_required() {
        let live = snapshot();
        assert_eq!(live.validate_request(&request()), Ok(()));
        let mut wrong = request();
        if let Target::Gdm { controller_generation, .. } = &mut wrong.target {
            *controller_generation += 1;
        }
        assert_eq!(live.validate_request(&wrong), Err(DaemonError::TargetMismatch));
    }
}
