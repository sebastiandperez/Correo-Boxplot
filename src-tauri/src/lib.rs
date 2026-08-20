#[cfg(feature = "conformance")]
mod conformance;
pub mod db;
pub mod errors;
pub mod ipc;
pub mod persistence;

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NativeHealth {
    pub status: &'static str,
}

pub fn native_health() -> NativeHealth {
    NativeHealth { status: "ready" }
}

pub fn run() {
    let builder = tauri::Builder::default().manage(ipc::ManagedLocalEngine::default());

    #[cfg(not(feature = "conformance"))]
    let builder = builder.invoke_handler(tauri::generate_handler![
        ipc::commands::local_read_account,
        ipc::commands::local_list_accounts,
        ipc::commands::local_read_mailbox,
        ipc::commands::local_list_mailboxes,
        ipc::commands::local_read_identity,
        ipc::commands::local_list_identities,
        ipc::commands::local_read_email,
        ipc::commands::local_read_emails,
        ipc::commands::local_read_email_memberships,
        ipc::commands::local_read_email_body,
        ipc::commands::local_read_attachment_refs,
        ipc::commands::local_read_mailbox_view,
        ipc::commands::local_read_collection_sync_cursor,
        ipc::commands::local_read_pending_mutation,
        ipc::commands::local_list_pending_mutations,
        ipc::commands::local_register_account,
        ipc::commands::local_apply_collection_sync,
        ipc::commands::local_cache_email_body,
        ipc::commands::local_replace_attachment_refs,
        ipc::commands::local_replace_mailbox_view,
        ipc::commands::local_stage_send_mutation,
        ipc::commands::local_apply_optimistic_keyword_mutation,
        ipc::commands::local_apply_optimistic_mailbox_membership_mutation,
        ipc::commands::local_replace_pending_mutation_if_current,
        ipc::commands::local_remove_confirmed_mutation,
    ]);

    #[cfg(feature = "conformance")]
    let builder = builder
        .manage(conformance::ConformanceRuntimeState::default())
        .invoke_handler(tauri::generate_handler![
            ipc::commands::local_read_account,
            ipc::commands::local_list_accounts,
            ipc::commands::local_read_mailbox,
            ipc::commands::local_list_mailboxes,
            ipc::commands::local_read_identity,
            ipc::commands::local_list_identities,
            ipc::commands::local_read_email,
            ipc::commands::local_read_emails,
            ipc::commands::local_read_email_memberships,
            ipc::commands::local_read_email_body,
            ipc::commands::local_read_attachment_refs,
            ipc::commands::local_read_mailbox_view,
            ipc::commands::local_read_collection_sync_cursor,
            ipc::commands::local_read_pending_mutation,
            ipc::commands::local_list_pending_mutations,
            ipc::commands::local_register_account,
            ipc::commands::local_apply_collection_sync,
            ipc::commands::local_cache_email_body,
            ipc::commands::local_replace_attachment_refs,
            ipc::commands::local_replace_mailbox_view,
            ipc::commands::local_stage_send_mutation,
            ipc::commands::local_apply_optimistic_keyword_mutation,
            ipc::commands::local_apply_optimistic_mailbox_membership_mutation,
            ipc::commands::local_replace_pending_mutation_if_current,
            ipc::commands::local_remove_confirmed_mutation,
            conformance::conformance_create_runtime,
            conformance::conformance_dispose_runtime,
            conformance::conformance_settle,
            conformance::conformance_restart_runtime,
            conformance::conformance_wrong_key_rejected,
        ]);

    builder
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
