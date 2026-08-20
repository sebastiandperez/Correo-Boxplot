use std::collections::{BTreeSet, HashSet};

use rusqlite::{Connection, OptionalExtension, Transaction, params};

use crate::db::EncryptedDatabase;

use super::{
    PersistenceError,
    codecs::{decode, encode},
    model::*,
};

pub struct PersistentLocalEngine {
    database: EncryptedDatabase,
}

impl PersistentLocalEngine {
    pub fn open(path: impl AsRef<std::path::Path>, key: [u8; 32]) -> PersistResult<Self> {
        Ok(Self {
            database: EncryptedDatabase::open(path, key)?,
        })
    }

    pub fn runtime_versions(&self) -> PersistResult<(String, String)> {
        self.database.runtime_versions()
    }

    pub fn register_account(&self, account: &Account) -> PersistResult<()> {
        non_empty(&account.key, "AccountKey")?;
        non_empty(&account.service_key, "ServiceKey")?;
        non_empty(&account.jmap_account_id, "JmapAccountId")?;
        let mut connection = self.database.connect()?;
        let transaction = connection.transaction()?;
        let existing = transaction
            .query_row(
                "SELECT service_key, jmap_account_id FROM accounts WHERE account_key = ?1",
                [&account.key],
                |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
            )
            .optional()?;
        match existing {
            None => {
                transaction.execute("INSERT INTO accounts(account_key, service_key, jmap_account_id) VALUES(?1, ?2, ?3)", params![account.key, account.service_key, account.jmap_account_id])?;
            }
            Some(value)
                if value == (account.service_key.clone(), account.jmap_account_id.clone()) => {}
            Some(_) => return Err(PersistenceError::Conflict),
        }
        transaction.commit()?;
        Ok(())
    }

    pub fn read_account(&self, key: &str) -> PersistResult<LocalEntity<Account>> {
        let connection = self.database.connect()?;
        Ok(connection
            .query_row(
                "SELECT service_key, jmap_account_id FROM accounts WHERE account_key=?1",
                [key],
                |row| {
                    Ok(Account {
                        key: key.into(),
                        service_key: row.get(0)?,
                        jmap_account_id: row.get(1)?,
                    })
                },
            )
            .optional()?
            .map_or(LocalEntity::Absent, LocalEntity::Present))
    }

    pub fn list_accounts(&self) -> PersistResult<Vec<Account>> {
        let connection = self.database.connect()?;
        let mut statement =
            connection.prepare("SELECT account_key, service_key, jmap_account_id FROM accounts")?;
        Ok(statement
            .query_map([], |row| {
                Ok(Account {
                    key: row.get(0)?,
                    service_key: row.get(1)?,
                    jmap_account_id: row.get(2)?,
                })
            })?
            .collect::<Result<_, _>>()?)
    }

    pub fn read_mailbox(&self, account: &str, id: &str) -> PersistResult<LocalEntity<Mailbox>> {
        let connection = self.database.connect()?;
        Ok(read_mailbox_row(&connection, account, id)?
            .map_or(LocalEntity::Absent, LocalEntity::Present))
    }
    pub fn list_mailboxes(&self, account: &str) -> PersistResult<OwnedSnapshot<Vec<Mailbox>>> {
        let connection = self.database.connect()?;
        if !account_exists(&connection, account)? {
            return Ok(OwnedSnapshot::OwnerAbsent);
        }
        let mut statement = connection
            .prepare("SELECT jmap_id FROM mailboxes WHERE account_key=?1 ORDER BY jmap_id")?;
        let ids = statement
            .query_map([account], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        let values = ids
            .into_iter()
            .map(|id| {
                read_mailbox_row(&connection, account, &id)?.ok_or_else(|| {
                    PersistenceError::CorruptState("mailbox disappeared during read".into())
                })
            })
            .collect::<PersistResult<Vec<_>>>()?;
        Ok(OwnedSnapshot::Present(values))
    }
    pub fn read_identity(&self, account: &str, id: &str) -> PersistResult<LocalEntity<Identity>> {
        let connection = self.database.connect()?;
        Ok(read_identity_row(&connection, account, id)?
            .map_or(LocalEntity::Absent, LocalEntity::Present))
    }
    pub fn list_identities(&self, account: &str) -> PersistResult<OwnedSnapshot<Vec<Identity>>> {
        let connection = self.database.connect()?;
        if !account_exists(&connection, account)? {
            return Ok(OwnedSnapshot::OwnerAbsent);
        }
        let mut statement = connection
            .prepare("SELECT jmap_id FROM identities WHERE account_key=?1 ORDER BY jmap_id")?;
        let ids = statement
            .query_map([account], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(OwnedSnapshot::Present(
            ids.into_iter()
                .map(|id| {
                    read_identity_row(&connection, account, &id)?.ok_or_else(|| {
                        PersistenceError::CorruptState("identity disappeared during read".into())
                    })
                })
                .collect::<PersistResult<Vec<_>>>()?,
        ))
    }
    pub fn read_email(&self, account: &str, id: &str) -> PersistResult<LocalEntity<Email>> {
        let connection = self.database.connect()?;
        Ok(read_email_row(&connection, account, id)?
            .map_or(LocalEntity::Absent, LocalEntity::Present))
    }
    pub fn read_emails(&self, ids: &[(String, String)]) -> PersistResult<Vec<LocalEntity<Email>>> {
        let connection = self.database.connect()?;
        ids.iter()
            .map(|(a, id)| {
                Ok(read_email_row(&connection, a, id)?
                    .map_or(LocalEntity::Absent, LocalEntity::Present))
            })
            .collect()
    }

    pub fn read_email_memberships(
        &self,
        account: &str,
        email: &str,
    ) -> PersistResult<OwnedSnapshot<Vec<EmailMembership>>> {
        let connection = self.database.connect()?;
        if !email_exists(&connection, account, email)? {
            return Ok(OwnedSnapshot::OwnerAbsent);
        }
        let mut statement = connection.prepare("SELECT mailbox_jmap_id FROM email_mailboxes WHERE account_key=?1 AND email_jmap_id=?2 ORDER BY mailbox_jmap_id")?;
        let values = statement
            .query_map(params![account, email], |r| {
                Ok(EmailMembership {
                    account_key: account.into(),
                    email_jmap_id: email.into(),
                    mailbox_jmap_id: r.get(0)?,
                })
            })?
            .collect::<Result<_, _>>()?;
        Ok(OwnedSnapshot::Present(values))
    }
    pub fn read_email_body(
        &self,
        account: &str,
        email: &str,
    ) -> PersistResult<OwnedCache<EmailBody>> {
        let connection = self.database.connect()?;
        if !email_exists(&connection, account, email)? {
            return Ok(OwnedCache::OwnerAbsent);
        }
        Ok(connection.query_row("SELECT text_body, html_body FROM email_bodies WHERE account_key=?1 AND email_jmap_id=?2", params![account,email], |r| Ok(EmailBody { account_key: account.into(), email_jmap_id: email.into(), text:r.get(0)?, html:r.get(1)? })).optional()?.map_or(OwnedCache::NotCached, OwnedCache::Cached))
    }
    pub fn read_attachment_refs(
        &self,
        account: &str,
        email: &str,
    ) -> PersistResult<OwnedCache<Vec<AttachmentRef>>> {
        let connection = self.database.connect()?;
        if !email_exists(&connection, account, email)? {
            return Ok(OwnedCache::OwnerAbsent);
        }
        let materialized = connection
            .query_row(
                "SELECT 1 FROM attachment_caches WHERE account_key=?1 AND email_jmap_id=?2",
                params![account, email],
                |_| Ok(()),
            )
            .optional()?
            .is_some();
        if !materialized {
            return Ok(OwnedCache::NotCached);
        }
        let mut statement = connection.prepare("SELECT part_id,blob_id,name,media_type,size,disposition,cid FROM attachment_refs WHERE account_key=?1 AND email_jmap_id=?2 ORDER BY part_id")?;
        let values = statement
            .query_map(params![account, email], |r| {
                Ok(AttachmentRef {
                    account_key: account.into(),
                    email_jmap_id: email.into(),
                    part_id: r.get(0)?,
                    blob_id: r.get(1)?,
                    name: r.get(2)?,
                    media_type: r.get(3)?,
                    size: decode_u64(r.get::<_, i64>(4)?)?,
                    disposition: r.get(5)?,
                    cid: r.get(6)?,
                })
            })?
            .collect::<Result<Vec<_>, _>>()?;
        for value in &values {
            validate_attachment(value)?;
        }
        Ok(OwnedCache::Cached(values))
    }
    pub fn read_mailbox_view(
        &self,
        spec: &MailboxViewSpec,
    ) -> PersistResult<OwnedCache<MailboxView>> {
        let connection = self.database.connect()?;
        if !mailbox_exists(&connection, &spec.account_key, &spec.mailbox_jmap_id)? {
            return Ok(OwnedCache::OwnerAbsent);
        }
        match read_view(&connection, spec)? {
            Some(v) => Ok(OwnedCache::Cached(v)),
            None => Ok(OwnedCache::NotCached),
        }
    }
    pub fn read_collection_sync_cursor(
        &self,
        account: &str,
        data_type: CollectionDataType,
    ) -> PersistResult<OwnedOptional<CollectionSyncCursor>> {
        let connection = self.database.connect()?;
        if !account_exists(&connection, account)? {
            return Ok(OwnedOptional::OwnerAbsent);
        }
        Ok(connection
            .query_row(
                "SELECT state FROM sync_cursors WHERE account_key=?1 AND data_type=?2",
                params![account, data_type.as_str()],
                |r| {
                    Ok(CollectionSyncCursor {
                        account_key: account.into(),
                        data_type,
                        state: r.get(0)?,
                    })
                },
            )
            .optional()?
            .map_or(OwnedOptional::Absent, OwnedOptional::Present))
    }
    pub fn read_pending_mutation(
        &self,
        account: &str,
        id: &str,
    ) -> PersistResult<OwnedOptional<PendingMutation>> {
        let connection = self.database.connect()?;
        if !account_exists(&connection, account)? {
            return Ok(OwnedOptional::OwnerAbsent);
        }
        Ok(read_mutation(&connection, account, id)?
            .map_or(OwnedOptional::Absent, OwnedOptional::Present))
    }
    pub fn list_pending_mutations(
        &self,
        account: &str,
    ) -> PersistResult<OwnedSnapshot<Vec<PendingMutation>>> {
        let connection = self.database.connect()?;
        if !account_exists(&connection, account)? {
            return Ok(OwnedSnapshot::OwnerAbsent);
        }
        let mut s = connection.prepare(
            "SELECT mutation_id FROM pending_mutations WHERE account_key=?1 ORDER BY mutation_id",
        )?;
        let ids = s
            .query_map([account], |r| r.get::<_, String>(0))?
            .collect::<Result<Vec<_>, _>>()?;
        Ok(OwnedSnapshot::Present(
            ids.into_iter()
                .map(|id| {
                    read_mutation(&connection, account, &id)?.ok_or_else(|| {
                        PersistenceError::CorruptState("mutation disappeared".into())
                    })
                })
                .collect::<PersistResult<Vec<_>>>()?,
        ))
    }

    pub fn cache_email_body(&self, body: &EmailBody) -> PersistResult<()> {
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !email_exists(&tx, &body.account_key, &body.email_jmap_id)? {
            return Err(PersistenceError::Conflict);
        }
        tx.execute("INSERT INTO email_bodies(account_key,email_jmap_id,text_body,html_body)VALUES(?1,?2,?3,?4) ON CONFLICT(account_key,email_jmap_id) DO UPDATE SET text_body=excluded.text_body,html_body=excluded.html_body",params![body.account_key,body.email_jmap_id,body.text,body.html])?;
        tx.commit()?;
        Ok(())
    }
    pub fn replace_attachment_refs(
        &self,
        account: &str,
        email: &str,
        refs: &[AttachmentRef],
    ) -> PersistResult<()> {
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !email_exists(&tx, account, email)? {
            return Err(PersistenceError::Conflict);
        }
        let mut parts = HashSet::new();
        for r in refs {
            if r.account_key != account || r.email_jmap_id != email || !parts.insert(&r.part_id) {
                return Err(PersistenceError::Conflict);
            }
            validate_attachment(r).map_err(|_| PersistenceError::Conflict)?;
        }
        tx.execute(
            "INSERT OR IGNORE INTO attachment_caches(account_key,email_jmap_id)VALUES(?1,?2)",
            params![account, email],
        )?;
        tx.execute(
            "DELETE FROM attachment_refs WHERE account_key=?1 AND email_jmap_id=?2",
            params![account, email],
        )?;
        for r in refs {
            tx.execute(
                "INSERT INTO attachment_refs VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
                params![
                    r.account_key,
                    r.email_jmap_id,
                    r.part_id,
                    r.blob_id,
                    r.name,
                    r.media_type,
                    to_i64(r.size)?,
                    r.disposition,
                    r.cid
                ],
            )?;
        }
        tx.commit()?;
        Ok(())
    }
    pub fn replace_mailbox_view(&self, view: &MailboxView) -> PersistResult<()> {
        validate_view(view).map_err(|_| PersistenceError::Conflict)?;
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !mailbox_exists(&tx, &view.spec.account_key, &view.spec.mailbox_jmap_id)? {
            return Err(PersistenceError::Conflict);
        }
        write_view(&tx, view)?;
        tx.commit()?;
        Ok(())
    }
    pub fn stage_send_mutation(&self, m: &PendingMutation) -> PersistResult<()> {
        if !matches!(m.payload, MutationPayload::Send(_)) {
            return Err(PersistenceError::Conflict);
        }
        self.insert_mutation_only(m)
    }
    fn insert_mutation_only(&self, m: &PendingMutation) -> PersistResult<()> {
        validate_mutation(m).map_err(|_| PersistenceError::Conflict)?;
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !account_exists(&tx, &m.account_key)?
            || mutation_exists(&tx, &m.account_key, &m.mutation_id)?
        {
            return Err(PersistenceError::Conflict);
        }
        insert_mutation(&tx, m)?;
        tx.commit()?;
        Ok(())
    }

    pub fn apply_collection_sync(&self, commit: &CollectionSyncCommit) -> PersistResult<()> {
        let mut connection = self.database.connect()?;
        let tx = connection.transaction()?;
        let (account, kind, expected, next) = match commit {
            CollectionSyncCommit::EmailDelta { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Email,
                CursorPrecondition::Matches(expected.clone()),
                next,
            ),
            CollectionSyncCommit::EmailReplace { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Email,
                expected.clone(),
                next,
            ),
            CollectionSyncCommit::MailboxDelta { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Mailbox,
                CursorPrecondition::Matches(expected.clone()),
                next,
            ),
            CollectionSyncCommit::MailboxReplace { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Mailbox,
                expected.clone(),
                next,
            ),
            CollectionSyncCommit::IdentityDelta { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Identity,
                CursorPrecondition::Matches(expected.clone()),
                next,
            ),
            CollectionSyncCommit::IdentityReplace { expected, next, .. } => (
                next.account_key.as_str(),
                CollectionDataType::Identity,
                expected.clone(),
                next,
            ),
        };
        if !account_exists(&tx, account)?
            || next.data_type != kind
            || !cursor_matches(&tx, account, kind, &expected)?
        {
            return Err(PersistenceError::Conflict);
        }
        match commit {
            CollectionSyncCommit::EmailDelta {
                changed, destroyed, ..
            } => apply_email_delta(&tx, account, changed, destroyed)?,
            CollectionSyncCommit::EmailReplace { snapshot, .. } => {
                apply_email_replace(&tx, account, snapshot)?
            }
            CollectionSyncCommit::MailboxDelta {
                changed, destroyed, ..
            } => apply_mailbox_delta(&tx, account, changed, destroyed)?,
            CollectionSyncCommit::MailboxReplace { snapshot, .. } => {
                apply_mailbox_replace(&tx, account, snapshot)?
            }
            CollectionSyncCommit::IdentityDelta {
                changed, destroyed, ..
            } => apply_identity_delta(&tx, account, changed, destroyed)?,
            CollectionSyncCommit::IdentityReplace { snapshot, .. } => {
                apply_identity_replace(&tx, account, snapshot)?
            }
        }
        tx.execute("INSERT INTO sync_cursors(account_key,data_type,state)VALUES(?1,?2,?3) ON CONFLICT(account_key,data_type) DO UPDATE SET state=excluded.state",params![account,kind.as_str(),next.state])?;
        tx.commit()?;
        Ok(())
    }

    pub fn apply_optimistic_keyword_mutation(&self, m: &PendingMutation) -> PersistResult<()> {
        let MutationPayload::Keyword {
            email_jmap_id,
            change,
        } = &m.payload
        else {
            return Err(PersistenceError::Conflict);
        };
        validate_mutation(m).map_err(|_| PersistenceError::Conflict)?;
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !account_exists(&tx, &m.account_key)?
            || mutation_exists(&tx, &m.account_key, &m.mutation_id)?
        {
            return Err(PersistenceError::Conflict);
        }
        let Some(mut email) = read_email_row(&tx, &m.account_key, email_jmap_id)? else {
            return Err(PersistenceError::Conflict);
        };
        for k in &change.remove {
            email.keywords.retain(|value| value != k);
        }
        for k in &change.add {
            if !email.keywords.contains(k) {
                email.keywords.push(k.clone());
            }
        }
        write_email(&tx, &email)?;
        insert_mutation(&tx, m)?;
        tx.commit()?;
        Ok(())
    }

    pub fn apply_optimistic_mailbox_membership_mutation(
        &self,
        m: &PendingMutation,
    ) -> PersistResult<()> {
        let MutationPayload::MailboxMembership {
            email_jmap_id,
            change,
        } = &m.payload
        else {
            return Err(PersistenceError::Conflict);
        };
        validate_mutation(m).map_err(|_| PersistenceError::Conflict)?;
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        if !account_exists(&tx, &m.account_key)?
            || !email_exists(&tx, &m.account_key, email_jmap_id)?
            || mutation_exists(&tx, &m.account_key, &m.mutation_id)?
        {
            return Err(PersistenceError::Conflict);
        }
        for id in change.add.iter().chain(change.remove.iter()) {
            if !mailbox_exists(&tx, &m.account_key, id)? {
                return Err(PersistenceError::Conflict);
            }
        }
        let mut ids = membership_ids(&tx, &m.account_key, email_jmap_id)?
            .into_iter()
            .collect::<BTreeSet<_>>();
        for id in &change.remove {
            ids.remove(id);
        }
        for id in &change.add {
            ids.insert(id.clone());
        }
        if ids.is_empty() {
            return Err(PersistenceError::Conflict);
        }
        replace_memberships(
            &tx,
            &m.account_key,
            email_jmap_id,
            &ids.into_iter().collect::<Vec<_>>(),
        )?;
        insert_mutation(&tx, m)?;
        tx.commit()?;
        Ok(())
    }

    pub fn replace_pending_mutation_if_current(
        &self,
        expected: &PendingMutation,
        next: &PendingMutation,
    ) -> PersistResult<()> {
        validate_mutation(expected).map_err(|_| PersistenceError::Conflict)?;
        validate_mutation(next).map_err(|_| PersistenceError::Conflict)?;
        if !same_immutable(expected, next) || !valid_transition(expected, next) {
            return Err(PersistenceError::Conflict);
        }
        let mut c = self.database.connect()?;
        let tx = c.transaction_with_behavior(rusqlite::TransactionBehavior::Immediate)?;
        if read_mutation(&tx, &expected.account_key, &expected.mutation_id)?.as_ref()
            != Some(expected)
        {
            return Err(PersistenceError::Conflict);
        }
        tx.execute(
            "DELETE FROM pending_mutations WHERE account_key=?1 AND mutation_id=?2",
            params![expected.account_key, expected.mutation_id],
        )?;
        insert_mutation(&tx, next)?;
        tx.commit()?;
        Ok(())
    }

    pub fn remove_confirmed_mutation(&self, account: &str, id: &str) -> PersistResult<()> {
        let mut c = self.database.connect()?;
        let tx = c.transaction()?;
        let Some(m) = read_mutation(&tx, account, id)? else {
            return Err(PersistenceError::Conflict);
        };
        if !matches!(m.lifecycle, MutationLifecycle::Confirmed { .. }) {
            return Err(PersistenceError::Conflict);
        }
        tx.execute(
            "DELETE FROM pending_mutations WHERE account_key=?1 AND mutation_id=?2",
            params![account, id],
        )?;
        tx.commit()?;
        Ok(())
    }
}

fn account_exists(c: &Connection, a: &str) -> PersistResult<bool> {
    Ok(
        c.query_row("SELECT 1 FROM accounts WHERE account_key=?1", [a], |_| {
            Ok(())
        })
        .optional()?
        .is_some(),
    )
}
fn email_exists(c: &Connection, a: &str, id: &str) -> PersistResult<bool> {
    Ok(c.query_row(
        "SELECT 1 FROM emails WHERE account_key=?1 AND jmap_id=?2",
        params![a, id],
        |_| Ok(()),
    )
    .optional()?
    .is_some())
}
fn mailbox_exists(c: &Connection, a: &str, id: &str) -> PersistResult<bool> {
    Ok(c.query_row(
        "SELECT 1 FROM mailboxes WHERE account_key=?1 AND jmap_id=?2",
        params![a, id],
        |_| Ok(()),
    )
    .optional()?
    .is_some())
}
fn mutation_exists(c: &Connection, a: &str, id: &str) -> PersistResult<bool> {
    Ok(c.query_row(
        "SELECT 1 FROM pending_mutations WHERE account_key=?1 AND mutation_id=?2",
        params![a, id],
        |_| Ok(()),
    )
    .optional()?
    .is_some())
}
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

fn to_i64(v: u64) -> PersistResult<i64> {
    if v > MAX_SAFE_INTEGER {
        return Err(PersistenceError::Conflict);
    }
    Ok(v as i64)
}
fn decode_u64(v: i64) -> rusqlite::Result<u64> {
    let value = u64::try_from(v).map_err(|e| {
        rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Integer, Box::new(e))
    })?;
    if value > MAX_SAFE_INTEGER {
        return Err(rusqlite::Error::IntegralValueOutOfRange(0, v));
    }
    Ok(value)
}
fn bool_i64(v: bool) -> i64 {
    i64::from(v)
}

fn read_mailbox_row(c: &Connection, a: &str, id: &str) -> PersistResult<Option<Mailbox>> {
    let value=c.query_row("SELECT name,parent_jmap_id,role,sort_order,total_emails,unread_emails,may_read_items,may_add_items,may_remove_items,may_set_seen,may_set_keywords,may_submit FROM mailboxes WHERE account_key=?1 AND jmap_id=?2",params![a,id],|r|Ok(Mailbox{account_key:a.into(),jmap_id:id.into(),name:r.get(0)?,parent_jmap_id:r.get(1)?,role:r.get(2)?,sort_order:r.get(3)?,total_emails:decode_u64(r.get(4)?)?,unread_emails:decode_u64(r.get(5)?)?,rights:MailboxRights{may_read_items:r.get(6)?,may_add_items:r.get(7)?,may_remove_items:r.get(8)?,may_set_seen:r.get(9)?,may_set_keywords:r.get(10)?,may_submit:r.get(11)?}})).optional()?;
    if let Some(v) = &value {
        validate_mailbox(v)?
    }
    Ok(value)
}
fn read_identity_row(c: &Connection, a: &str, id: &str) -> PersistResult<Option<Identity>> {
    let value=c.query_row("SELECT name,email,reply_to_json,bcc_json FROM identities WHERE account_key=?1 AND jmap_id=?2",params![a,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?))).optional()?;
    value
        .map(|(name, email, reply, bcc)| {
            non_empty(&email, "Identity email")?;
            Ok(Identity {
                account_key: a.into(),
                jmap_id: id.into(),
                name,
                email,
                reply_to: decode(&reply, "Identity replyTo")?,
                bcc: decode(&bcc, "Identity bcc")?,
            })
        })
        .transpose()
}
fn read_email_row(c: &Connection, a: &str, id: &str) -> PersistResult<Option<Email>> {
    let row=c.query_row("SELECT blob_id,thread_id,sender_json,from_json,reply_to_json,to_json,cc_json,bcc_json,subject,sent_at,received_at,size,preview,has_attachment,keywords_json FROM emails WHERE account_key=?1 AND jmap_id=?2",params![a,id],|r|Ok((r.get::<_,String>(0)?,r.get::<_,String>(1)?,r.get::<_,String>(2)?,r.get::<_,String>(3)?,r.get::<_,String>(4)?,r.get::<_,String>(5)?,r.get::<_,String>(6)?,r.get::<_,String>(7)?,r.get::<_,Option<String>>(8)?,r.get::<_,Option<String>>(9)?,r.get::<_,String>(10)?,r.get::<_,i64>(11)?,r.get::<_,String>(12)?,r.get::<_,bool>(13)?,r.get::<_,String>(14)?))).optional()?;
    row.map(|x| {
        let value = Email {
            account_key: a.into(),
            jmap_id: id.into(),
            blob_id: x.0,
            thread_id: x.1,
            sender: decode(&x.2, "Email sender")?,
            from: decode(&x.3, "Email from")?,
            reply_to: decode(&x.4, "Email replyTo")?,
            to: decode(&x.5, "Email to")?,
            cc: decode(&x.6, "Email cc")?,
            bcc: decode(&x.7, "Email bcc")?,
            subject: x.8,
            sent_at: x.9,
            received_at: x.10,
            size: u64::try_from(x.11)
                .map_err(|_| PersistenceError::CorruptState("negative Email size".into()))?,
            preview: x.12,
            has_attachment: x.13,
            keywords: decode(&x.14, "Email keywords")?,
        };
        validate_email(&value)?;
        Ok(value)
    })
    .transpose()
}

fn validate_mailbox(v: &Mailbox) -> PersistResult<()> {
    non_empty(&v.account_key, "AccountKey")?;
    non_empty(&v.jmap_id, "Mailbox id")?;
    non_empty(&v.name, "Mailbox name")?;
    if v.role.as_deref() == Some("") {
        return Err(PersistenceError::CorruptState("empty Mailbox role".into()));
    }
    if v.parent_jmap_id.as_deref() == Some(&v.jmap_id) {
        return Err(PersistenceError::CorruptState("self parent".into()));
    }
    if v.unread_emails > v.total_emails {
        return Err(PersistenceError::CorruptState(
            "unread exceeds total".into(),
        ));
    }
    Ok(())
}
fn validate_attachment(v: &AttachmentRef) -> PersistResult<()> {
    non_empty(&v.account_key, "AccountKey")?;
    non_empty(&v.email_jmap_id, "Email id")?;
    non_empty(&v.blob_id, "Blob id")?;
    non_empty(&v.media_type, "mediaType")?;
    if v.media_type.to_ascii_lowercase().starts_with("multipart/") {
        return Err(PersistenceError::CorruptState(
            "multipart AttachmentRef".into(),
        ));
    }
    Ok(())
}
fn validate_view(v: &MailboxView) -> PersistResult<()> {
    if v.spec.filter_kind != "all"
        || v.spec.sort_property != "receivedAt"
        || !matches!(v.spec.sort_direction.as_str(), "ascending" | "descending")
        || v.query_state.is_empty()
    {
        return Err(PersistenceError::CorruptState(
            "invalid MailboxView spec/state".into(),
        ));
    }
    let mut last = None;
    for r in &v.coverage {
        if r.start >= r.end_exclusive
            || r.end_exclusive > v.total
            || last.is_some_and(|x| r.start <= x)
        {
            return Err(PersistenceError::CorruptState(
                "invalid View coverage".into(),
            ));
        }
        last = Some(r.end_exclusive)
    }
    let positions = v.items.iter().map(|i| i.position).collect::<Vec<_>>();
    if positions.windows(2).any(|w| w[0] >= w[1]) || v.items.iter().any(|i| i.position >= v.total) {
        return Err(PersistenceError::CorruptState("invalid View items".into()));
    }
    let covered = v
        .coverage
        .iter()
        .flat_map(|r| r.start..r.end_exclusive)
        .collect::<Vec<_>>();
    if covered != positions {
        return Err(PersistenceError::CorruptState(
            "coverage/items mismatch".into(),
        ));
    }
    Ok(())
}

fn write_mailbox(tx: &Transaction<'_>, v: &Mailbox) -> PersistResult<()> {
    validate_mailbox(v).map_err(|_| PersistenceError::Conflict)?;
    tx.execute("INSERT INTO mailboxes VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14) ON CONFLICT(account_key,jmap_id) DO UPDATE SET name=excluded.name,parent_jmap_id=excluded.parent_jmap_id,role=excluded.role,sort_order=excluded.sort_order,total_emails=excluded.total_emails,unread_emails=excluded.unread_emails,may_read_items=excluded.may_read_items,may_add_items=excluded.may_add_items,may_remove_items=excluded.may_remove_items,may_set_seen=excluded.may_set_seen,may_set_keywords=excluded.may_set_keywords,may_submit=excluded.may_submit",params![v.account_key,v.jmap_id,v.name,v.parent_jmap_id,v.role,v.sort_order,to_i64(v.total_emails)?,to_i64(v.unread_emails)?,bool_i64(v.rights.may_read_items),bool_i64(v.rights.may_add_items),bool_i64(v.rights.may_remove_items),bool_i64(v.rights.may_set_seen),bool_i64(v.rights.may_set_keywords),bool_i64(v.rights.may_submit)])?;
    Ok(())
}
fn write_identity(tx: &Transaction<'_>, v: &Identity) -> PersistResult<()> {
    non_empty(&v.account_key, "AccountKey").map_err(|_| PersistenceError::Conflict)?;
    non_empty(&v.jmap_id, "Identity id").map_err(|_| PersistenceError::Conflict)?;
    non_empty(&v.email, "Identity email").map_err(|_| PersistenceError::Conflict)?;
    tx.execute("INSERT INTO identities VALUES(?1,?2,?3,?4,?5,?6) ON CONFLICT(account_key,jmap_id) DO UPDATE SET name=excluded.name,email=excluded.email,reply_to_json=excluded.reply_to_json,bcc_json=excluded.bcc_json",params![v.account_key,v.jmap_id,v.name,v.email,encode(&v.reply_to)?,encode(&v.bcc)?])?;
    Ok(())
}
fn write_email(tx: &Transaction<'_>, v: &Email) -> PersistResult<()> {
    validate_email(v).map_err(|_| PersistenceError::Conflict)?;
    tx.execute("INSERT INTO emails VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17) ON CONFLICT(account_key,jmap_id) DO UPDATE SET blob_id=excluded.blob_id,thread_id=excluded.thread_id,sender_json=excluded.sender_json,from_json=excluded.from_json,reply_to_json=excluded.reply_to_json,to_json=excluded.to_json,cc_json=excluded.cc_json,bcc_json=excluded.bcc_json,subject=excluded.subject,sent_at=excluded.sent_at,received_at=excluded.received_at,size=excluded.size,preview=excluded.preview,has_attachment=excluded.has_attachment,keywords_json=excluded.keywords_json",params![v.account_key,v.jmap_id,v.blob_id,v.thread_id,encode(&v.sender)?,encode(&v.from)?,encode(&v.reply_to)?,encode(&v.to)?,encode(&v.cc)?,encode(&v.bcc)?,v.subject,v.sent_at,v.received_at,to_i64(v.size)?,v.preview,bool_i64(v.has_attachment),encode(&v.keywords)?])?;
    Ok(())
}
fn replace_memberships(
    tx: &Transaction<'_>,
    a: &str,
    email: &str,
    ids: &[String],
) -> PersistResult<()> {
    let mut seen = HashSet::new();
    for id in ids {
        non_empty(id, "Mailbox id").map_err(|_| PersistenceError::Conflict)?;
        if !seen.insert(id) {
            return Err(PersistenceError::Conflict);
        }
    }
    tx.execute(
        "DELETE FROM email_mailboxes WHERE account_key=?1 AND email_jmap_id=?2",
        params![a, email],
    )?;
    for id in ids {
        tx.execute(
            "INSERT INTO email_mailboxes VALUES(?1,?2,?3)",
            params![a, email, id],
        )?;
    }
    Ok(())
}
fn membership_ids(c: &Connection, a: &str, email: &str) -> PersistResult<Vec<String>> {
    let mut s=c.prepare("SELECT mailbox_jmap_id FROM email_mailboxes WHERE account_key=?1 AND email_jmap_id=?2 ORDER BY mailbox_jmap_id")?;
    Ok(s.query_map(params![a, email], |r| r.get(0))?
        .collect::<Result<_, _>>()?)
}
fn validate_email_records(a: &str, records: &[EmailSyncRecord]) -> PersistResult<()> {
    let mut ids = HashSet::new();
    for r in records {
        if r.email.account_key != a || !ids.insert(&r.email.jmap_id) {
            return Err(PersistenceError::Conflict);
        }
        let mut mids = HashSet::new();
        for m in &r.memberships {
            if m.account_key != a
                || m.email_jmap_id != r.email.jmap_id
                || !mids.insert(&m.mailbox_jmap_id)
            {
                return Err(PersistenceError::Conflict);
            }
            non_empty(&m.mailbox_jmap_id, "Mailbox id").map_err(|_| PersistenceError::Conflict)?;
        }
    }
    Ok(())
}
fn apply_email_delta(
    tx: &Transaction<'_>,
    a: &str,
    changed: &[EmailSyncRecord],
    destroyed: &[String],
) -> PersistResult<()> {
    validate_email_records(a, changed)?;
    let changed_ids = changed
        .iter()
        .map(|r| r.email.jmap_id.as_str())
        .collect::<HashSet<_>>();
    let mut dead = HashSet::new();
    for id in destroyed {
        if !dead.insert(id) || changed_ids.contains(id.as_str()) {
            return Err(PersistenceError::Conflict);
        }
    }
    for r in changed {
        write_email(tx, &r.email)?;
        replace_memberships(
            tx,
            a,
            &r.email.jmap_id,
            &r.memberships
                .iter()
                .map(|m| m.mailbox_jmap_id.clone())
                .collect::<Vec<_>>(),
        )?;
    }
    for id in destroyed {
        tx.execute(
            "DELETE FROM emails WHERE account_key=?1 AND jmap_id=?2",
            params![a, id],
        )?;
    }
    Ok(())
}
fn apply_email_replace(
    tx: &Transaction<'_>,
    a: &str,
    snapshot: &[EmailSyncRecord],
) -> PersistResult<()> {
    validate_email_records(a, snapshot)?;
    let keep = snapshot
        .iter()
        .map(|r| r.email.jmap_id.clone())
        .collect::<HashSet<_>>();
    let mut s = tx.prepare("SELECT jmap_id FROM emails WHERE account_key=?1")?;
    let existing = s
        .query_map([a], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(s);
    for id in existing {
        if !keep.contains(&id) {
            tx.execute(
                "DELETE FROM emails WHERE account_key=?1 AND jmap_id=?2",
                params![a, id],
            )?;
        }
    }
    for r in snapshot {
        write_email(tx, &r.email)?;
        replace_memberships(
            tx,
            a,
            &r.email.jmap_id,
            &r.memberships
                .iter()
                .map(|m| m.mailbox_jmap_id.clone())
                .collect::<Vec<_>>(),
        )?;
    }
    Ok(())
}
fn apply_mailbox_delta(
    tx: &Transaction<'_>,
    a: &str,
    changed: &[Mailbox],
    destroyed: &[String],
) -> PersistResult<()> {
    let mut ids = HashSet::new();
    for m in changed {
        if m.account_key != a || !ids.insert(&m.jmap_id) {
            return Err(PersistenceError::Conflict);
        }
    }
    let mut dead = HashSet::new();
    for id in destroyed {
        if !dead.insert(id) || ids.contains(&id) {
            return Err(PersistenceError::Conflict);
        }
    }
    for id in destroyed {
        tx.execute(
            "DELETE FROM mailboxes WHERE account_key=?1 AND jmap_id=?2",
            params![a, id],
        )?;
    }
    for m in changed {
        write_mailbox(tx, m)?;
    }
    validate_mailbox_catalog(tx, a)
}
fn apply_mailbox_replace(tx: &Transaction<'_>, a: &str, snapshot: &[Mailbox]) -> PersistResult<()> {
    let mut ids = HashSet::new();
    for m in snapshot {
        if m.account_key != a || !ids.insert(&m.jmap_id) {
            return Err(PersistenceError::Conflict);
        }
    }
    let mut statement = tx.prepare("SELECT jmap_id FROM mailboxes WHERE account_key=?1")?;
    let existing = statement
        .query_map([a], |r| r.get::<_, String>(0))?
        .collect::<Result<Vec<_>, _>>()?;
    drop(statement);
    for id in existing {
        if !ids.contains(&id) {
            tx.execute(
                "DELETE FROM mailboxes WHERE account_key=?1 AND jmap_id=?2",
                params![a, id],
            )?;
        }
    }
    for m in snapshot {
        write_mailbox(tx, m)?;
    }
    validate_mailbox_catalog(tx, a)
}
fn apply_identity_delta(
    tx: &Transaction<'_>,
    a: &str,
    changed: &[Identity],
    destroyed: &[String],
) -> PersistResult<()> {
    let mut ids = HashSet::new();
    for v in changed {
        if v.account_key != a || !ids.insert(&v.jmap_id) {
            return Err(PersistenceError::Conflict);
        }
    }
    let mut dead = HashSet::new();
    for id in destroyed {
        if !dead.insert(id) || ids.contains(&id) {
            return Err(PersistenceError::Conflict);
        }
    }
    for v in changed {
        write_identity(tx, v)?;
    }
    for id in destroyed {
        tx.execute(
            "DELETE FROM identities WHERE account_key=?1 AND jmap_id=?2",
            params![a, id],
        )?;
    }
    Ok(())
}
fn apply_identity_replace(
    tx: &Transaction<'_>,
    a: &str,
    snapshot: &[Identity],
) -> PersistResult<()> {
    let mut ids = HashSet::new();
    for v in snapshot {
        if v.account_key != a || !ids.insert(&v.jmap_id) {
            return Err(PersistenceError::Conflict);
        }
    }
    tx.execute("DELETE FROM identities WHERE account_key=?1", [a])?;
    for v in snapshot {
        write_identity(tx, v)?;
    }
    Ok(())
}

fn cursor_matches(
    c: &Connection,
    a: &str,
    kind: CollectionDataType,
    expected: &CursorPrecondition,
) -> PersistResult<bool> {
    let current = c
        .query_row(
            "SELECT state FROM sync_cursors WHERE account_key=?1 AND data_type=?2",
            params![a, kind.as_str()],
            |r| r.get::<_, String>(0),
        )
        .optional()?;
    Ok(match expected {
        CursorPrecondition::Absent => current.is_none(),
        CursorPrecondition::Matches(v) => {
            v.account_key == a && v.data_type == kind && current.as_ref() == Some(&v.state)
        }
    })
}

fn write_view(tx: &Transaction<'_>, v: &MailboxView) -> PersistResult<()> {
    let s = &v.spec;
    tx.execute("INSERT INTO mailbox_views VALUES(?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(account_key,mailbox_jmap_id,filter_kind,sort_property,sort_direction) DO UPDATE SET query_state=excluded.query_state,total=excluded.total",params![s.account_key,s.mailbox_jmap_id,s.filter_kind,s.sort_property,s.sort_direction,v.query_state,to_i64(v.total)?])?;
    tx.execute("DELETE FROM mailbox_view_coverage WHERE account_key=?1 AND mailbox_jmap_id=?2 AND filter_kind=?3 AND sort_property=?4 AND sort_direction=?5",params![s.account_key,s.mailbox_jmap_id,s.filter_kind,s.sort_property,s.sort_direction])?;
    tx.execute("DELETE FROM mailbox_view_items WHERE account_key=?1 AND mailbox_jmap_id=?2 AND filter_kind=?3 AND sort_property=?4 AND sort_direction=?5",params![s.account_key,s.mailbox_jmap_id,s.filter_kind,s.sort_property,s.sort_direction])?;
    for (ordinal, r) in v.coverage.iter().enumerate() {
        tx.execute(
            "INSERT INTO mailbox_view_coverage VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
            params![
                s.account_key,
                s.mailbox_jmap_id,
                s.filter_kind,
                s.sort_property,
                s.sort_direction,
                ordinal as i64,
                to_i64(r.start)?,
                to_i64(r.end_exclusive)?
            ],
        )?;
    }
    for item in &v.items {
        tx.execute(
            "INSERT INTO mailbox_view_items VALUES(?1,?2,?3,?4,?5,?6,?7)",
            params![
                s.account_key,
                s.mailbox_jmap_id,
                s.filter_kind,
                s.sort_property,
                s.sort_direction,
                to_i64(item.position)?,
                item.email_jmap_id
            ],
        )?;
    }
    Ok(())
}
fn read_view(c: &Connection, s: &MailboxViewSpec) -> PersistResult<Option<MailboxView>> {
    let head=c.query_row("SELECT query_state,total FROM mailbox_views WHERE account_key=?1 AND mailbox_jmap_id=?2 AND filter_kind=?3 AND sort_property=?4 AND sort_direction=?5",params![s.account_key,s.mailbox_jmap_id,s.filter_kind,s.sort_property,s.sort_direction],|r|Ok((r.get::<_,String>(0)?,decode_u64(r.get::<_,i64>(1)?)?))).optional()?;
    let Some((query_state, total)) = head else {
        return Ok(None);
    };
    let mut cs=c.prepare("SELECT start,end_exclusive FROM mailbox_view_coverage WHERE account_key=?1 AND mailbox_jmap_id=?2 AND filter_kind=?3 AND sort_property=?4 AND sort_direction=?5 ORDER BY ordinal")?;
    let coverage = cs
        .query_map(
            params![
                s.account_key,
                s.mailbox_jmap_id,
                s.filter_kind,
                s.sort_property,
                s.sort_direction
            ],
            |r| {
                Ok(CoverageRange {
                    start: decode_u64(r.get(0)?)?,
                    end_exclusive: decode_u64(r.get(1)?)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let mut is=c.prepare("SELECT position,email_jmap_id FROM mailbox_view_items WHERE account_key=?1 AND mailbox_jmap_id=?2 AND filter_kind=?3 AND sort_property=?4 AND sort_direction=?5 ORDER BY position")?;
    let items = is
        .query_map(
            params![
                s.account_key,
                s.mailbox_jmap_id,
                s.filter_kind,
                s.sort_property,
                s.sort_direction
            ],
            |r| {
                Ok(ViewItem {
                    position: decode_u64(r.get(0)?)?,
                    email_jmap_id: r.get(1)?,
                })
            },
        )?
        .collect::<Result<Vec<_>, _>>()?;
    let v = MailboxView {
        spec: s.clone(),
        query_state,
        total,
        coverage,
        items,
    };
    validate_view(&v)?;
    Ok(Some(v))
}

type EncodedMutationParts<'a> = (
    &'static str,
    Option<&'a str>,
    Option<String>,
    Option<String>,
    Option<String>,
);

fn mutation_parts(m: &PendingMutation) -> PersistResult<EncodedMutationParts<'_>> {
    Ok(match &m.payload {
        MutationPayload::Send(v) => ("send", None, Some(encode(v)?), None, None),
        MutationPayload::Keyword {
            email_jmap_id,
            change,
        } => (
            "keyword",
            Some(email_jmap_id),
            None,
            Some(encode(change)?),
            None,
        ),
        MutationPayload::MailboxMembership {
            email_jmap_id,
            change,
        } => (
            "mailboxMembership",
            Some(email_jmap_id),
            None,
            None,
            Some(encode(change)?),
        ),
    })
}
fn insert_mutation(tx: &Transaction<'_>, m: &PendingMutation) -> PersistResult<()> {
    let (kind, target, send, keyword, membership) = mutation_parts(m)?;
    tx.execute(
        "INSERT INTO pending_mutations VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9)",
        params![
            m.account_key,
            m.mutation_id,
            kind,
            m.created_at,
            target,
            send,
            keyword,
            membership,
            encode(&m.lifecycle)?
        ],
    )?;
    Ok(())
}
fn read_mutation(c: &Connection, a: &str, id: &str) -> PersistResult<Option<PendingMutation>> {
    type Row = (
        String,
        String,
        Option<String>,
        Option<String>,
        Option<String>,
        Option<String>,
        String,
    );
    let row:Option<Row>=c.query_row("SELECT kind,created_at,target_email_jmap_id,send_intent_json,keyword_change_json,membership_change_json,lifecycle_json FROM pending_mutations WHERE account_key=?1 AND mutation_id=?2",params![a,id],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?,r.get(6)?))).optional()?;
    row.map(
        |(kind, created, target, send, keyword, membership, lifecycle)| {
            let payload = match kind.as_str() {
                "send" => MutationPayload::Send(decode(
                    send.as_deref().ok_or_else(|| {
                        PersistenceError::CorruptState("send payload missing".into())
                    })?,
                    "SendIntent",
                )?),
                "keyword" => MutationPayload::Keyword {
                    email_jmap_id: target.ok_or_else(|| {
                        PersistenceError::CorruptState("keyword target missing".into())
                    })?,
                    change: decode(
                        keyword.as_deref().ok_or_else(|| {
                            PersistenceError::CorruptState("keyword payload missing".into())
                        })?,
                        "KeywordChange",
                    )?,
                },
                "mailboxMembership" => MutationPayload::MailboxMembership {
                    email_jmap_id: target.ok_or_else(|| {
                        PersistenceError::CorruptState("membership target missing".into())
                    })?,
                    change: decode(
                        membership.as_deref().ok_or_else(|| {
                            PersistenceError::CorruptState("membership payload missing".into())
                        })?,
                        "MembershipChange",
                    )?,
                },
                _ => {
                    return Err(PersistenceError::CorruptState(
                        "invalid mutation kind".into(),
                    ));
                }
            };
            let m = PendingMutation {
                account_key: a.into(),
                mutation_id: id.into(),
                created_at: created,
                payload,
                lifecycle: decode(&lifecycle, "MutationLifecycle")?,
            };
            validate_mutation(&m)?;
            Ok(m)
        },
    )
    .transpose()
}
fn same_immutable(a: &PendingMutation, b: &PendingMutation) -> bool {
    a.account_key == b.account_key
        && a.mutation_id == b.mutation_id
        && a.created_at == b.created_at
        && a.payload == b.payload
}
fn valid_transition(a: &PendingMutation, b: &PendingMutation) -> bool {
    use MutationLifecycle::*;
    match (&a.lifecycle, &b.lifecycle) {
        (Pending { attempt_count: 0 }, InFlight { attempt_count: 1 }) => true,
        (
            Retrying {
                attempt_count: x, ..
            },
            InFlight { attempt_count: y },
        ) => *x > 0 && *y == x + 1,
        (
            InFlight { attempt_count: x },
            Retrying {
                attempt_count: y, ..
            }
            | Confirmed {
                attempt_count: y, ..
            }
            | FailedTerminal { attempt_count: y },
        ) => *x > 0 && x == y,
        _ => false,
    }
}

fn validate_mailbox_catalog(c: &Connection, a: &str) -> PersistResult<()> {
    let mut statement =
        c.prepare("SELECT jmap_id,parent_jmap_id FROM mailboxes WHERE account_key=?1")?;
    let pairs = statement
        .query_map([a], |r| {
            Ok((r.get::<_, String>(0)?, r.get::<_, Option<String>>(1)?))
        })?
        .collect::<Result<Vec<_>, _>>()?;
    let parents = pairs
        .into_iter()
        .collect::<std::collections::HashMap<_, _>>();
    for start in parents.keys() {
        let mut seen = HashSet::new();
        let mut current = Some(start.as_str());
        while let Some(id) = current {
            if !seen.insert(id) {
                return Err(PersistenceError::Conflict);
            }
            current = parents.get(id).and_then(Option::as_deref);
        }
    }
    Ok(())
}
