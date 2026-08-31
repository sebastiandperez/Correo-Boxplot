use tauri::State;

use super::{
    ManagedNativeMailRuntime,
    dto::{
        NativeAttachmentDto, NativeBodyDto, NativeFindMessageIdRequest,
        NativeFindMessageIdResponse, NativeMailOpenRequest, NativeMailOpenResponse,
        NativeMailboxDto, NativeMailboxRequest, NativeMailboxSnapshotDto, NativeMessageRequest,
        NativeMoveRequest, NativeMoveResponse, NativeSessionRequest, NativeSmtpSubmitRequest,
        NativeSmtpSubmitResponse, NativeStoreFlagsRequest,
    },
    errors::NativeMailErrorDto,
};

pub const NATIVE_MAIL_COMMAND_NAMES: [&str; 10] = [
    "native_mail_open",
    "native_mail_close",
    "native_imap_list_mailboxes",
    "native_imap_snapshot_mailbox",
    "native_imap_fetch_body",
    "native_imap_fetch_attachments",
    "native_imap_find_message_id",
    "native_imap_store_flags",
    "native_imap_move",
    "native_smtp_submit",
];

#[tauri::command]
pub fn native_mail_open(
    request: NativeMailOpenRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeMailOpenResponse, NativeMailErrorDto> {
    runtime.open(request)
}

#[tauri::command]
pub fn native_mail_close(
    request: NativeSessionRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<(), NativeMailErrorDto> {
    runtime.close(&request.session_id)
}

#[tauri::command]
pub fn native_imap_list_mailboxes(
    request: NativeSessionRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<Vec<NativeMailboxDto>, NativeMailErrorDto> {
    runtime.list_mailboxes(&request.session_id)
}

#[tauri::command]
pub fn native_imap_snapshot_mailbox(
    request: NativeMailboxRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeMailboxSnapshotDto, NativeMailErrorDto> {
    runtime.snapshot_mailbox(&request.session_id, &request.mailbox)
}

#[tauri::command]
pub fn native_imap_fetch_body(
    request: NativeMessageRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeBodyDto, NativeMailErrorDto> {
    runtime.fetch_body(&request)
}

#[tauri::command]
pub fn native_imap_fetch_attachments(
    request: NativeMessageRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<Vec<NativeAttachmentDto>, NativeMailErrorDto> {
    runtime.fetch_attachments(&request)
}

#[tauri::command]
pub fn native_imap_find_message_id(
    request: NativeFindMessageIdRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeFindMessageIdResponse, NativeMailErrorDto> {
    runtime.find_message_id(&request)
}

#[tauri::command]
pub fn native_imap_store_flags(
    request: NativeStoreFlagsRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<(), NativeMailErrorDto> {
    runtime.store_flags(&request)
}

#[tauri::command]
pub fn native_imap_move(
    request: NativeMoveRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeMoveResponse, NativeMailErrorDto> {
    runtime.move_message(&request)
}

#[tauri::command]
pub fn native_smtp_submit(
    request: NativeSmtpSubmitRequest,
    runtime: State<'_, ManagedNativeMailRuntime>,
) -> Result<NativeSmtpSubmitResponse, NativeMailErrorDto> {
    runtime.smtp_submit(&request)
}

#[cfg(test)]
mod tests {
    use super::NATIVE_MAIL_COMMAND_NAMES;

    #[test]
    fn native_command_inventory_is_exact_unique_and_separate_from_local() {
        assert_eq!(NATIVE_MAIL_COMMAND_NAMES.len(), 10);
        let unique = NATIVE_MAIL_COMMAND_NAMES
            .into_iter()
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(unique.len(), 10);
        assert!(unique.iter().all(|name| name.starts_with("native_")));
        assert!(unique.iter().all(|name| !name.starts_with("local_")));
    }
}
