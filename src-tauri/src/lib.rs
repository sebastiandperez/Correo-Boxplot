mod bootstrap;
#[cfg(feature = "conformance")]
mod conformance;
pub mod db;
mod e2ee;
pub mod errors;
pub mod ipc;
#[cfg(feature = "local-env-doctor")]
mod local_env_doctor;
pub mod net;
pub mod persistence;
mod security;

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
pub struct NativeHealth {
    pub status: &'static str,
}

pub fn native_health() -> NativeHealth {
    NativeHealth { status: "ready" }
}

#[cfg(feature = "local-env-doctor")]
pub fn run_local_env_doctor(arguments: impl Iterator<Item = String>) -> i32 {
    local_env_doctor::run(arguments)
}

#[cfg(feature = "e2ee-dev-tool")]
pub fn run_e2ee_key_tool(arguments: impl Iterator<Item = String>) -> i32 {
    e2ee::run_development_tool(arguments)
}

pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(ipc::ManagedLocalEngine::default())
        .manage(net::ManagedNativeMailRuntime::default())
        .manage(e2ee::ManagedE2eeService::default());

    #[cfg(not(feature = "conformance"))]
    let builder = builder.setup(|app| {
        e2ee::initialize_tauri(app);
        bootstrap::initialize_tauri(app);
        #[cfg(feature = "local-env-doctor")]
        local_env_doctor::maybe_run_development_acceptance(app);
        Ok(())
    });

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
        e2ee::ipc::e2ee_ensure_local_identity,
        e2ee::ipc::e2ee_trust_peer_public_key,
        e2ee::ipc::e2ee_peer_key_status,
        e2ee::ipc::e2ee_encrypt,
        e2ee::ipc::e2ee_decrypt,
        net::commands::native_mail_open,
        net::commands::native_mail_close,
        net::commands::native_imap_list_mailboxes,
        net::commands::native_imap_snapshot_mailbox,
        net::commands::native_imap_fetch_body,
        net::commands::native_imap_fetch_attachments,
        net::commands::native_imap_find_message_id,
        net::commands::native_imap_store_flags,
        net::commands::native_imap_move,
        net::commands::native_smtp_submit,
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
            e2ee::ipc::e2ee_ensure_local_identity,
            e2ee::ipc::e2ee_trust_peer_public_key,
            e2ee::ipc::e2ee_peer_key_status,
            e2ee::ipc::e2ee_encrypt,
            e2ee::ipc::e2ee_decrypt,
            net::commands::native_mail_open,
            net::commands::native_mail_close,
            net::commands::native_imap_list_mailboxes,
            net::commands::native_imap_snapshot_mailbox,
            net::commands::native_imap_fetch_body,
            net::commands::native_imap_fetch_attachments,
            net::commands::native_imap_find_message_id,
            net::commands::native_imap_store_flags,
            net::commands::native_imap_move,
            net::commands::native_smtp_submit,
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
