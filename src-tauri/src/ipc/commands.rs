use tauri::{AppHandle, State};

use crate::persistence::{self as semantic, PersistentLocalEngine};

use super::{
    EngineLease, ManagedLocalEngine,
    dto::*,
    errors::{read_error, unavailable_read, unavailable_write, write_error},
    events::LocalChangeEmitter,
};

pub const READ_COMMAND_NAMES: [&str; 15] = [
    "local_read_account",
    "local_list_accounts",
    "local_read_mailbox",
    "local_list_mailboxes",
    "local_read_identity",
    "local_list_identities",
    "local_read_email",
    "local_read_emails",
    "local_read_email_memberships",
    "local_read_email_body",
    "local_read_attachment_refs",
    "local_read_mailbox_view",
    "local_read_collection_sync_cursor",
    "local_read_pending_mutation",
    "local_list_pending_mutations",
];
pub const WRITE_COMMAND_NAMES: [&str; 10] = [
    "local_register_account",
    "local_apply_collection_sync",
    "local_cache_email_body",
    "local_replace_attachment_refs",
    "local_replace_mailbox_view",
    "local_stage_send_mutation",
    "local_apply_optimistic_keyword_mutation",
    "local_apply_optimistic_mailbox_membership_mutation",
    "local_replace_pending_mutation_if_current",
    "local_remove_confirmed_mutation",
];

fn engine<'a>(state: &'a State<'_, ManagedLocalEngine>) -> Option<EngineLease<'a>> {
    state.lease()
}
fn read<T>(result: semantic::PersistResult<T>) -> IpcReadResult<T> {
    match result {
        Ok(value) => read_ok(value),
        Err(error) => read_error(error),
    }
}
fn write<E: LocalChangeEmitter>(
    result: semantic::PersistResult<()>,
    emitter: &E,
    hints: Vec<IpcLocalChangeHint>,
) -> IpcWriteResult {
    match result {
        Ok(()) => {
            let _ = emitter.emit_local_change(&IpcLocalChangeBatch { hints });
            write_ok()
        }
        Err(error) => write_error(error),
    }
}

fn write_leased<E: LocalChangeEmitter>(
    _lease: &EngineLease<'_>,
    result: semantic::PersistResult<()>,
    emitter: &E,
    hints: Vec<IpcLocalChangeHint>,
) -> IpcWriteResult {
    write(result, emitter, hints)
}

#[tauri::command]
pub fn local_read_account(
    request: IpcAccountKeyRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcLocalEntity<IpcAccount>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read_account(&e, request)
}
fn read_account(
    engine: &PersistentLocalEngine,
    request: IpcAccountKeyRequest,
) -> IpcReadResult<IpcLocalEntity<IpcAccount>> {
    read(engine.read_account(&request.account_key).map(local_entity))
}
#[tauri::command]
pub fn local_list_accounts(
    _request: IpcEmptyRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<Vec<IpcAccount>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.list_accounts()
            .map(|xs| xs.into_iter().map(Into::into).collect()),
    )
}
#[tauri::command]
pub fn local_read_mailbox(
    request: IpcMailboxIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcLocalEntity<IpcMailbox>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_mailbox(
            &request.mailbox_id.account_key,
            &request.mailbox_id.jmap_mailbox_id,
        )
        .map(local_entity),
    )
}
#[tauri::command]
pub fn local_list_mailboxes(
    request: IpcAccountKeyRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedSnapshot<Vec<IpcMailbox>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(e.list_mailboxes(&request.account_key).map(owned_snapshot))
}
#[tauri::command]
pub fn local_read_identity(
    request: IpcIdentityIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcLocalEntity<IpcIdentity>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_identity(
            &request.identity_id.account_key,
            &request.identity_id.jmap_identity_id,
        )
        .map(local_entity),
    )
}
#[tauri::command]
pub fn local_list_identities(
    request: IpcAccountKeyRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedSnapshot<Vec<IpcIdentity>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(e.list_identities(&request.account_key).map(owned_snapshot))
}
#[tauri::command]
pub fn local_read_email(
    request: IpcEmailIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcLocalEntity<IpcEmail>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_email(
            &request.email_id.account_key,
            &request.email_id.jmap_email_id,
        )
        .map(local_entity),
    )
}
#[tauri::command]
pub fn local_read_emails(
    request: IpcEmailIdsRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<Vec<IpcLocalEntity<IpcEmail>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    let ids = request
        .email_ids
        .into_iter()
        .map(|id| (id.account_key, id.jmap_email_id))
        .collect::<Vec<_>>();
    read(
        e.read_emails(&ids)
            .map(|xs| xs.into_iter().map(local_entity).collect()),
    )
}
#[tauri::command]
pub fn local_read_email_memberships(
    request: IpcEmailIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedSnapshot<Vec<IpcEmailMailbox>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_email_memberships(
            &request.email_id.account_key,
            &request.email_id.jmap_email_id,
        )
        .map(owned_snapshot),
    )
}
#[tauri::command]
pub fn local_read_email_body(
    request: IpcEmailIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedCache<IpcEmailBody>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read_email_body(&e, request)
}
fn read_email_body(
    engine: &PersistentLocalEngine,
    request: IpcEmailIdRequest,
) -> IpcReadResult<IpcOwnedCache<IpcEmailBody>> {
    read(
        engine
            .read_email_body(
                &request.email_id.account_key,
                &request.email_id.jmap_email_id,
            )
            .map(owned_cache),
    )
}
#[tauri::command]
pub fn local_read_attachment_refs(
    request: IpcEmailIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedCache<Vec<IpcAttachmentRef>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_attachment_refs(
            &request.email_id.account_key,
            &request.email_id.jmap_email_id,
        )
        .map(owned_cache_vec),
    )
}
#[tauri::command]
pub fn local_read_mailbox_view(
    request: IpcViewRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedCache<IpcMailboxView>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(e.read_mailbox_view(&request.spec.into()).map(owned_cache))
}
#[tauri::command]
pub fn local_read_collection_sync_cursor(
    request: IpcCursorRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedOptional<IpcCollectionSyncCursor>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_collection_sync_cursor(
            &request.account_key,
            data_type_to_semantic_public(request.data_type),
        )
        .map(owned_optional),
    )
}
#[tauri::command]
pub fn local_read_pending_mutation(
    request: IpcMutationIdRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedOptional<IpcPendingMutation>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.read_pending_mutation(&request.account_key, &request.mutation_id)
            .map(owned_optional),
    )
}
#[tauri::command]
pub fn local_list_pending_mutations(
    request: IpcAccountKeyRequest,
    state: State<'_, ManagedLocalEngine>,
) -> IpcReadResult<IpcOwnedSnapshot<Vec<IpcPendingMutation>>> {
    let Some(e) = engine(&state) else {
        return unavailable_read();
    };
    read(
        e.list_pending_mutations(&request.account_key)
            .map(owned_snapshot),
    )
}

#[tauri::command]
pub fn local_register_account(
    request: IpcAccountRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    register_account(&e, &app, request)
}
fn register_account<E: LocalChangeEmitter>(
    engine: &PersistentLocalEngine,
    emitter: &E,
    request: IpcAccountRequest,
) -> IpcWriteResult {
    write(
        engine.register_account(&request.account.into()),
        emitter,
        vec![IpcLocalChangeHint::Accounts],
    )
}
#[tauri::command]
pub fn local_apply_collection_sync(
    request: IpcCollectionCommitRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    if let Err(error) = validate_collection_scope(&request.commit) {
        return write_error(error);
    }
    let hints = collection_hints(&request.commit);
    let result = e.apply_collection_sync(&request.commit.into());
    write_leased(&e, result, &app, hints)
}
#[tauri::command]
pub fn local_cache_email_body(
    request: IpcBodyRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    let hint = IpcLocalChangeHint::EmailBody {
        email_id: request.body.email_id.clone(),
    };
    let result = e.cache_email_body(&request.body.into());
    write_leased(&e, result, &app, vec![hint])
}
#[tauri::command]
pub fn local_replace_attachment_refs(
    request: IpcAttachmentsRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    if let Some(error) = request
        .refs
        .iter()
        .find_map(|r| validate_attachment_scope(&request.email_id, r).err())
    {
        return write_error(error);
    }
    let hint = IpcLocalChangeHint::AttachmentRefs {
        email_id: request.email_id.clone(),
    };
    let refs = request.refs.into_iter().map(Into::into).collect::<Vec<_>>();
    let result = e.replace_attachment_refs(
        &request.email_id.account_key,
        &request.email_id.jmap_email_id,
        &refs,
    );
    write_leased(&e, result, &app, vec![hint])
}
#[tauri::command]
pub fn local_replace_mailbox_view(
    request: IpcMailboxViewRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    if let Err(error) = validate_view_scope(&request.view) {
        return write_error(error);
    }
    let hint = IpcLocalChangeHint::MailboxView {
        spec: request.view.spec.clone(),
    };
    let result = e.replace_mailbox_view(&request.view.into());
    write_leased(&e, result, &app, vec![hint])
}
#[tauri::command]
pub fn local_stage_send_mutation(
    request: IpcMutationRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    mutation_write(request, state, app, MutationWrite::Send)
}
#[tauri::command]
pub fn local_apply_optimistic_keyword_mutation(
    request: IpcMutationRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    mutation_write(request, state, app, MutationWrite::Keyword)
}
#[tauri::command]
pub fn local_apply_optimistic_mailbox_membership_mutation(
    request: IpcMutationRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    mutation_write(request, state, app, MutationWrite::Membership)
}
#[tauri::command]
pub fn local_replace_pending_mutation_if_current(
    request: IpcMutationCasRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    if let Err(error) = validate_mutation_scope(&request.expected)
        .and_then(|_| validate_mutation_scope(&request.next))
    {
        return write_error(error);
    }
    let account = request.expected_account();
    let expected = request.expected.into();
    let next = request.next.into();
    let result = e.replace_pending_mutation_if_current(&expected, &next);
    write_leased(
        &e,
        result,
        &app,
        vec![IpcLocalChangeHint::PendingMutations {
            account_key: account,
        }],
    )
}
#[tauri::command]
pub fn local_remove_confirmed_mutation(
    request: IpcMutationIdRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    let result = e.remove_confirmed_mutation(&request.account_key, &request.mutation_id);
    write_leased(
        &e,
        result,
        &app,
        vec![IpcLocalChangeHint::PendingMutations {
            account_key: request.account_key,
        }],
    )
}

#[derive(Clone, Copy)]
enum MutationWrite {
    Send,
    Keyword,
    Membership,
}

#[cfg(test)]
#[allow(clippy::items_after_test_module)]
mod tests {
    use std::{
        env, fs,
        path::PathBuf,
        process,
        sync::Mutex,
        time::{SystemTime, UNIX_EPOCH},
    };

    use super::*;

    struct OrderingEmitter<'a> {
        reset_done: &'a std::sync::mpsc::Receiver<()>,
    }

    impl LocalChangeEmitter for OrderingEmitter<'_> {
        fn emit_local_change(
            &self,
            _batch: &IpcLocalChangeBatch,
        ) -> Result<(), super::super::events::EventDeliveryError> {
            assert!(self.reset_done.try_recv().is_err());
            Ok(())
        }
    }

    const KEY: [u8; 32] = [0x44; 32];

    #[test]
    fn lifecycle_lease_is_held_through_event_emission() {
        let db = TempDb::new();
        let managed = std::sync::Arc::new(ManagedLocalEngine::default());
        managed
            .initialize(PersistentLocalEngine::open(&db.0, KEY).expect("encrypted engine opens"));
        let lease = managed.lease().expect("engine ready");
        let (started_tx, started_rx) = std::sync::mpsc::channel();
        let (done_tx, done_rx) = std::sync::mpsc::channel();
        let worker = managed.clone();
        let reset = std::thread::spawn(move || {
            started_tx.send(()).expect("reset started");
            worker.with_exclusive(|state| state.begin_reset());
            done_tx.send(()).expect("reset completed");
        });
        started_rx.recv().expect("reset attempts lifecycle lock");
        let result = write_leased(
            &lease,
            Ok(()),
            &OrderingEmitter {
                reset_done: &done_rx,
            },
            vec![],
        );
        assert!(matches!(result, IpcResult::Ok { .. }));
        drop(lease);
        done_rx.recv().expect("reset completes after emission");
        reset.join().expect("reset thread joins");
    }

    struct TempDb(PathBuf);
    impl TempDb {
        fn new() -> Self {
            let nonce = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("clock must be after epoch")
                .as_nanos();
            Self(env::temp_dir().join(format!("correo-ipc00-{}-{nonce}.db", process::id())))
        }
    }
    impl Drop for TempDb {
        fn drop(&mut self) {
            for suffix in ["", "-wal", "-shm", "-journal"] {
                let mut path = self.0.as_os_str().to_os_string();
                path.push(suffix);
                let _ = fs::remove_file(PathBuf::from(path));
            }
        }
    }

    #[derive(Default)]
    struct Recorder {
        batches: Mutex<Vec<IpcLocalChangeBatch>>,
        fail: bool,
    }
    impl LocalChangeEmitter for Recorder {
        fn emit_local_change(
            &self,
            batch: &IpcLocalChangeBatch,
        ) -> Result<(), super::super::events::EventDeliveryError> {
            self.batches
                .lock()
                .expect("recorder mutex must be available")
                .push(batch.clone());
            if self.fail {
                Err(super::super::events::EventDeliveryError)
            } else {
                Ok(())
            }
        }
    }

    fn account(key: &str, remote: &str) -> IpcAccountRequest {
        IpcAccountRequest {
            account: IpcAccount {
                key: key.into(),
                remote_ref: IpcRemoteAccountRef {
                    service_key: "service-a".into(),
                    jmap_account_id: remote.into(),
                },
            },
        }
    }

    #[test]
    fn inventory_is_exact_and_unique() {
        assert_eq!(READ_COMMAND_NAMES.len(), 15);
        assert_eq!(WRITE_COMMAND_NAMES.len(), 10);
        let all = READ_COMMAND_NAMES
            .into_iter()
            .chain(WRITE_COMMAND_NAMES)
            .collect::<std::collections::BTreeSet<_>>();
        assert_eq!(all.len(), 25);
    }

    #[test]
    fn register_handler_emits_after_commit_and_listener_can_read_state() {
        let db = TempDb::new();
        let engine = PersistentLocalEngine::open(&db.0, KEY).expect("encrypted engine opens");
        let recorder = Recorder::default();

        assert!(matches!(
            register_account(&engine, &recorder, account("account-a", "remote-a")),
            IpcResult::Ok { .. }
        ));
        assert!(matches!(
            engine.read_account("account-a").expect("read succeeds"),
            semantic::LocalEntity::Present(_)
        ));
        assert!(matches!(
            read_account(
                &engine,
                IpcAccountKeyRequest {
                    account_key: "account-a".into()
                }
            ),
            IpcResult::Ok {
                value: IpcLocalEntity::Present(_),
                ..
            }
        ));
        assert_eq!(
            recorder
                .batches
                .lock()
                .expect("recorder mutex must be available")
                .as_slice(),
            &[IpcLocalChangeBatch {
                hints: vec![IpcLocalChangeHint::Accounts]
            }]
        );
    }

    #[test]
    fn read_handler_preserves_owner_absent_and_not_cached() {
        let db = TempDb::new();
        let engine = PersistentLocalEngine::open(&db.0, KEY).expect("encrypted engine opens");
        let request = IpcEmailIdRequest {
            email_id: IpcScopedEmailId {
                account_key: "account-a".into(),
                jmap_email_id: "email-a".into(),
            },
        };
        assert!(matches!(
            read_email_body(&engine, request.clone()),
            IpcResult::Ok {
                value: IpcOwnedCache::OwnerAbsent,
                ..
            }
        ));

        engine
            .register_account(&account("account-a", "remote-a").account.into())
            .expect("account registration succeeds");
        engine
            .apply_collection_sync(&semantic::CollectionSyncCommit::EmailReplace {
                expected: semantic::CursorPrecondition::Absent,
                next: semantic::CollectionSyncCursor {
                    account_key: "account-a".into(),
                    data_type: semantic::CollectionDataType::Email,
                    state: "state-a".into(),
                },
                snapshot: vec![semantic::EmailSyncRecord {
                    email: semantic::Email {
                        account_key: "account-a".into(),
                        jmap_id: "email-a".into(),
                        blob_id: "blob-a".into(),
                        thread_id: "thread-a".into(),
                        sender: None,
                        from: Some(vec![]),
                        reply_to: None,
                        to: Some(vec![]),
                        cc: None,
                        bcc: Some(vec![]),
                        subject: None,
                        sent_at: None,
                        received_at: "2026-08-20T12:00:00Z".into(),
                        size: 0,
                        preview: "".into(),
                        has_attachment: false,
                        keywords: Vec::new(),
                    },
                    memberships: vec![],
                }],
            })
            .expect("email collection materialization succeeds");
        assert!(matches!(
            read_email_body(&engine, request),
            IpcResult::Ok {
                value: IpcOwnedCache::NotCached,
                ..
            }
        ));
    }

    #[test]
    fn conflict_emits_nothing_and_event_failure_does_not_change_success() {
        let db = TempDb::new();
        let engine = PersistentLocalEngine::open(&db.0, KEY).expect("encrypted engine opens");
        let recorder = Recorder::default();
        register_account(&engine, &recorder, account("account-a", "remote-a"));
        let before = recorder
            .batches
            .lock()
            .expect("recorder mutex must be available")
            .len();
        assert!(matches!(
            register_account(&engine, &recorder, account("account-a", "remote-b")),
            IpcResult::Error {
                error: IpcError {
                    kind: IpcWriteErrorKind::Conflict
                },
                ..
            }
        ));
        assert_eq!(
            recorder
                .batches
                .lock()
                .expect("recorder mutex must be available")
                .len(),
            before
        );

        let failing = Recorder {
            fail: true,
            ..Recorder::default()
        };
        assert!(matches!(
            register_account(&engine, &failing, account("account-b", "remote-b")),
            IpcResult::Ok { .. }
        ));
        assert!(matches!(
            engine.read_account("account-b").expect("read succeeds"),
            semantic::LocalEntity::Present(_)
        ));
    }

    #[test]
    fn collection_and_mutation_event_maps_are_exact() {
        fn cursor(data_type: IpcCollectionDataType) -> IpcCollectionSyncCursor {
            IpcCollectionSyncCursor {
                account_key: "account-a".into(),
                data_type,
                state: "next".into(),
            }
        }
        let email = IpcCollectionSyncCommit::Email {
            commit: IpcEmailCollectionCommit::Replace {
                expected_cursor: IpcCursorPrecondition::Absent,
                next_cursor: cursor(IpcCollectionDataType::Email),
                snapshot: vec![],
            },
        };
        let mailbox = IpcCollectionSyncCommit::Mailbox {
            commit: IpcMailboxCollectionCommit::Replace {
                expected_cursor: IpcCursorPrecondition::Absent,
                next_cursor: cursor(IpcCollectionDataType::Mailbox),
                snapshot: vec![],
            },
        };
        let identity = IpcCollectionSyncCommit::Identity {
            commit: IpcIdentityCollectionCommit::Replace {
                expected_cursor: IpcCursorPrecondition::Absent,
                next_cursor: cursor(IpcCollectionDataType::Identity),
                snapshot: vec![],
            },
        };
        assert_eq!(
            collection_hints(&email),
            vec![
                IpcLocalChangeHint::Emails {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::EmailMemberships {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::SyncCursor {
                    account_key: "account-a".into(),
                    data_type: IpcCollectionDataType::Email
                }
            ]
        );
        assert_eq!(
            collection_hints(&mailbox),
            vec![
                IpcLocalChangeHint::Mailboxes {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::SyncCursor {
                    account_key: "account-a".into(),
                    data_type: IpcCollectionDataType::Mailbox
                }
            ]
        );
        assert_eq!(
            collection_hints(&identity),
            vec![
                IpcLocalChangeHint::Identities {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::SyncCursor {
                    account_key: "account-a".into(),
                    data_type: IpcCollectionDataType::Identity
                }
            ]
        );
        assert_eq!(
            mutation_hints(MutationWrite::Send, "account-a".into()),
            vec![IpcLocalChangeHint::PendingMutations {
                account_key: "account-a".into()
            }]
        );
        assert_eq!(
            mutation_hints(MutationWrite::Keyword, "account-a".into()),
            vec![
                IpcLocalChangeHint::Emails {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::PendingMutations {
                    account_key: "account-a".into()
                }
            ]
        );
        assert_eq!(
            mutation_hints(MutationWrite::Membership, "account-a".into()),
            vec![
                IpcLocalChangeHint::EmailMemberships {
                    account_key: "account-a".into()
                },
                IpcLocalChangeHint::PendingMutations {
                    account_key: "account-a".into()
                }
            ]
        );
    }
}
fn mutation_write(
    request: IpcMutationRequest,
    state: State<'_, ManagedLocalEngine>,
    app: AppHandle,
    kind: MutationWrite,
) -> IpcWriteResult {
    let Some(e) = engine(&state) else {
        return unavailable_write();
    };
    if let Err(error) = validate_mutation_scope(&request.mutation) {
        return write_error(error);
    }
    let account = request.mutation.account_key().to_owned();
    let mutation: semantic::PendingMutation = request.mutation.into();
    let result = match kind {
        MutationWrite::Send => e.stage_send_mutation(&mutation),
        MutationWrite::Keyword => e.apply_optimistic_keyword_mutation(&mutation),
        MutationWrite::Membership => e.apply_optimistic_mailbox_membership_mutation(&mutation),
    };
    write_leased(&e, result, &app, mutation_hints(kind, account))
}

fn mutation_hints(kind: MutationWrite, account: String) -> Vec<IpcLocalChangeHint> {
    let mut hints = match kind {
        MutationWrite::Send => vec![],
        MutationWrite::Keyword => vec![IpcLocalChangeHint::Emails {
            account_key: account.clone(),
        }],
        MutationWrite::Membership => vec![IpcLocalChangeHint::EmailMemberships {
            account_key: account.clone(),
        }],
    };
    hints.push(IpcLocalChangeHint::PendingMutations {
        account_key: account,
    });
    hints
}

fn collection_hints(commit: &IpcCollectionSyncCommit) -> Vec<IpcLocalChangeHint> {
    let (account, kind) = commit.account_and_type();
    let mut result = match kind {
        IpcCollectionDataType::Email => vec![
            IpcLocalChangeHint::Emails {
                account_key: account.clone(),
            },
            IpcLocalChangeHint::EmailMemberships {
                account_key: account.clone(),
            },
        ],
        IpcCollectionDataType::Mailbox => vec![IpcLocalChangeHint::Mailboxes {
            account_key: account.clone(),
        }],
        IpcCollectionDataType::Identity => vec![IpcLocalChangeHint::Identities {
            account_key: account.clone(),
        }],
    };
    result.push(IpcLocalChangeHint::SyncCursor {
        account_key: account,
        data_type: kind,
    });
    result
}

pub trait MutationDtoExt {
    fn account_key(&self) -> &str;
}
impl MutationDtoExt for IpcPendingMutation {
    fn account_key(&self) -> &str {
        match self {
            Self::Send { account_key, .. }
            | Self::Keyword { account_key, .. }
            | Self::MailboxMembership { account_key, .. } => account_key,
        }
    }
}
trait CasRequestExt {
    fn expected_account(&self) -> String;
}
impl CasRequestExt for IpcMutationCasRequest {
    fn expected_account(&self) -> String {
        self.expected.account_key().into()
    }
}
trait CommitExt {
    fn account_and_type(&self) -> (String, IpcCollectionDataType);
}
impl CommitExt for IpcCollectionSyncCommit {
    fn account_and_type(&self) -> (String, IpcCollectionDataType) {
        match self {
            Self::Email { commit } => match commit {
                IpcEmailCollectionCommit::Delta { next_cursor, .. }
                | IpcEmailCollectionCommit::Replace { next_cursor, .. } => (
                    next_cursor.account_key.clone(),
                    IpcCollectionDataType::Email,
                ),
            },
            Self::Mailbox { commit } => match commit {
                IpcMailboxCollectionCommit::Delta { next_cursor, .. }
                | IpcMailboxCollectionCommit::Replace { next_cursor, .. } => (
                    next_cursor.account_key.clone(),
                    IpcCollectionDataType::Mailbox,
                ),
            },
            Self::Identity { commit } => match commit {
                IpcIdentityCollectionCommit::Delta { next_cursor, .. }
                | IpcIdentityCollectionCommit::Replace { next_cursor, .. } => (
                    next_cursor.account_key.clone(),
                    IpcCollectionDataType::Identity,
                ),
            },
        }
    }
}
