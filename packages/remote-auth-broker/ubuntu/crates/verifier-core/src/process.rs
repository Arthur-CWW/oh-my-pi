use std::{
    fs::{self, OpenOptions},
    io::Read,
    os::unix::{
        ffi::OsStrExt,
        fs::{MetadataExt, OpenOptionsExt},
    },
    path::{Path, PathBuf},
};

use crate::{digest::sha256_reader, PeerCredentials, Result, VerifierError};

const MAX_PROC_FILE_BYTES: usize = 64 * 1024;
const MAX_EXECUTABLE_BYTES: u64 = 1024 * 1024 * 1024;
const DELETED_SUFFIX: &[u8] = b" (deleted)";

const MAX_SYSTEMD_SESSION_ID_BYTES: usize = 64;
const USER_SLICE_PREFIX: &[u8] = b"/user.slice/user-";
const SESSION_SCOPE_SEPARATOR: &[u8] = b".slice/session-";
const SESSION_SCOPE_SUFFIX: &[u8] = b".scope";

#[derive(Debug, Clone, PartialEq, Eq)]
enum CgroupExpectation {
    Exact(Vec<u8>),
    ExactOrUserSession {
        exact: Vec<u8>,
        allowed_uids: Option<(u32, Option<u32>)>,
    },
}

impl CgroupExpectation {
    fn exact(&self) -> &[u8] {
        match self {
            Self::Exact(exact) | Self::ExactOrUserSession { exact, .. } => exact,
        }
    }

    fn matches_worker(&self, actual: &[u8]) -> bool {
        match self {
            Self::Exact(exact) => actual == exact,
            Self::ExactOrUserSession {
                exact,
                allowed_uids,
            } => {
                actual == exact
                    || match (user_session_scope_uid(actual), *allowed_uids) {
                        (Some(_), None) => true,
                        (Some(uid), Some((primary, alternate))) => {
                            uid == primary || alternate == Some(uid)
                        }
                        (None, _) => false,
                    }
            }
        }
    }
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct ProcessExpectation {
    executable: Option<PathBuf>,
    sha256: Option<[u8; 32]>,
    cgroup: Option<CgroupExpectation>,
    direct_parent_executable: Option<PathBuf>,
    uniform_credentials: bool,
}

impl ProcessExpectation {
    pub const fn none() -> Self {
        Self {
            executable: None,
            sha256: None,
            cgroup: None,
            direct_parent_executable: None,
            uniform_credentials: false,
        }
    }

    pub fn with_executable(mut self, executable: impl Into<PathBuf>) -> Self {
        self.executable = Some(executable.into());
        self
    }

    pub const fn with_sha256(mut self, digest: [u8; 32]) -> Self {
        self.sha256 = Some(digest);
        self
    }

    pub fn with_cgroup(mut self, cgroup: impl AsRef<[u8]>) -> Self {
        self.cgroup = Some(CgroupExpectation::Exact(cgroup.as_ref().to_vec()));
        self
    }

    pub fn with_cgroup_or_any_user_session_scope(
        mut self,
        cgroup: impl AsRef<[u8]>,
    ) -> Self {
        self.cgroup = Some(CgroupExpectation::ExactOrUserSession {
            exact: cgroup.as_ref().to_vec(),
            allowed_uids: None,
        });
        self
    }

    pub fn with_cgroup_or_user_session_scopes(
        mut self,
        cgroup: impl AsRef<[u8]>,
        primary_uid: u32,
        alternate_uid: Option<u32>,
    ) -> Self {
        self.cgroup = Some(CgroupExpectation::ExactOrUserSession {
            exact: cgroup.as_ref().to_vec(),
            allowed_uids: Some((primary_uid, alternate_uid)),
        });
        self
    }

    pub fn with_direct_parent_executable(
        mut self,
        executable: impl Into<PathBuf>,
    ) -> Self {
        self.direct_parent_executable = Some(executable.into());
        self
    }

    pub const fn requiring_uniform_credentials(mut self) -> Self {
        self.uniform_credentials = true;
        self
    }

    pub fn executable(&self) -> Option<&Path> {
        self.executable.as_deref()
    }

    pub const fn sha256(&self) -> Option<&[u8; 32]> {
        self.sha256.as_ref()
    }

    pub fn cgroup(&self) -> Option<&[u8]> {
        self.cgroup.as_ref().map(CgroupExpectation::exact)
    }

    pub fn direct_parent_executable(&self) -> Option<&Path> {
        self.direct_parent_executable.as_deref()
    }

    pub const fn uniform_credentials_required(&self) -> bool {
        self.uniform_credentials
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProcessIdentity {
    pub pid: u32,
    pub uid: u32,
    pub gid: u32,
    pub start_time_ticks: u64,
    pub executable: PathBuf,
    pub executable_deleted: bool,
    pub executable_device: u64,
    pub executable_inode: u64,
    pub executable_sha256: [u8; 32],
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcessCredentials {
    uids: [u32; 4],
    gids: [u32; 4],
}

pub fn inspect_process(
    peer: PeerCredentials,
    expectation: &ProcessExpectation,
) -> Result<ProcessIdentity> {
    let proc_root = PathBuf::from(format!("/proc/{}", peer.pid));
    let stat_path = proc_root.join("stat");
    let status_path = proc_root.join("status");
    let cgroup_path = proc_root.join("cgroup");
    let executable_path = proc_root.join("exe");

    let stat_before = read_process_stat(&stat_path)?;
    if is_dead_process_state(stat_before.state) {
        return Err(VerifierError::ProcessUnavailable);
    }
    let credentials_before = read_process_credentials(&status_path)?;
    validate_peer_credentials(peer, credentials_before)?;
    if expectation.uniform_credentials
        && (credentials_before.uids != [peer.uid; 4]
            || credentials_before.gids != [peer.gid; 4])
    {
        return Err(VerifierError::ProcessMismatch);
    }
    validate_worker_cgroup(&cgroup_path, expectation.cgroup.as_ref())?;
    validate_direct_parent(stat_before.parent_pid, expectation)?;

    let executable = fs::read_link(&executable_path)
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    let executable_deleted = executable
        .as_os_str()
        .as_bytes()
        .ends_with(DELETED_SUFFIX);

    let mut executable_file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(&executable_path)
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    let executable_before = executable_file
        .metadata()
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    if !executable_before.is_file() {
        return Err(VerifierError::ProcessMismatch);
    }
    let executable_sha256 = sha256_reader(&mut executable_file, MAX_EXECUTABLE_BYTES)
        .map_err(|_| VerifierError::ProcessMismatch)?;
    let executable_after = executable_file
        .metadata()
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    if !same_executable(&executable_before, &executable_after) {
        return Err(VerifierError::ProcessMismatch);
    }

    validate_executable_expectation(
        &executable,
        executable_deleted,
        &executable_before,
        executable_sha256,
        expectation,
    )?;

    let credentials_after = read_process_credentials(&status_path)?;
    let stat_after = read_process_stat(&stat_path)?;
    if stat_before != stat_after
        || credentials_before != credentials_after
        || is_dead_process_state(stat_after.state)
    {
        return Err(VerifierError::ProcessMismatch);
    }
    validate_peer_credentials(peer, credentials_after)?;
    validate_worker_cgroup(&cgroup_path, expectation.cgroup.as_ref())?;
    validate_direct_parent(stat_after.parent_pid, expectation)?;

    Ok(ProcessIdentity {
        pid: peer.pid,
        uid: peer.uid,
        gid: peer.gid,
        start_time_ticks: stat_after.start_time_ticks,
        executable,
        executable_deleted,
        executable_device: executable_after.dev(),
        executable_inode: executable_after.ino(),
        executable_sha256,
    })
}

fn validate_executable_expectation(
    proc_executable: &Path,
    executable_deleted: bool,
    proc_metadata: &fs::Metadata,
    digest: [u8; 32],
    expectation: &ProcessExpectation,
) -> Result<()> {
    if let Some(expected_digest) = expectation.sha256 {
        if digest != expected_digest {
            return Err(VerifierError::ProcessMismatch);
        }
    }

    let Some(expected_path) = expectation.executable.as_deref() else {
        return Ok(());
    };
    if executable_deleted {
        return Err(VerifierError::ProcessMismatch);
    }
    let canonical = fs::canonicalize(expected_path).map_err(|_| VerifierError::ProcessMismatch)?;
    if proc_executable != canonical {
        return Err(VerifierError::ProcessMismatch);
    }
    let expected = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(&canonical)
        .and_then(|file| file.metadata())
        .map_err(|_| VerifierError::ProcessMismatch)?;
    if !expected.is_file()
        || expected.dev() != proc_metadata.dev()
        || expected.ino() != proc_metadata.ino()
    {
        return Err(VerifierError::ProcessMismatch);
    }
    Ok(())
}

fn same_executable(first: &fs::Metadata, second: &fs::Metadata) -> bool {
    first.dev() == second.dev()
        && first.ino() == second.ino()
        && first.size() == second.size()
        && first.mtime() == second.mtime()
        && first.mtime_nsec() == second.mtime_nsec()
        && first.ctime() == second.ctime()
        && first.ctime_nsec() == second.ctime_nsec()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct ProcessStat {
    state: u8,
    parent_pid: u32,
    start_time_ticks: u64,
}

fn validate_worker_cgroup(path: &Path, expected: Option<&CgroupExpectation>) -> Result<()> {
    validate_cgroup(path, expected, true)
}

fn validate_parent_cgroup(path: &Path, expected: Option<&CgroupExpectation>) -> Result<()> {
    validate_cgroup(path, expected, false)
}

fn validate_cgroup(
    path: &Path,
    expected: Option<&CgroupExpectation>,
    allow_user_session: bool,
) -> Result<()> {
    let Some(expected) = expected else {
        return Ok(());
    };
    let bytes = read_proc_file(path)?;
    let actual = single_cgroup_path(&bytes).ok_or(VerifierError::ProcessMismatch)?;
    let matches = if allow_user_session {
        expected.matches_worker(actual)
    } else {
        actual == expected.exact()
    };
    if !matches {
        return Err(VerifierError::ProcessMismatch);
    }
    Ok(())
}

fn single_cgroup_path(bytes: &[u8]) -> Option<&[u8]> {
    let line = bytes.strip_suffix(b"\n").unwrap_or(bytes);
    if line.is_empty() || line.contains(&b'\n') || line.contains(&b'\r') {
        return None;
    }
    line.strip_prefix(b"0::").filter(|path| !path.is_empty())
}

fn user_session_scope_uid(path: &[u8]) -> Option<u32> {
    let remainder = path.strip_prefix(USER_SLICE_PREFIX)?;
    let separator = remainder
        .windows(SESSION_SCOPE_SEPARATOR.len())
        .position(|window| window == SESSION_SCOPE_SEPARATOR)?;
    let uid_bytes = remainder.get(..separator)?;
    if uid_bytes.is_empty() || (uid_bytes.len() > 1 && uid_bytes[0] == b'0') {
        return None;
    }
    let uid = parse_u32(uid_bytes)?;
    let session = remainder
        .get(separator + SESSION_SCOPE_SEPARATOR.len()..)?
        .strip_suffix(SESSION_SCOPE_SUFFIX)?;
    if !(1..=MAX_SYSTEMD_SESSION_ID_BYTES).contains(&session.len())
        || !session.iter().all(u8::is_ascii_alphanumeric)
    {
        return None;
    }
    Some(uid)
}

fn validate_direct_parent(parent_pid: u32, expectation: &ProcessExpectation) -> Result<()> {
    let Some(expected_executable) = expectation.direct_parent_executable.as_deref() else {
        return Ok(());
    };
    if parent_pid <= 1 {
        return Err(VerifierError::ProcessMismatch);
    }
    let parent_root = PathBuf::from(format!("/proc/{parent_pid}"));
    let stat_path = parent_root.join("stat");
    let status_path = parent_root.join("status");
    let cgroup_path = parent_root.join("cgroup");
    let executable_path = parent_root.join("exe");
    let stat_before = read_process_stat(&stat_path)?;
    if is_dead_process_state(stat_before.state) {
        return Err(VerifierError::ProcessMismatch);
    }
    let credentials_before = read_process_credentials(&status_path)?;
    if credentials_before.uids != [0; 4] || credentials_before.gids != [0; 4] {
        return Err(VerifierError::ProcessMismatch);
    }
    validate_parent_cgroup(&cgroup_path, expectation.cgroup.as_ref())?;
    let executable = fs::read_link(&executable_path)
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    let metadata = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(&executable_path)
        .and_then(|file| file.metadata())
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    validate_executable_expectation(
        &executable,
        executable.as_os_str().as_bytes().ends_with(DELETED_SUFFIX),
        &metadata,
        [0; 32],
        &ProcessExpectation::none().with_executable(expected_executable),
    )?;
    let credentials_after = read_process_credentials(&status_path)?;
    let stat_after = read_process_stat(&stat_path)?;
    if stat_before != stat_after
        || credentials_before != credentials_after
        || is_dead_process_state(stat_after.state)
    {
        return Err(VerifierError::ProcessMismatch);
    }
    validate_parent_cgroup(&cgroup_path, expectation.cgroup.as_ref())?;
    Ok(())
}

fn read_process_stat(path: &Path) -> Result<ProcessStat> {
    let bytes = read_proc_file(path)?;
    let close = bytes
        .windows(2)
        .rposition(|window| window == b") ")
        .ok_or(VerifierError::ProcessUnavailable)?;
    let fields = bytes
        .get(close + 2..)
        .ok_or(VerifierError::ProcessUnavailable)?;
    let mut fields = fields.split(|byte| byte.is_ascii_whitespace());
    let state = fields
        .next()
        .filter(|value| value.len() == 1)
        .map(|value| value[0])
        .ok_or(VerifierError::ProcessUnavailable)?;
    let parent_pid = fields
        .next()
        .and_then(parse_u32)
        .ok_or(VerifierError::ProcessUnavailable)?;
    let start_time_ticks = fields
        .nth(17)
        .and_then(parse_u64)
        .ok_or(VerifierError::ProcessUnavailable)?;
    Ok(ProcessStat {
        state,
        parent_pid,
        start_time_ticks,
    })
}

fn read_process_credentials(path: &Path) -> Result<ProcessCredentials> {
    let bytes = read_proc_file(path)?;
    let text = std::str::from_utf8(&bytes).map_err(|_| VerifierError::ProcessUnavailable)?;
    let mut uids = None;
    let mut gids = None;
    for line in text.lines() {
        if let Some(values) = line.strip_prefix("Uid:") {
            uids = Some(parse_id_quad(values)?);
        } else if let Some(values) = line.strip_prefix("Gid:") {
            gids = Some(parse_id_quad(values)?);
        }
    }
    Ok(ProcessCredentials {
        uids: uids.ok_or(VerifierError::ProcessUnavailable)?,
        gids: gids.ok_or(VerifierError::ProcessUnavailable)?,
    })
}

fn parse_id_quad(values: &str) -> Result<[u32; 4]> {
    let mut parsed = [0_u32; 4];
    let mut fields = values.split_ascii_whitespace();
    for value in &mut parsed {
        *value = fields
            .next()
            .and_then(|field| field.parse::<u32>().ok())
            .ok_or(VerifierError::ProcessUnavailable)?;
    }
    if fields.next().is_some() {
        return Err(VerifierError::ProcessUnavailable);
    }
    Ok(parsed)
}

fn validate_peer_credentials(peer: PeerCredentials, process: ProcessCredentials) -> Result<()> {
    if process.uids[1] != peer.uid || process.gids[1] != peer.gid {
        Err(VerifierError::PeerMismatch)
    } else {
        Ok(())
    }
}

fn read_proc_file(path: &Path) -> Result<Vec<u8>> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC)
        .open(path)
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    let mut bytes = Vec::with_capacity(4096);
    file.by_ref()
        .take((MAX_PROC_FILE_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|_| VerifierError::ProcessUnavailable)?;
    if bytes.len() > MAX_PROC_FILE_BYTES {
        return Err(VerifierError::ProcessUnavailable);
    }
    Ok(bytes)
}

fn parse_u64(bytes: &[u8]) -> Option<u64> {
    if bytes.is_empty() {
        return None;
    }
    let mut value = 0_u64;
    for byte in bytes {
        if !byte.is_ascii_digit() {
            return None;
        }
        value = value.checked_mul(10)?.checked_add(u64::from(byte - b'0'))?;
    }
    Some(value)
}

fn parse_u32(bytes: &[u8]) -> Option<u32> {
    u32::try_from(parse_u64(bytes)?).ok()
}

fn is_dead_process_state(state: u8) -> bool {
    matches!(state, b'Z' | b'X' | b'x')
}

#[cfg(test)]
mod tests {
    use super::{
        single_cgroup_path, user_session_scope_uid, CgroupExpectation,
        MAX_SYSTEMD_SESSION_ID_BYTES,
    };

    #[test]
    fn accepts_observed_greeter_and_target_session_scopes() {
        assert_eq!(
            user_session_scope_uid(b"/user.slice/user-128.slice/session-c1.scope"),
            Some(128)
        );
        assert_eq!(
            user_session_scope_uid(b"/user.slice/user-1000.slice/session-42.scope"),
            Some(1000)
        );
    }

    #[test]
    fn rejects_noncanonical_or_unsafe_session_scopes() {
        let oversized = format!(
            "/user.slice/user-128.slice/session-{}.scope",
            "a".repeat(MAX_SYSTEMD_SESSION_ID_BYTES + 1)
        );
        for path in [
            b"/user.slice/user-0128.slice/session-c1.scope".as_slice(),
            b"/user.slice/user-4294967296.slice/session-c1.scope",
            b"/user.slice/user-128.slice/session-.scope",
            b"/user.slice/user-128.slice/session-c1/../../x.scope",
            b"/user.slice/user-128.slice/session-c1\x00.scope",
            b"/user.slice/user-128.slice/session-c1\n.scope",
            b"/user.slice/user-128.slice/session-c1.service",
            b"/system.slice/session-c1.scope",
            oversized.as_bytes(),
        ] {
            assert_eq!(user_session_scope_uid(path), None, "{path:?}");
        }
    }

    #[test]
    fn rejects_duplicate_mixed_and_malformed_cgroup_entries() {
        assert_eq!(
            single_cgroup_path(b"0::/user.slice/user-128.slice/session-c1.scope\n"),
            Some(b"/user.slice/user-128.slice/session-c1.scope".as_slice())
        );
        for entry in [
            b"0::/system.slice/gdm.service\n0::/user.slice/user-128.slice/session-c1.scope\n"
                .as_slice(),
            b"0::/system.slice/gdm.service\n0::/system.slice/gdm.service\n",
            b"0::/system.slice/gdm.service\n\n",
            b"1:name=/system.slice/gdm.service\n",
            b"0::/system.slice/gdm.service\r\n",
            b"0::\n",
        ] {
            assert_eq!(single_cgroup_path(entry), None, "{entry:?}");
        }
    }

    #[test]
    fn binds_session_scope_to_allowed_lifecycle_uids() {
        let any_session = CgroupExpectation::ExactOrUserSession {
            exact: b"/system.slice/gdm.service".to_vec(),
            allowed_uids: None,
        };
        assert!(any_session.matches_worker(b"/system.slice/gdm.service"));
        assert!(any_session.matches_worker(
            b"/user.slice/user-128.slice/session-c1.scope"
        ));
        assert!(any_session.matches_worker(
            b"/user.slice/user-1000.slice/session-2.scope"
        ));

        let claim_session = CgroupExpectation::ExactOrUserSession {
            exact: b"/system.slice/gdm.service".to_vec(),
            allowed_uids: Some((128, Some(1000))),
        };
        assert!(claim_session.matches_worker(b"/system.slice/gdm.service"));
        assert!(claim_session.matches_worker(
            b"/user.slice/user-128.slice/session-c1.scope"
        ));
        assert!(claim_session.matches_worker(
            b"/user.slice/user-1000.slice/session-2.scope"
        ));
        assert!(!claim_session.matches_worker(
            b"/user.slice/user-1001.slice/session-c1.scope"
        ));
        assert!(!claim_session.matches_worker(b"/system.slice/ssh.service"));
    }
}
