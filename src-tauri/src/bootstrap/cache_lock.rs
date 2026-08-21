use std::{
    fs::{File, OpenOptions},
    path::Path,
};

use super::BootstrapFailure;

pub struct CacheProcessLock {
    _file: File,
}

impl CacheProcessLock {
    pub fn acquire(path: &Path) -> Result<Self, BootstrapFailure> {
        let file = OpenOptions::new()
            .create(true)
            .truncate(false)
            .read(true)
            .write(true)
            .open(path)
            .map_err(|_| BootstrapFailure::LocalDataUnavailable)?;
        match file.try_lock() {
            Ok(()) => Ok(Self { _file: file }),
            Err(std::fs::TryLockError::WouldBlock) => Err(BootstrapFailure::LocalCacheAlreadyInUse),
            Err(std::fs::TryLockError::Error(_)) => Err(BootstrapFailure::LocalDataUnavailable),
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{env, process::Command};

    use super::*;

    #[test]
    fn cache_lock_child_helper() {
        let Ok(path) = env::var("CORREO_CACHE_LOCK_CHILD_PATH") else {
            return;
        };
        assert_eq!(
            CacheProcessLock::acquire(Path::new(&path)).err(),
            Some(BootstrapFailure::LocalCacheAlreadyInUse)
        );
    }

    #[test]
    fn process_lock_rejects_a_second_process() {
        let temp = tempfile::tempdir().expect("temp directory");
        let path = temp.path().join("local-cache.lock");
        let _held = CacheProcessLock::acquire(&path).expect("first process acquires lock");
        let status = Command::new(env::current_exe().expect("test executable"))
            .args([
                "--exact",
                "bootstrap::cache_lock::tests::cache_lock_child_helper",
            ])
            .env("CORREO_CACHE_LOCK_CHILD_PATH", &path)
            .status()
            .expect("child process runs");
        assert!(status.success());
    }
}
