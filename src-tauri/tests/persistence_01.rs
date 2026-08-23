use std::{
    collections::BTreeSet,
    env, fs,
    path::{Path, PathBuf},
    process,
    sync::{Arc, Barrier},
    thread,
    time::{SystemTime, UNIX_EPOCH},
};

use correo_boxplot_lib::persistence::*;
use rusqlite::Connection;

const KEY: [u8; 32] = [0x2a; 32];
const WRONG_KEY: [u8; 32] = [0x71; 32];

struct TempDb(PathBuf);
impl TempDb {
    fn new(label: &str) -> Self {
        let n = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        Self(env::temp_dir().join(format!("correo-persist01-{label}-{}-{n}.db", process::id())))
    }
}
impl Drop for TempDb {
    fn drop(&mut self) {
        for suffix in ["", "-wal", "-shm", "-journal"] {
            let mut p = self.0.as_os_str().to_os_string();
            p.push(suffix);
            let _ = fs::remove_file(PathBuf::from(p));
        }
    }
}
fn engine(db: &TempDb) -> PersistentLocalEngine {
    PersistentLocalEngine::open(&db.0, KEY).unwrap()
}
fn raw(path: &Path, key: [u8; 32]) -> Connection {
    let c = Connection::open(path).unwrap();
    let hex = key.iter().map(|b| format!("{b:02x}")).collect::<String>();
    c.execute_batch(&format!("PRAGMA key=\"x'{hex}'\";PRAGMA foreign_keys=ON;"))
        .unwrap();
    c
}
fn account(key: &str) -> Account {
    Account {
        key: key.into(),
        service_key: format!("service-{key}"),
        jmap_account_id: "remote-account".into(),
    }
}
fn addresses() -> AddressList {
    Some(vec![Address {
        name: None,
        email: "sender@example.test".into(),
    }])
}
fn email(a: &str, id: &str) -> Email {
    Email {
        account_key: a.into(),
        jmap_id: id.into(),
        blob_id: format!("blob-{id}"),
        thread_id: format!("thread-{id}"),
        sender: addresses(),
        from: Some(vec![]),
        reply_to: None,
        to: Some(vec![]),
        cc: None,
        bcc: Some(vec![]),
        subject: None,
        sent_at: None,
        received_at: "2026-08-20T12:00:00Z".into(),
        size: 12,
        preview: " preview ".into(),
        has_attachment: true,
        keywords: vec!["$seen".into(), "Custom".into()],
    }
}
fn record(a: &str, id: &str, mailboxes: &[&str]) -> EmailSyncRecord {
    EmailSyncRecord {
        email: email(a, id),
        memberships: mailboxes
            .iter()
            .map(|m| EmailMembership {
                account_key: a.into(),
                email_jmap_id: id.into(),
                mailbox_jmap_id: (*m).into(),
            })
            .collect(),
    }
}
fn cursor(a: &str, t: CollectionDataType, state: &str) -> CollectionSyncCursor {
    CollectionSyncCursor {
        account_key: a.into(),
        data_type: t,
        state: state.into(),
    }
}
fn rights() -> MailboxRights {
    MailboxRights {
        may_read_items: true,
        may_add_items: true,
        may_remove_items: true,
        may_set_seen: true,
        may_set_keywords: true,
        may_submit: true,
    }
}
fn mailbox(a: &str, id: &str) -> Mailbox {
    Mailbox {
        account_key: a.into(),
        jmap_id: id.into(),
        name: format!("Mailbox {id}"),
        parent_jmap_id: None,
        role: None,
        sort_order: 0,
        total_emails: 3,
        unread_emails: 1,
        rights: rights(),
    }
}
fn identity(a: &str, id: &str) -> Identity {
    Identity {
        account_key: a.into(),
        jmap_id: id.into(),
        name: "Sender".into(),
        email: "sender@example.test".into(),
        reply_to: None,
        bcc: Some(vec![]),
    }
}
fn pending_send(a: &str, id: &str) -> PendingMutation {
    PendingMutation {
        account_key: a.into(),
        mutation_id: id.into(),
        created_at: "2026-08-20T12:00:00Z".into(),
        payload: MutationPayload::Send(SendIntent {
            identity_jmap_id: "identity-1".into(),
            from: Address {
                name: Some("Sender".into()),
                email: "sender@example.test".into(),
            },
            reply_to: vec![],
            to: vec![Address {
                name: None,
                email: "to@example.test".into(),
            }],
            cc: vec![],
            bcc: vec![],
            subject: "".into(),
            body: SendBody {
                text: "".into(),
                html: None,
            },
        }),
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    }
}

#[test]
fn pdb_mig_fresh_and_reopen_reach_latest_schema() {
    let db = TempDb::new("fresh");
    let e = engine(&db);
    let versions = e.runtime_versions().unwrap();
    assert!(!versions.0.is_empty());
    drop(e);
    let c = raw(&db.0, KEY);
    assert_eq!(
        c.query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    drop(c);
    engine(&db);
}

#[test]
fn pdb_mig_upgrades_real_0001_and_refuses_future_or_legacy_outbox() {
    let db = TempDb::new("legacy");
    let c = raw(&db.0, KEY);
    c.execute_batch(include_str!("../src/db/migrations/0001_initial.sql"))
        .unwrap();
    drop(c);
    engine(&db);
    assert_eq!(
        raw(&db.0, KEY)
            .query_row("PRAGMA user_version", [], |r| r.get::<_, i64>(0))
            .unwrap(),
        3
    );
    let future = TempDb::new("future");
    let c = raw(&future.0, KEY);
    c.execute_batch("PRAGMA user_version=99;").unwrap();
    drop(c);
    assert!(matches!(
        PersistentLocalEngine::open(&future.0, KEY),
        Err(PersistenceError::Migration(_))
    ));
    let outbox = TempDb::new("outbox");
    let c = raw(&outbox.0, KEY);
    c.execute_batch(include_str!("../src/db/migrations/0001_initial.sql"))
        .unwrap();
    c.execute(
        "INSERT INTO accounts(session_url,jmap_account_id)VALUES('s','a')",
        [],
    )
    .unwrap();
    c.execute("INSERT INTO pending_mutations(account_id,kind,payload,created_at_ms,next_attempt_at_ms)VALUES(1,'send',x'00',0,0)",[]).unwrap();
    drop(c);
    assert!(matches!(
        PersistentLocalEngine::open(&outbox.0, KEY),
        Err(PersistenceError::Migration(_))
    ));
}

#[test]
fn pdb_r_presence_null_empty_and_positional_reads() {
    let db = TempDb::new("presence");
    let e = engine(&db);
    assert_eq!(
        e.read_email_body("A", "e").unwrap(),
        OwnedCache::OwnerAbsent
    );
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Email, ""),
        snapshot: vec![record("A", "e1", &[])],
    })
    .unwrap();
    assert_eq!(e.read_email_body("A", "e1").unwrap(), OwnedCache::NotCached);
    e.cache_email_body(&EmailBody {
        account_key: "A".into(),
        email_jmap_id: "e1".into(),
        text: None,
        html: None,
    })
    .unwrap();
    assert!(matches!(
        e.read_email_body("A", "e1").unwrap(),
        OwnedCache::Cached(EmailBody {
            text: None,
            html: None,
            ..
        })
    ));
    assert_eq!(
        e.read_attachment_refs("A", "e1").unwrap(),
        OwnedCache::NotCached
    );
    e.replace_attachment_refs("A", "e1", &[]).unwrap();
    assert_eq!(
        e.read_attachment_refs("A", "e1").unwrap(),
        OwnedCache::Cached(vec![])
    );
    assert_eq!(
        e.read_emails(&[
            ("A".into(), "missing".into()),
            ("A".into(), "e1".into()),
            ("A".into(), "e1".into())
        ])
        .unwrap()
        .len(),
        3
    );
    assert!(
        matches!(e.read_collection_sync_cursor("A",CollectionDataType::Email).unwrap(),OwnedOptional::Present(CollectionSyncCursor{state,..}) if state.is_empty())
    );
}

#[test]
fn pdb_col_email_delta_replace_are_atomic_and_preserve_lazy_caches_and_views() {
    let db = TempDb::new("collection");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Mailbox, "m1"),
        snapshot: vec![mailbox("A", "inbox")],
    })
    .unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Email, "e1"),
        snapshot: vec![record("A", "e", &["not-materialized"])],
    })
    .unwrap();
    e.cache_email_body(&EmailBody {
        account_key: "A".into(),
        email_jmap_id: "e".into(),
        text: Some("".into()),
        html: Some("<b>x</b>".into()),
    })
    .unwrap();
    let attachment = AttachmentRef {
        account_key: "A".into(),
        email_jmap_id: "e".into(),
        part_id: "1".into(),
        blob_id: "blob".into(),
        name: None,
        media_type: "image/png".into(),
        size: 0,
        disposition: Some("".into()),
        cid: Some("".into()),
    };
    e.replace_attachment_refs("A", "e", std::slice::from_ref(&attachment))
        .unwrap();
    let view = MailboxView {
        spec: MailboxViewSpec {
            account_key: "A".into(),
            mailbox_jmap_id: "inbox".into(),
            filter_kind: "all".into(),
            sort_property: "receivedAt".into(),
            sort_direction: "descending".into(),
        },
        query_state: "q1".into(),
        total: 1,
        coverage: vec![CoverageRange {
            start: 0,
            end_exclusive: 1,
        }],
        items: vec![ViewItem {
            position: 0,
            email_jmap_id: "e".into(),
        }],
    };
    e.replace_mailbox_view(&view).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Matches(cursor("A", CollectionDataType::Mailbox, "m1")),
        next: cursor("A", CollectionDataType::Mailbox, "m2"),
        snapshot: vec![mailbox("A", "inbox")],
    })
    .unwrap();
    assert_eq!(
        e.read_mailbox_view(&view.spec).unwrap(),
        OwnedCache::Cached(view.clone())
    );
    e.apply_collection_sync(&CollectionSyncCommit::EmailDelta {
        expected: cursor("A", CollectionDataType::Email, "e1"),
        next: cursor("A", CollectionDataType::Email, "e2"),
        changed: vec![record("A", "e", &[])],
        destroyed: vec![],
    })
    .unwrap();
    assert!(matches!(
        e.read_email_body("A", "e").unwrap(),
        OwnedCache::Cached(_)
    ));
    assert_eq!(
        e.read_attachment_refs("A", "e").unwrap(),
        OwnedCache::Cached(vec![attachment])
    );
    assert_eq!(
        e.read_mailbox_view(&view.spec).unwrap(),
        OwnedCache::Cached(view.clone())
    );
    e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
        expected: CursorPrecondition::Matches(cursor("A", CollectionDataType::Email, "e2")),
        next: cursor("A", CollectionDataType::Email, "e3"),
        snapshot: vec![record("A", "e", &[])],
    })
    .unwrap();
    assert!(matches!(
        e.read_email_body("A", "e").unwrap(),
        OwnedCache::Cached(_)
    ));
    let before = e.read_email("A", "e").unwrap();
    assert!(matches!(
        e.apply_collection_sync(&CollectionSyncCommit::EmailDelta {
            expected: cursor("A", CollectionDataType::Email, "stale"),
            next: cursor("A", CollectionDataType::Email, "bad"),
            changed: vec![],
            destroyed: vec!["e".into()]
        }),
        Err(PersistenceError::Conflict)
    ));
    assert_eq!(e.read_email("A", "e").unwrap(), before);
    assert!(
        matches!(e.read_collection_sync_cursor("A",CollectionDataType::Email).unwrap(),OwnedOptional::Present(CollectionSyncCursor{state,..}) if state=="e3")
    );
}

#[test]
fn pdb_col_mailbox_identity_and_distinct_views_round_trip() {
    let db = TempDb::new("collections2");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Mailbox, ""),
        snapshot: vec![mailbox("A", "one"), mailbox("A", "two")],
    })
    .unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::IdentityReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Identity, "i1"),
        snapshot: vec![identity("A", "id")],
    })
    .unwrap();
    assert!(matches!(e.list_mailboxes("A").unwrap(),OwnedSnapshot::Present(v) if v.len()==2));
    assert!(matches!(e.list_identities("A").unwrap(),OwnedSnapshot::Present(v) if v.len()==1));
    for (mb, dir) in [
        ("one", "ascending"),
        ("one", "descending"),
        ("two", "ascending"),
    ] {
        e.replace_mailbox_view(&MailboxView {
            spec: MailboxViewSpec {
                account_key: "A".into(),
                mailbox_jmap_id: mb.into(),
                filter_kind: "all".into(),
                sort_property: "receivedAt".into(),
                sort_direction: dir.into(),
            },
            query_state: format!("q-{mb}-{dir}"),
            total: 0,
            coverage: vec![],
            items: vec![],
        })
        .unwrap();
    }
    drop(e);
    let reopened = engine(&db);
    assert!(matches!(
        reopened
            .read_mailbox_view(&MailboxViewSpec {
                account_key: "A".into(),
                mailbox_jmap_id: "one".into(),
                filter_kind: "all".into(),
                sort_property: "receivedAt".into(),
                sort_direction: "descending".into()
            })
            .unwrap(),
        OwnedCache::Cached(_)
    ));
}

#[test]
fn pdb_col_mailbox_parent_need_not_be_materialized() {
    let db = TempDb::new("mailbox-parent");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    let mut child = mailbox("A", "child");
    child.parent_jmap_id = Some("remote-parent-not-cached".into());

    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Mailbox, "m1"),
        snapshot: vec![child.clone()],
    })
    .unwrap();

    assert_eq!(
        e.read_mailbox("A", "child").unwrap(),
        LocalEntity::Present(child)
    );
}

#[test]
fn pdb_mut_optimistic_writes_cas_and_restart_are_durable() {
    let db = TempDb::new("mut");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Mailbox, "m"),
        snapshot: vec![mailbox("A", "inbox"), mailbox("A", "archive")],
    })
    .unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Email, "e"),
        snapshot: vec![record("A", "e", &["inbox"])],
    })
    .unwrap();
    let km = PendingMutation {
        account_key: "A".into(),
        mutation_id: "k".into(),
        created_at: "now".into(),
        payload: MutationPayload::Keyword {
            email_jmap_id: "e".into(),
            change: KeywordChange {
                add: BTreeSet::from(["$flagged".into()]),
                remove: BTreeSet::from(["$seen".into()]),
            },
        },
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    };
    e.apply_optimistic_keyword_mutation(&km).unwrap();
    let mut keyword_in_flight = km.clone();
    keyword_in_flight.lifecycle = MutationLifecycle::InFlight { attempt_count: 1 };
    e.replace_pending_mutation_if_current(&km, &keyword_in_flight)
        .unwrap();
    let mut keyword_confirmed = keyword_in_flight.clone();
    keyword_confirmed.lifecycle = MutationLifecycle::Confirmed {
        attempt_count: 1,
        confirmation_email_jmap_id: None,
    };
    e.replace_pending_mutation_if_current(&keyword_in_flight, &keyword_confirmed)
        .unwrap();
    let Email { keywords, .. } = match e.read_email("A", "e").unwrap() {
        LocalEntity::Present(v) => v,
        _ => panic!(),
    };
    assert_eq!(
        keywords,
        vec![String::from("Custom"), String::from("$flagged")]
    );
    let mm = PendingMutation {
        account_key: "A".into(),
        mutation_id: "m".into(),
        created_at: "now".into(),
        payload: MutationPayload::MailboxMembership {
            email_jmap_id: "e".into(),
            change: MembershipChange {
                add: vec!["archive".into()],
                remove: vec!["inbox".into()],
            },
        },
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    };
    e.apply_optimistic_mailbox_membership_mutation(&mm).unwrap();
    assert!(
        matches!(e.read_email_memberships("A","e").unwrap(),OwnedSnapshot::Present(v) if v[0].mailbox_jmap_id=="archive")
    );
    let mut next = pending_send("A", "send");
    e.stage_send_mutation(&next).unwrap();
    let expected = next.clone();
    next.lifecycle = MutationLifecycle::InFlight { attempt_count: 1 };
    e.replace_pending_mutation_if_current(&expected, &next)
        .unwrap();
    assert!(matches!(
        e.replace_pending_mutation_if_current(&expected, &next),
        Err(PersistenceError::Conflict)
    ));
    drop(e);
    let reopened = engine(&db);
    assert!(matches!(
        reopened.read_pending_mutation("A", "send").unwrap(),
        OwnedOptional::Present(PendingMutation {
            lifecycle: MutationLifecycle::InFlight { .. },
            ..
        })
    ));
}

#[test]
fn pdb_cas_concurrent_claim_has_one_winner() {
    let db = TempDb::new("cas");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    let expected = pending_send("A", "send");
    e.stage_send_mutation(&expected).unwrap();
    let mut next = expected.clone();
    next.lifecycle = MutationLifecycle::InFlight { attempt_count: 1 };
    let barrier = Arc::new(Barrier::new(3));
    let mut joins = vec![];
    for _ in 0..2 {
        let path = db.0.clone();
        let b = barrier.clone();
        let x = expected.clone();
        let n = next.clone();
        joins.push(thread::spawn(move || {
            let e = PersistentLocalEngine::open(path, KEY).unwrap();
            b.wait();
            e.replace_pending_mutation_if_current(&x, &n)
        }));
    }
    barrier.wait();
    let results = joins
        .into_iter()
        .map(|j| j.join().unwrap())
        .collect::<Vec<_>>();
    assert_eq!(results.iter().filter(|r| r.is_ok()).count(), 1);
    assert_eq!(
        results
            .iter()
            .filter(|r| matches!(r, Err(PersistenceError::Conflict)))
            .count(),
        1
    );
}

#[test]
fn pdb_enc_wrong_key_header_and_reopen() {
    let db = TempDb::new("enc");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    drop(e);
    let bytes = fs::read(&db.0).unwrap();
    assert_ne!(&bytes[..16], b"SQLite format 3\0");
    assert!(PersistentLocalEngine::open(&db.0, WRONG_KEY).is_err());
    assert!(matches!(
        engine(&db).read_account("A").unwrap(),
        LocalEntity::Present(_)
    ));
}

#[test]
fn pdb_cor_invalid_json_is_corrupt_state() {
    let db = TempDb::new("corrupt");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::IdentityReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Identity, "i"),
        snapshot: vec![identity("A", "id")],
    })
    .unwrap();
    drop(e);
    let c = raw(&db.0, KEY);
    c.execute(
        "UPDATE identities SET reply_to_json='{bad' WHERE account_key='A' AND jmap_id='id'",
        [],
    )
    .unwrap();
    drop(c);
    assert!(matches!(
        engine(&db).read_identity("A", "id"),
        Err(PersistenceError::CorruptState(_))
    ));
}

#[test]
fn pdb_multi_account_same_remote_ids_and_same_blob_parts_remain_distinct() {
    let db = TempDb::new("scope");
    let e = engine(&db);
    for a in ["A", "B"] {
        e.register_account(&account(a)).unwrap();
        e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
            expected: CursorPrecondition::Absent,
            next: cursor(a, CollectionDataType::Email, "s"),
            snapshot: vec![record(a, "same", &[])],
        })
        .unwrap();
    }
    let refs = [
        AttachmentRef {
            account_key: "A".into(),
            email_jmap_id: "same".into(),
            part_id: "1".into(),
            blob_id: "shared".into(),
            name: None,
            media_type: "image/png".into(),
            size: 1,
            disposition: None,
            cid: None,
        },
        AttachmentRef {
            account_key: "A".into(),
            email_jmap_id: "same".into(),
            part_id: "2".into(),
            blob_id: "shared".into(),
            name: None,
            media_type: "image/png".into(),
            size: 1,
            disposition: None,
            cid: None,
        },
    ];
    e.replace_attachment_refs("A", "same", &refs).unwrap();
    drop(e);
    let reopened = engine(&db);
    assert!(matches!(
        reopened.read_email("A", "same").unwrap(),
        LocalEntity::Present(_)
    ));
    assert!(matches!(
        reopened.read_email("B", "same").unwrap(),
        LocalEntity::Present(_)
    ));
    assert_eq!(
        reopened.read_attachment_refs("A", "same").unwrap(),
        OwnedCache::Cached(refs.to_vec())
    );
}

#[test]
fn pdb_mut_all_lifecycles_round_trip_and_terminal_removal_rules() {
    let db = TempDb::new("lifecycles");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    for (id, lifecycle) in [
        (
            "retry",
            MutationLifecycle::Retrying {
                attempt_count: 2,
                next_attempt_at: "later".into(),
            },
        ),
        (
            "failed",
            MutationLifecycle::FailedTerminal { attempt_count: 1 },
        ),
        (
            "confirmed",
            MutationLifecycle::Confirmed {
                attempt_count: 1,
                confirmation_email_jmap_id: Some("remote-email".into()),
            },
        ),
    ] {
        let mut m = pending_send("A", id);
        m.lifecycle = lifecycle.clone();
        e.stage_send_mutation(&m).unwrap();
        assert!(
            matches!(e.read_pending_mutation("A",id).unwrap(),OwnedOptional::Present(PendingMutation{lifecycle:stored,..}) if stored==lifecycle)
        );
    }
    assert!(matches!(
        e.remove_confirmed_mutation("A", "failed"),
        Err(PersistenceError::Conflict)
    ));
    e.remove_confirmed_mutation("A", "confirmed").unwrap();
    assert_eq!(
        e.read_pending_mutation("A", "confirmed").unwrap(),
        OwnedOptional::Absent
    );
}

#[test]
fn pdb_txn_membership_conflict_rolls_back_projection_and_mutation() {
    let db = TempDb::new("rollback");
    let e = engine(&db);
    e.register_account(&account("A")).unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::MailboxReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Mailbox, "m"),
        snapshot: vec![mailbox("A", "inbox")],
    })
    .unwrap();
    e.apply_collection_sync(&CollectionSyncCommit::EmailReplace {
        expected: CursorPrecondition::Absent,
        next: cursor("A", CollectionDataType::Email, "e"),
        snapshot: vec![record("A", "e", &["inbox"])],
    })
    .unwrap();
    let mutation = PendingMutation {
        account_key: "A".into(),
        mutation_id: "empty".into(),
        created_at: "now".into(),
        payload: MutationPayload::MailboxMembership {
            email_jmap_id: "e".into(),
            change: MembershipChange {
                add: vec![],
                remove: vec!["inbox".into()],
            },
        },
        lifecycle: MutationLifecycle::Pending { attempt_count: 0 },
    };
    assert!(matches!(
        e.apply_optimistic_mailbox_membership_mutation(&mutation),
        Err(PersistenceError::Conflict)
    ));
    assert!(
        matches!(e.read_email_memberships("A","e").unwrap(),OwnedSnapshot::Present(v) if v.len()==1&&v[0].mailbox_jmap_id=="inbox")
    );
    assert_eq!(
        e.read_pending_mutation("A", "empty").unwrap(),
        OwnedOptional::Absent
    );
}


