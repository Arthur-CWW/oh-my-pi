#![deny(unsafe_op_in_unsafe_fn)]

#[cfg(all(
    feature = "pam-module",
    target_os = "linux",
    target_arch = "x86_64"
))]
mod pam_module {
mod ffi {
    use std::ffi::{c_char, c_int, c_void};
    use std::mem::{align_of, size_of};

    /// Linux-PAM's `pam_handle_t` is an incomplete C type. Only pointers to it
    /// cross this boundary; the module never constructs, dereferences, or owns
    /// a handle.
    #[repr(C)]
    pub(crate) struct PamHandle {
        _private: [u8; 0],
    }

    pub(super) type PamDataCleanup =
        unsafe extern "C" fn(*mut PamHandle, *mut c_void, c_int);
    pub(super) type PamModuleEntry =
        extern "C" fn(*mut PamHandle, c_int, c_int, *const *const c_char) -> c_int;

    // Ubuntu 24.04's Linux-PAM 1.5.3 public headers.
    pub(super) const PAM_SUCCESS: c_int = 0;
    pub(super) const PAM_IGNORE: c_int = 25;
    pub(super) const PAM_SERVICE: c_int = 1;
    pub(super) const PAM_USER: c_int = 2;
    pub(super) const PAM_TTY: c_int = 3;
    pub(super) const PAM_RHOST: c_int = 4;
    pub(super) const PAM_AUTHTOK: c_int = 6;

    // `pam_get_item`, `pam_get_authtok`, and `pam_get_data` lend PAM-owned
    // pointers. `pam_set_item` copies its item; successful `pam_set_data`
    // transfers cleanup responsibility for its data pointer to PAM.
    #[link(name = "pam")]
    extern "C" {
        pub(super) fn pam_get_item(
            pamh: *const PamHandle,
            item_type: c_int,
            item: *mut *const c_void,
        ) -> c_int;
        pub(super) fn pam_set_item(
            pamh: *mut PamHandle,
            item_type: c_int,
            item: *const c_void,
        ) -> c_int;
        pub(super) fn pam_get_authtok(
            pamh: *mut PamHandle,
            item: c_int,
            authtok: *mut *const c_char,
            prompt: *const c_char,
        ) -> c_int;
        pub(super) fn pam_set_data(
            pamh: *mut PamHandle,
            module_data_name: *const c_char,
            data: *mut c_void,
            cleanup: Option<PamDataCleanup>,
        ) -> c_int;
        pub(super) fn pam_get_data(
            pamh: *const PamHandle,
            module_data_name: *const c_char,
            data: *mut *const c_void,
        ) -> c_int;
    }

    // Rust's platform C types and nullable function-pointer representation
    // provide the header ABI without generated bindings.
    const _: () = {
        assert!(size_of::<c_int>() == 4);
        assert!(align_of::<c_int>() == 4);
        assert!(size_of::<*mut PamHandle>() == size_of::<*mut c_void>());
        assert!(align_of::<*mut PamHandle>() == align_of::<*mut c_void>());
        assert!(size_of::<Option<PamDataCleanup>>() == size_of::<*mut c_void>());
    };
    const _: unsafe extern "C" fn(
        *const PamHandle,
        c_int,
        *mut *const c_void,
    ) -> c_int = pam_get_item;
    const _: unsafe extern "C" fn(*mut PamHandle, c_int, *const c_void) -> c_int =
        pam_set_item;
    const _: unsafe extern "C" fn(
        *mut PamHandle,
        c_int,
        *mut *const c_char,
        *const c_char,
    ) -> c_int = pam_get_authtok;
    const _: unsafe extern "C" fn(
        *mut PamHandle,
        *const c_char,
        *mut c_void,
        Option<PamDataCleanup>,
    ) -> c_int = pam_set_data;
    const _: unsafe extern "C" fn(
        *const PamHandle,
        *const c_char,
        *mut *const c_void,
    ) -> c_int = pam_get_data;
}

use super::{parse_option_values, sentinel_matches_hash, with_sentinel, Mode};

use std::ffi::{c_char, c_int, c_void, CString};
use std::fs::OpenOptions;
use std::io::{self, Read};
use std::mem::{self, MaybeUninit};
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::fs::{MetadataExt, OpenOptionsExt};
use std::os::unix::net::UnixStream;
use std::panic::{self, AssertUnwindSafe};
use std::ptr::{self, NonNull};
use std::sync::atomic::{compiler_fence, Ordering};
use std::time::{Duration, Instant};

use remote_auth_broker_protocol::{
    decode_frame_payload, encode_gdm_claim_frame, GdmClaim, PamService, ProtocolVersion,
    RemoteHost, Validate,
};
use remote_auth_broker_verifier_core::{peer_credentials, FrameIo, FrameTimeouts};
use serde::{de::DeserializeOwned, Deserialize, Serialize};
use zeroize::Zeroize;

const CLAIM_SOCKET: &[u8] = b"/run/remote-auth-broker/gdm/gdm-claim.sock";
const CLAIM_CONTEXT_PATH: &str = "/run/remote-auth-broker/gdm/claim-context.json";
const INJECTED_DATA_NAME: &[u8] = b"remote-auth-broker.gdm.injected\0";

const MAX_REQUEST_ID_BYTES: usize = 64;
const MAX_ISSUE_ID_BYTES: usize = 86;
const NONCE_BYTES: usize = 43;
const MAX_ACK_REPLY_BYTES: usize = 512;
const PAM_SUCCESS_CODE: c_int = ffi::PAM_SUCCESS;
const PAM_IGNORE_CODE: c_int = ffi::PAM_IGNORE;
const MAX_OPTION_BYTES: usize = 128;
const MAX_PAM_ITEM_BYTES: usize = 256;
const MAX_SENTINEL_BYTES: usize = 57;
const MAX_CONTEXT_BYTES: usize = 4096;
const MAX_PASSWORD_BYTES: usize = 4096;
const CONNECT_TIMEOUT: Duration = Duration::from_millis(250);
const IO_TIMEOUT: Duration = Duration::from_millis(500);
const FLAG_VALUE: u8 = 0xa5;

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct ClaimContext {
    schema_version: u8,
    request_id: String,
    nonce: String,
    issue_id: String,
    sentinel_hash: String,
    uid: u32,
    seat: String,
    greeter_generation: u64,
    controller_generation: u64,
}

#[derive(Clone, Copy)]
#[repr(C)]
struct InjectedIdentity {
    marker: u8,
    request_id_length: u8,
    issue_id_length: u8,
    request_id: [u8; MAX_REQUEST_ID_BYTES],
    issue_id: [u8; MAX_ISSUE_ID_BYTES],
    nonce: [u8; NONCE_BYTES],
}

impl InjectedIdentity {
    fn from_claim(claim: &GdmClaim) -> Option<Self> {
        claim.validate().ok()?;
        let request_id_length = u8::try_from(claim.request_id.len()).ok()?;
        let issue_id_length = u8::try_from(claim.issue_id.len()).ok()?;
        let mut identity = Self {
            marker: FLAG_VALUE,
            request_id_length,
            issue_id_length,
            request_id: [0; MAX_REQUEST_ID_BYTES],
            issue_id: [0; MAX_ISSUE_ID_BYTES],
            nonce: [0; NONCE_BYTES],
        };
        identity.request_id.get_mut(..claim.request_id.len())?
            .copy_from_slice(claim.request_id.as_bytes());
        identity.issue_id.get_mut(..claim.issue_id.len())?
            .copy_from_slice(claim.issue_id.as_bytes());
        identity.nonce.copy_from_slice(claim.nonce.as_bytes());
        Some(identity)
    }

    fn request_id(&self) -> Option<&str> {
        std::str::from_utf8(self.request_id.get(..usize::from(self.request_id_length))?).ok()
    }

    fn issue_id(&self) -> Option<&str> {
        std::str::from_utf8(self.issue_id.get(..usize::from(self.issue_id_length))?).ok()
    }

    fn nonce(&self) -> Option<&str> {
        std::str::from_utf8(&self.nonce).ok()
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct SuccessAcknowledgement<'a> {
    protocol_version: u8,
    action: &'static str,
    request_id: &'a str,
    issue_id: &'a str,
    nonce: &'a str,
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields, rename_all = "camelCase")]
struct SuccessReply {
    protocol_version: ProtocolVersion,
    request_id: String,
    issue_id: String,
    state: SuccessState,
}

#[derive(Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
enum SuccessState {
    Succeeded,
}

/// The exported functions are the only PAM ABI boundary. Raw PAM pointers are
/// inspected only by the small helpers below, and no borrowed PAM pointer is
/// retained after an exported call returns.
#[no_mangle]
pub extern "C" fn pam_sm_authenticate(
    pamh: *mut ffi::PamHandle,
    _flags: c_int,
    argc: c_int,
    argv: *const *const c_char,
) -> c_int {
    let _ = panic::catch_unwind(AssertUnwindSafe(|| {
        if pamh.is_null() {
            return;
        }
        let Some(mode) = (unsafe { parse_options(argc, argv) }) else {
            return;
        };
        match mode {
            Mode::Inject => inject(pamh),
            Mode::Clear => clear(pamh),
        }
    }));
    PAM_IGNORE_CODE
}

#[no_mangle]
pub extern "C" fn pam_sm_setcred(
    _pamh: *mut ffi::PamHandle,
    _flags: c_int,
    _argc: c_int,
    _argv: *const *const c_char,
) -> c_int {
    PAM_IGNORE_CODE
}

const _: ffi::PamModuleEntry = pam_sm_authenticate;
const _: ffi::PamModuleEntry = pam_sm_setcred;

fn inject(pamh: *mut ffi::PamHandle) {
    // pam_get_authtok is deliberately called once and only once in inject mode.
    // PAM owns the returned pointer, so copy the validated nonsecret sentinel
    // before any later PAM call can replace or release that storage.
    let Some(sentinel) = (unsafe { get_sentinel_once(pamh) }) else {
        return;
    };
    inject_sentinel(pamh, sentinel);
}

fn inject_sentinel(pamh: *mut ffi::PamHandle, sentinel: String) {
    let Some(context) = load_claim_context() else {
        return;
    };
    if context.schema_version != 1
        || !sentinel_matches_hash(&sentinel, &context.sentinel_hash)
    {
        return;
    }

    let Some(username) = (unsafe { required_pam_item(pamh, ffi::PAM_USER) }) else {
        return;
    };
    let Some(service) = (unsafe { required_pam_item(pamh, ffi::PAM_SERVICE) }) else {
        return;
    };
    if service.as_bytes() != b"gdm-password" {
        return;
    }
    let Some(tty) = (unsafe { required_pam_item(pamh, ffi::PAM_TTY) }) else {
        return;
    };
    let Some(rhost) = (unsafe { live_rhost(pamh) }) else {
        return;
    };
    let Some(uid) = lookup_uid(&username) else {
        return;
    };
    if uid != context.uid {
        return;
    }

    let claim = GdmClaim {
        protocol_version: ProtocolVersion,
        request_id: context.request_id,
        nonce: context.nonce,
        issue_id: context.issue_id,
        sentinel,
        username,
        uid,
        pam_service: PamService::GdmPassword,
        seat: context.seat,
        tty,
        rhost,
        greeter_generation: context.greeter_generation,
        controller_generation: context.controller_generation,
    };
    let Some(identity) = InjectedIdentity::from_claim(&claim) else {
        return;
    };
    let Ok(frame) = encode_gdm_claim_frame(&claim) else {
        return;
    };
    let Some(secret) = claim_password(&frame) else {
        return;
    };

    // pam_set_item copies the NUL-terminated token into PAM-owned storage. The
    // mmap-backed receive buffer remains locked and nondumpable until Drop.
    let set_result = unsafe {
        ffi::pam_set_item(
            pamh,
            ffi::PAM_AUTHTOK,
            secret.as_c_ptr().cast::<c_void>(),
        )
    };
    if set_result != PAM_SUCCESS_CODE {
        return;
    }

    // If the nonsecret marker cannot be registered, fail closed by removing
    // the just-injected token rather than leaving a token that clear mode
    // cannot distinguish from a manual one.
    if !set_injected_identity(pamh, identity) {
        let _ = unsafe {
            ffi::pam_set_item(pamh, ffi::PAM_AUTHTOK, ptr::null())
        };
    }
}

fn clear(pamh: *mut ffi::PamHandle) {
    let Some(identity) = injected_identity(pamh) else {
        return;
    };
    let cleared = unsafe {
        ffi::pam_set_item(pamh, ffi::PAM_AUTHTOK, ptr::null())
            == PAM_SUCCESS_CODE
    };
    if cleared && acknowledge_success(&identity) {
        // Replacing the data invokes cleanup_injected_identity, which zeroizes
        // and frees the allocation. An acknowledgement failure leaves the
        // bounded nonsecret identity in place so a later clear can retry.
        let _ = unsafe {
            ffi::pam_set_data(
                pamh,
                INJECTED_DATA_NAME.as_ptr().cast::<c_char>(),
                ptr::null_mut(),
                None,
            )
        };
    }
}

unsafe fn parse_options(argc: c_int, argv: *const *const c_char) -> Option<Mode> {
    if argc != 2 || argv.is_null() {
        return None;
    }
    let first = unsafe { bounded_c_bytes(*argv, MAX_OPTION_BYTES) }?;
    let second = unsafe { bounded_c_bytes(*argv.add(1), MAX_OPTION_BYTES) }?;
    parse_option_values([first, second])
}

unsafe fn get_sentinel_once(pamh: *mut ffi::PamHandle) -> Option<String> {
    let mut token = ptr::null();
    let result = unsafe {
        ffi::pam_get_authtok(
            pamh,
            ffi::PAM_AUTHTOK,
            &mut token,
            ptr::null(),
        )
    };
    if result != PAM_SUCCESS_CODE {
        return None;
    }
    let token = unsafe { bounded_c_bytes(token, MAX_SENTINEL_BYTES) }?;
    with_sentinel(token, str::to_owned)
}

unsafe fn required_pam_item(
    pamh: *mut ffi::PamHandle,
    item_type: c_int,
) -> Option<String> {
    let mut item = ptr::null();
    let result = unsafe { ffi::pam_get_item(pamh, item_type, &mut item) };
    if result != PAM_SUCCESS_CODE || item.is_null() {
        return None;
    }
    let bytes = unsafe { bounded_c_bytes(item.cast::<c_char>(), MAX_PAM_ITEM_BYTES) }?;
    if bytes.is_empty() {
        return None;
    }
    std::str::from_utf8(bytes).ok().map(str::to_owned)
}

unsafe fn live_rhost(pamh: *mut ffi::PamHandle) -> Option<RemoteHost> {
    let mut item = ptr::null();
    if unsafe { ffi::pam_get_item(pamh, ffi::PAM_RHOST, &mut item) }
        != PAM_SUCCESS_CODE
    {
        return None;
    }
    if item.is_null() {
        return Some(RemoteHost::Empty);
    }
    let bytes = unsafe { bounded_c_bytes(item.cast::<c_char>(), MAX_PAM_ITEM_BYTES) }?;
    match bytes {
        b"" => Some(RemoteHost::Empty),
        b"localhost" | b"127.0.0.1" | b"::1" => Some(RemoteHost::Local),
        _ => None,
    }
}

unsafe fn bounded_c_bytes<'a>(pointer: *const c_char, maximum: usize) -> Option<&'a [u8]> {
    if pointer.is_null() {
        return None;
    }
    let inspected = maximum.checked_add(1)?;
    let length = unsafe { libc::strnlen(pointer, inspected) };
    if length > maximum {
        return None;
    }
    Some(unsafe { std::slice::from_raw_parts(pointer.cast::<u8>(), length) })
}

fn lookup_uid(username: &str) -> Option<u32> {
    let name = CString::new(username.as_bytes()).ok()?;
    let configured = unsafe { libc::sysconf(libc::_SC_GETPW_R_SIZE_MAX) };
    let capacity = if (1024..=1_048_576).contains(&configured) {
        configured as usize
    } else {
        16_384
    };
    let mut storage = vec![0_u8; capacity];
    let mut record = MaybeUninit::<libc::passwd>::zeroed();
    let mut result = ptr::null_mut();
    let status = unsafe {
        libc::getpwnam_r(
            name.as_ptr(),
            record.as_mut_ptr(),
            storage.as_mut_ptr().cast::<c_char>(),
            storage.len(),
            &mut result,
        )
    };
    if status != 0 || result.is_null() {
        return None;
    }
    let record = unsafe { record.assume_init() };
    u32::try_from(record.pw_uid).ok()
}

fn load_claim_context() -> Option<ClaimContext> {
    let mut file = OpenOptions::new()
        .read(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open(CLAIM_CONTEXT_PATH)
        .ok()?;
    let metadata = file.metadata().ok()?;
    if !metadata.file_type().is_file()
        || metadata.uid() != 0
        || metadata.mode() & 0o077 != 0
        || metadata.len() == 0
        || metadata.len() > MAX_CONTEXT_BYTES as u64
    {
        return None;
    }
    let mut encoded = Vec::with_capacity(metadata.len() as usize);
    file.by_ref()
        .take((MAX_CONTEXT_BYTES + 1) as u64)
        .read_to_end(&mut encoded)
        .ok()?;
    if encoded.is_empty() || encoded.len() > MAX_CONTEXT_BYTES {
        return None;
    }
    serde_json::from_slice(&encoded).ok()
}

fn claim_password(claim_frame: &[u8]) -> Option<SecretBuffer> {
    let payload = decode_frame_payload(claim_frame).ok()?;
    let stream = connect_claim_socket()?;
    let mut framed = FrameIo::new(stream, FrameTimeouts::new(IO_TIMEOUT, IO_TIMEOUT)).ok()?;
    framed.write_frame(payload).ok()?;
    framed
        .stream()
        .shutdown(std::net::Shutdown::Write)
        .ok()?;
    let mut stream = framed.into_stream();

    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).ok()?;
    let password_length = u32::from_be_bytes(header) as usize;
    if password_length == 0 || password_length > MAX_PASSWORD_BYTES {
        return None;
    }

    let mut secret = SecretBuffer::allocate(password_length)?;
    stream.read_exact(secret.secret_mut()).ok()?;
    if secret.secret_mut().contains(&0) {
        return None;
    }
    secret.terminate();

    // The daemon closes immediately after one reply. EOF is part of the
    // framing contract; trailing bytes and a held-open socket are rejected.
    let mut trailing = [0_u8; 1];
    if stream.read(&mut trailing).ok()? != 0 {
        return None;
    }
    Some(secret)
}

fn acknowledge_success(identity: &InjectedIdentity) -> bool {
    let Some(request_id) = identity.request_id() else { return false; };
    let Some(issue_id) = identity.issue_id() else { return false; };
    let Some(nonce) = identity.nonce() else { return false; };
    let Ok(payload) = serde_json::to_vec(&SuccessAcknowledgement {
        protocol_version: 1,
        action: "authentication-succeeded",
        request_id,
        issue_id,
        nonce,
    }) else { return false; };
    let Some(stream) = connect_claim_socket() else { return false; };
    let Ok(mut framed) = FrameIo::new(stream, FrameTimeouts::new(IO_TIMEOUT, IO_TIMEOUT)) else {
        return false;
    };
    if framed.write_frame(&payload).is_err()
        || framed.stream().shutdown(std::net::Shutdown::Write).is_err()
    {
        return false;
    }
    let Some(reply_bytes) = read_bounded_frame(framed.into_stream(), MAX_ACK_REPLY_BYTES) else {
        return false;
    };
    let Some(reply) = decode_strict::<SuccessReply>(&reply_bytes) else {
        return false;
    };
    reply.request_id == request_id
        && reply.issue_id == issue_id
        && reply.state == SuccessState::Succeeded
}

fn read_bounded_frame(mut stream: UnixStream, maximum: usize) -> Option<Vec<u8>> {
    let mut header = [0_u8; 4];
    stream.read_exact(&mut header).ok()?;
    let length = usize::try_from(u32::from_be_bytes(header)).ok()?;
    if length == 0 || length > maximum {
        return None;
    }
    let mut payload = vec![0; length];
    stream.read_exact(&mut payload).ok()?;
    let mut trailing = [0_u8; 1];
    (stream.read(&mut trailing).ok()? == 0).then_some(payload)
}

fn decode_strict<T: DeserializeOwned>(bytes: &[u8]) -> Option<T> {
    let mut decoder = serde_json::Deserializer::from_slice(bytes);
    let value = T::deserialize(&mut decoder).ok()?;
    decoder.end().ok()?;
    Some(value)
}

fn connect_claim_socket() -> Option<UnixStream> {
    let raw_fd = unsafe {
        libc::socket(
            libc::AF_UNIX,
            libc::SOCK_STREAM | libc::SOCK_CLOEXEC | libc::SOCK_NONBLOCK,
            0,
        )
    };
    if raw_fd < 0 {
        return None;
    }
    let owned = unsafe { OwnedFd::from_raw_fd(raw_fd) };

    let mut address = unsafe { MaybeUninit::<libc::sockaddr_un>::zeroed().assume_init() };
    address.sun_family = libc::AF_UNIX as libc::sa_family_t;
    if CLAIM_SOCKET.len() >= address.sun_path.len() {
        return None;
    }
    for (destination, source) in address.sun_path.iter_mut().zip(CLAIM_SOCKET.iter().copied()) {
        *destination = source as c_char;
    }

    let connected = unsafe {
        libc::connect(
            owned.as_raw_fd(),
            (&address as *const libc::sockaddr_un).cast::<libc::sockaddr>(),
            mem::size_of::<libc::sockaddr_un>() as libc::socklen_t,
        )
    };
    if connected != 0 {
        let error = io::Error::last_os_error().raw_os_error()?;
        if !matches!(error, libc::EINPROGRESS | libc::EAGAIN | libc::EALREADY) {
            return None;
        }
        if !wait_for_connect(owned.as_raw_fd(), CONNECT_TIMEOUT) {
            return None;
        }
    }

    let stream = UnixStream::from(owned);
    stream.set_nonblocking(false).ok()?;
    stream.set_read_timeout(Some(IO_TIMEOUT)).ok()?;
    stream.set_write_timeout(Some(IO_TIMEOUT)).ok()?;
    if peer_credentials(&stream).ok()?.uid != 0 {
        return None;
    }
    Some(stream)
}

fn wait_for_connect(fd: c_int, timeout: Duration) -> bool {
    let deadline = Instant::now() + timeout;
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            return false;
        }
        let milliseconds = remaining.as_millis().clamp(1, c_int::MAX as u128) as c_int;
        let mut poll_fd = libc::pollfd {
            fd,
            events: libc::POLLOUT,
            revents: 0,
        };
        let result = unsafe { libc::poll(&mut poll_fd, 1, milliseconds) };
        if result == 0 {
            return false;
        }
        if result < 0 {
            if io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
                continue;
            }
            return false;
        }

        let mut socket_error: c_int = 0;
        let mut length = mem::size_of::<c_int>() as libc::socklen_t;
        let status = unsafe {
            libc::getsockopt(
                fd,
                libc::SOL_SOCKET,
                libc::SO_ERROR,
                (&mut socket_error as *mut c_int).cast::<c_void>(),
                &mut length,
            )
        };
        return status == 0 && length as usize == mem::size_of::<c_int>() && socket_error == 0;
    }
}


fn set_injected_identity(pamh: *mut ffi::PamHandle, identity: InjectedIdentity) -> bool {
    let data = Box::into_raw(Box::new(identity));
    let status = unsafe {
        ffi::pam_set_data(
            pamh,
            INJECTED_DATA_NAME.as_ptr().cast::<c_char>(),
            data.cast::<c_void>(),
            Some(cleanup_injected_identity),
        )
    };
    if status == PAM_SUCCESS_CODE {
        true
    } else {
        unsafe { cleanup_injected_identity(pamh, data.cast::<c_void>(), status) };
        false
    }
}

fn injected_identity(pamh: *mut ffi::PamHandle) -> Option<InjectedIdentity> {
    let mut data = ptr::null();
    let status = unsafe {
        ffi::pam_get_data(
            pamh,
            INJECTED_DATA_NAME.as_ptr().cast::<c_char>(),
            &mut data,
        )
    };
    if status != PAM_SUCCESS_CODE || data.is_null() {
        return None;
    }
    let identity = unsafe { ptr::read_volatile(data.cast::<InjectedIdentity>()) };
    if identity.marker != FLAG_VALUE
        || usize::from(identity.request_id_length) > MAX_REQUEST_ID_BYTES
        || usize::from(identity.issue_id_length) > MAX_ISSUE_ID_BYTES
        || identity.request_id().is_none()
        || identity.issue_id().is_none()
        || identity.nonce().is_none()
    {
        return None;
    }
    Some(identity)
}

unsafe extern "C" fn cleanup_injected_identity(
    _pamh: *mut ffi::PamHandle,
    data: *mut c_void,
    _error_status: c_int,
) {
    if data.is_null() {
        return;
    }
    let mut identity = unsafe { Box::from_raw(data.cast::<InjectedIdentity>()) };
    identity.marker.zeroize();
    identity.request_id_length.zeroize();
    identity.issue_id_length.zeroize();
    identity.request_id.zeroize();
    identity.issue_id.zeroize();
    identity.nonce.zeroize();
    compiler_fence(Ordering::SeqCst);
    drop(identity);
}

const _: ffi::PamDataCleanup = cleanup_injected_identity;

/// A short-lived password receive area backed directly by anonymous pages.
/// Allocation fails closed unless the pages are both locked and excluded from
/// core dumps. Drop uses zeroize plus a compiler fence before munlock/munmap;
/// this reduces exposure but is not a claim of perfect compiler, hardware, or
/// whole-process RAM zeroization.
struct SecretBuffer {
    pointer: NonNull<u8>,
    mapping_length: usize,
    secret_length: usize,
}

impl SecretBuffer {
    fn allocate(secret_length: usize) -> Option<Self> {
        let used = secret_length.checked_add(1)?;
        let page_size = unsafe { libc::sysconf(libc::_SC_PAGESIZE) };
        if page_size <= 0 {
            return None;
        }
        let page_size = page_size as usize;
        let mapping_length = used.checked_add(page_size - 1)? / page_size * page_size;
        let mapping = unsafe {
            libc::mmap(
                ptr::null_mut(),
                mapping_length,
                libc::PROT_READ | libc::PROT_WRITE,
                libc::MAP_PRIVATE | libc::MAP_ANONYMOUS,
                -1,
                0,
            )
        };
        if mapping == libc::MAP_FAILED {
            return None;
        }
        let pointer = NonNull::new(mapping.cast::<u8>())?;
        if unsafe { libc::mlock(mapping, mapping_length) } != 0 {
            unsafe { wipe_and_unmap(pointer, mapping_length, false) };
            return None;
        }
        if unsafe { libc::madvise(mapping, mapping_length, libc::MADV_DONTDUMP) } != 0 {
            unsafe { wipe_and_unmap(pointer, mapping_length, true) };
            return None;
        }
        Some(Self {
            pointer,
            mapping_length,
            secret_length,
        })
    }

    fn secret_mut(&mut self) -> &mut [u8] {
        unsafe { std::slice::from_raw_parts_mut(self.pointer.as_ptr(), self.secret_length) }
    }

    fn terminate(&mut self) {
        unsafe { self.pointer.as_ptr().add(self.secret_length).write(0) };
    }

    fn as_c_ptr(&self) -> *const c_char {
        self.pointer.as_ptr().cast::<c_char>()
    }
}

impl Drop for SecretBuffer {
    fn drop(&mut self) {
        unsafe { wipe_and_unmap(self.pointer, self.mapping_length, true) };
    }
}

unsafe fn wipe_and_unmap(pointer: NonNull<u8>, length: usize, locked: bool) {
    let bytes = unsafe { std::slice::from_raw_parts_mut(pointer.as_ptr(), length) };
    bytes.zeroize();
    compiler_fence(Ordering::SeqCst);
    if locked {
        let _ = unsafe { libc::munlock(pointer.as_ptr().cast::<c_void>(), length) };
    }
    let _ = unsafe { libc::munmap(pointer.as_ptr().cast::<c_void>(), length) };
}
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Mode {
    Inject,
    Clear,
}

fn parse_option_values<'a>(
    arguments: impl IntoIterator<Item = &'a [u8]>,
) -> Option<Mode> {
    let mut mode = None;
    let mut socket_seen = false;
    let mut count = 0_usize;
    for argument in arguments {
        count = count.checked_add(1)?;
        match argument {
            b"mode=inject" if mode.is_none() => mode = Some(Mode::Inject),
            b"mode=clear" if mode.is_none() => mode = Some(Mode::Clear),
            b"socket=/run/remote-auth-broker/gdm/gdm-claim.sock" if !socket_seen => {
                socket_seen = true;
            }
            _ => return None,
        }
    }
    (count == 2 && socket_seen).then_some(mode).flatten()
}

fn with_sentinel<T>(token: &[u8], action: impl FnOnce(&str) -> T) -> Option<T> {
    let sentinel = std::str::from_utf8(token).ok()?;
    remote_auth_broker_protocol::validate_sentinel(sentinel).then(|| action(sentinel))
}

fn sentinel_matches_hash(sentinel: &str, expected_hash: &str) -> bool {
    remote_auth_broker_protocol::sha256_hex(sentinel.as_bytes()) == expected_hash
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::Cell;

    const SOCKET: &[u8] = b"socket=/run/remote-auth-broker/gdm/gdm-claim.sock";

    #[test]
    fn options_accept_exact_mode_and_socket_in_either_order() {
        assert_eq!(
            parse_option_values([b"mode=inject".as_slice(), SOCKET]),
            Some(Mode::Inject)
        );
        assert_eq!(
            parse_option_values([SOCKET, b"mode=clear".as_slice()]),
            Some(Mode::Clear)
        );
    }

    #[test]
    fn options_reject_missing_duplicate_extra_or_unknown_values() {
        assert_eq!(parse_option_values([SOCKET]), None);
        assert_eq!(parse_option_values([SOCKET, SOCKET]), None);
        assert_eq!(
            parse_option_values([b"mode=inject".as_slice(), b"mode=clear".as_slice()]),
            None
        );
        assert_eq!(
            parse_option_values([
                b"mode=inject".as_slice(),
                SOCKET,
                b"unexpected".as_slice(),
            ]),
            None
        );
        assert_eq!(
            parse_option_values([b"mode=inject".as_slice(), b"socket=/tmp/claim.sock".as_slice()]),
            None
        );
    }

    #[test]
    fn manual_password_never_enters_claim_path() {
        let called = Cell::new(false);
        assert_eq!(
            with_sentinel(b"a manual password", |_| called.set(true)),
            None
        );
        assert!(!called.get());

        assert!(with_sentinel(
            b"gdm-broker-v1:AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
            |_| called.set(true),
        )
        .is_some());
        assert!(called.get());
    }
}

