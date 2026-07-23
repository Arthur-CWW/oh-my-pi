mod app;
mod error;
mod model;
mod platform;
mod storage;

use std::io::Write;

pub fn main_entry() -> i32 {
    let command = match app::parse_args(std::env::args_os()) {
        Ok(command) => command,
        Err(error) => {
            let _ = writeln!(std::io::stderr().lock(), "remote-auth-verifierctl: {}", error.message());
            return 2;
        }
    };
    match app::execute(command) {
        Ok(Some(output)) => {
            if std::io::stdout().lock().write_all(&output).is_err() {
                1
            } else {
                0
            }
        }
        Ok(None) => 0,
        Err(error) => {
            let _ = writeln!(std::io::stderr().lock(), "remote-auth-verifierctl: {}", error.message());
            1
        }
    }
}
