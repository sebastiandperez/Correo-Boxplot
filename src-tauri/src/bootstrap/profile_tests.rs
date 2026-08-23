use super::{CachePaths, CacheProcessLock};

#[test]
fn demo_profiles_can_hold_distinct_process_locks_simultaneously() {
    let first_root = tempfile::tempdir().unwrap();
    let second_root = tempfile::tempdir().unwrap();
    let first = CachePaths::prepare(first_root.path().to_owned()).unwrap();
    let second = CachePaths::prepare(second_root.path().to_owned()).unwrap();
    let _first_lock = CacheProcessLock::acquire(&first.lock).unwrap();
    let _second_lock = CacheProcessLock::acquire(&second.lock).unwrap();
    assert_ne!(first.lock, second.lock);
}
