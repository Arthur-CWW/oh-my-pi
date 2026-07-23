use std::ffi::CString;
use std::fs::OpenOptions;
use std::os::fd::{AsRawFd, FromRawFd, OwnedFd};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{FileTypeExt, MetadataExt, OpenOptionsExt};
use std::path::{Component, Path};

use crate::config::RegisteredAction;

#[derive(Debug, Clone, Copy)]
pub(crate) enum ExecutionResult {
    Exited(i32),
    Signaled(i32),
    Failed,
}

#[derive(Debug)]
struct ExecutionPlan {
    argv: Vec<CString>,
    environment: Vec<CString>,
}

pub(crate) struct PreparedExecution {
    plan: ExecutionPlan,
    executable: OwnedFd,
}

impl ExecutionPlan {
    fn from_action(action: &RegisteredAction) -> Result<Self, ()> {
        let argv = action
            .argv
            .iter()
            .map(|argument| CString::new(argument.as_bytes()))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ())?;
        let environment = action
            .fixed_env
            .iter()
            .map(|entry| {
                let mut bytes = Vec::with_capacity(entry.name.len() + 1 + entry.value.len());
                bytes.extend_from_slice(entry.name.as_bytes());
                bytes.push(b'=');
                bytes.extend_from_slice(entry.value.as_bytes());
                CString::new(bytes)
            })
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| ())?;
        Ok(Self { argv, environment })
    }
}

pub(crate) fn prepare_registered(action: &RegisteredAction) -> Result<PreparedExecution, ()> {
    let plan = ExecutionPlan::from_action(action)?;
    let executable = open_pinned_executable(Path::new(&action.executable))?;
    Ok(PreparedExecution { plan, executable })
}

pub(crate) fn execute_prepared(prepared: PreparedExecution) -> ExecutionResult {
    let mut argv_pointers: Vec<*const libc::c_char> = prepared
        .plan
        .argv
        .iter()
        .map(|argument| argument.as_ptr())
        .collect();
    argv_pointers.push(std::ptr::null());
    let mut environment_pointers: Vec<*const libc::c_char> = prepared
        .plan
        .environment
        .iter()
        .map(|entry| entry.as_ptr())
        .collect();
    environment_pointers.push(std::ptr::null());

    let Ok(null) = OpenOptions::new()
        .read(true)
        .write(true)
        .custom_flags(libc::O_CLOEXEC | libc::O_NOFOLLOW)
        .open("/dev/null")
    else {
        return ExecutionResult::Failed;
    };
    let Ok(null_metadata) = null.metadata() else {
        return ExecutionResult::Failed;
    };
    if !null_metadata.file_type().is_char_device()
        || null_metadata.uid() != 0
        || null_metadata.mode() & 0o022 != 0
    {
        return ExecutionResult::Failed;
    }

    let executable_fd = prepared.executable.as_raw_fd();
    let null_fd = null.as_raw_fd();
    let child = unsafe { libc::fork() };
    if child < 0 {
        return ExecutionResult::Failed;
    }
    if child == 0 {
        for destination in [libc::STDIN_FILENO, libc::STDOUT_FILENO, libc::STDERR_FILENO] {
            if unsafe { libc::dup2(null_fd, destination) } < 0 {
                unsafe { libc::_exit(126) };
            }
        }
        unsafe { close_descriptors_except(executable_fd) };
        unsafe {
            libc::fexecve(
                executable_fd,
                argv_pointers.as_ptr(),
                environment_pointers.as_ptr(),
            );
            libc::_exit(126);
        }
    }
    drop(null);
    drop(prepared);

    let mut status = 0;
    loop {
        let waited = unsafe { libc::waitpid(child, &mut status, 0) };
        if waited == child {
            break;
        }
        if waited < 0 && std::io::Error::last_os_error().raw_os_error() == Some(libc::EINTR) {
            continue;
        }
        return ExecutionResult::Failed;
    }

    if libc::WIFEXITED(status) {
        ExecutionResult::Exited(libc::WEXITSTATUS(status))
    } else if libc::WIFSIGNALED(status) {
        ExecutionResult::Signaled(libc::WTERMSIG(status))
    } else {
        ExecutionResult::Failed
    }
}

fn open_pinned_executable(path: &Path) -> Result<OwnedFd, ()> {
    let root = CString::new("/").map_err(|_| ())?;
    let root_fd = unsafe {
        libc::open(
            root.as_ptr(),
            libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW,
        )
    };
    if root_fd < 0 {
        return Err(());
    }
    let mut directory = unsafe { OwnedFd::from_raw_fd(root_fd) };
    validate_directory_fd(directory.as_raw_fd())?;

    let mut components = path.components();
    if !matches!(components.next(), Some(Component::RootDir)) {
        return Err(());
    }
    let mut components = components.peekable();
    while let Some(component) = components.next() {
        let Component::Normal(name) = component else {
            return Err(());
        };
        let name = CString::new(name.as_bytes()).map_err(|_| ())?;
        let is_final = components.peek().is_none();
        let flags = if is_final {
            libc::O_RDONLY | libc::O_CLOEXEC | libc::O_NOFOLLOW | libc::O_NONBLOCK
        } else {
            libc::O_PATH | libc::O_DIRECTORY | libc::O_CLOEXEC | libc::O_NOFOLLOW
        };
        let fd = unsafe { libc::openat(directory.as_raw_fd(), name.as_ptr(), flags) };
        if fd < 0 {
            return Err(());
        }
        let opened = unsafe { OwnedFd::from_raw_fd(fd) };
        if is_final {
            validate_executable_fd(opened.as_raw_fd())?;
            return Ok(opened);
        }
        validate_directory_fd(opened.as_raw_fd())?;
        directory = opened;
    }
    Err(())
}

fn validate_directory_fd(fd: libc::c_int) -> Result<(), ()> {
    let metadata = descriptor_metadata(fd)?;
    if metadata.st_mode & libc::S_IFMT != libc::S_IFDIR
        || metadata.st_uid != 0
        || metadata.st_mode & 0o022 != 0
    {
        return Err(());
    }
    Ok(())
}

fn validate_executable_fd(fd: libc::c_int) -> Result<(), ()> {
    let metadata = descriptor_metadata(fd)?;
    if metadata.st_mode & libc::S_IFMT != libc::S_IFREG
        || metadata.st_uid != 0
        || metadata.st_mode & 0o022 != 0
        || metadata.st_mode & 0o111 == 0
        || metadata.st_nlink == 0
    {
        return Err(());
    }
    Ok(())
}

fn descriptor_metadata(fd: libc::c_int) -> Result<libc::stat, ()> {
    let mut metadata = unsafe { std::mem::zeroed::<libc::stat>() };
    if unsafe { libc::fstat(fd, &mut metadata) } != 0 {
        return Err(());
    }
    Ok(metadata)
}

unsafe fn close_descriptors_except(retained: libc::c_int) {
    let lower_closed = retained <= libc::STDERR_FILENO + 1
        || unsafe {
            libc::syscall(
                libc::SYS_close_range,
                libc::STDERR_FILENO + 1,
                retained - 1,
                0,
            )
        } == 0;
    let upper_closed = retained == i32::MAX
        || unsafe {
            libc::syscall(
                libc::SYS_close_range,
                retained + 1,
                u32::MAX,
                0,
            )
        } == 0;
    if lower_closed && upper_closed {
        return;
    }

    let configured = unsafe { libc::sysconf(libc::_SC_OPEN_MAX) };
    let maximum = if configured < 0 {
        1_048_576
    } else {
        configured.min(1_048_576) as libc::c_int
    };
    for fd in (libc::STDERR_FILENO + 1)..maximum {
        if fd != retained {
            unsafe { libc::close(fd) };
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::{FixedEnvironment, RegisteredAction};
    use remote_auth_broker_protocol::Risk;

    #[test]
    fn direct_execution_plan_preserves_exact_argv_and_fixed_environment() {
        let action = RegisteredAction {
            executable: "/usr/bin/systemctl".to_owned(),
            argv: vec![
                "/usr/bin/systemctl".to_owned(),
                "restart".to_owned(),
                "gdm.service".to_owned(),
            ],
            argv_digest: String::new(),
            risk: Risk::High,
            destructive: true,
            irreversible: false,
            fixed_env: vec![
                FixedEnvironment { name: "LANG".to_owned(), value: "C.UTF-8".to_owned() },
                FixedEnvironment { name: "LC_ALL".to_owned(), value: "C.UTF-8".to_owned() },
            ],
        };

        let plan = ExecutionPlan::from_action(&action).expect("valid plan");
        let argv: Vec<&[u8]> = plan.argv.iter().map(|value| value.as_bytes()).collect();
        let environment: Vec<&[u8]> = plan.environment.iter().map(|value| value.as_bytes()).collect();
        assert_eq!(argv, [b"/usr/bin/systemctl".as_slice(), b"restart", b"gdm.service"]);
        assert_eq!(environment, [b"LANG=C.UTF-8".as_slice(), b"LC_ALL=C.UTF-8"]);
    }

    #[test]
    fn direct_execution_plan_rejects_nul_without_consulting_caller_environment() {
        let action = RegisteredAction {
            executable: "/usr/bin/true".to_owned(),
            argv: vec!["/usr/bin/true\0ignored".to_owned()],
            argv_digest: String::new(),
            risk: Risk::Low,
            destructive: false,
            irreversible: false,
            fixed_env: Vec::new(),
        };
        assert!(ExecutionPlan::from_action(&action).is_err());
    }
}
