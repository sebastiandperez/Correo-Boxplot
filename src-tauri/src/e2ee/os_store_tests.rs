use std::{
    sync::Arc,
    time::{SystemTime, UNIX_EPOCH},
};

use super::{E2eeKeyStore, E2eeService, OsE2eeKeyStore};

#[test]
#[ignore = "requires the host OS credential service"]
fn public_identity_survives_native_store_recreation() {
    let run = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let service_name = format!("com.editorialhuellas.correoboxplot.test.{run}.e2ee");
    let first_store = Arc::new(OsE2eeKeyStore::new(&service_name).unwrap());
    let first = E2eeService::new(first_store.clone())
        .ensure_local_identity("alice@boxplot.test")
        .unwrap();
    let recreated_store = Arc::new(OsE2eeKeyStore::new(&service_name).unwrap());
    let recreated = E2eeService::new(recreated_store.clone())
        .ensure_local_identity("alice@boxplot.test")
        .unwrap();
    assert_eq!(first, recreated);
    recreated_store.reset().unwrap();
}
