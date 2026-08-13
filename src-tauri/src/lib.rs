pub mod errors;

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NativeHealth {
    pub status: &'static str,
}

pub fn native_health() -> NativeHealth {
    NativeHealth { status: "ready" }
}

pub fn run() {
    tauri::Builder::default()
        .run(tauri::generate_context!())
        .expect("failed to run Tauri application");
}

#[cfg(test)]
mod tests {
    use super::{NativeHealth, native_health};

    #[test]
    fn native_crate_smoke_test() {
        assert_eq!(native_health(), NativeHealth { status: "ready" });
    }
}
