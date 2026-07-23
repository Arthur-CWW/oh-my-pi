#![deny(unsafe_op_in_unsafe_fn)]

mod digest;
mod error;
mod framing;
mod peer;
mod process;
mod public_reply;
mod replay;
mod secret;
mod secure_file;
mod socket;
mod time;

pub use digest::{sha256_bytes, sha256_file};
pub use error::{Result, VerifierError};
pub use framing::{FrameIo, FrameTimeouts};
pub use peer::{peer_credentials, PeerCredentials};
pub use process::{inspect_process, ProcessExpectation, ProcessIdentity};
pub use public_reply::{encode_inactive_status, inactive_status};
pub use replay::{ReplayContext, ReplayDomain, ReplayStore};
pub use secret::LockedSecret;
pub use secure_file::{
    load_boot_id, load_boot_id_from, load_config_file, load_controller_live_state,
    load_domain_file, load_greeter_live_state, load_key_file, load_machine_id,
    load_machine_id_from, load_policy_file, load_root_owned_file, FileMode, LoadedFile,
    BOOT_ID_PATH, CONFIG_ROOT, MACHINE_ID_PATH, RUNTIME_ROOT, STATE_ROOT,
};
pub use socket::{bind_unix_listener, BoundUnixListener, UnixListenerSpec};
pub use time::boottime_millis;
