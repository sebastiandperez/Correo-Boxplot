use std::collections::BTreeSet;

use serde::{Deserialize, Serialize};

use super::PersistenceError;

pub type PersistResult<T> = Result<T, PersistenceError>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct Address {
    pub name: Option<String>,
    pub email: String,
}
pub type AddressList = Option<Vec<Address>>;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Account {
    pub key: String,
    pub service_key: String,
    pub jmap_account_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxRights {
    pub may_read_items: bool,
    pub may_add_items: bool,
    pub may_remove_items: bool,
    pub may_set_seen: bool,
    pub may_set_keywords: bool,
    pub may_submit: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Mailbox {
    pub account_key: String,
    pub jmap_id: String,
    pub name: String,
    pub parent_jmap_id: Option<String>,
    pub role: Option<String>,
    pub sort_order: u32,
    pub total_emails: u64,
    pub unread_emails: u64,
    pub rights: MailboxRights,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Identity {
    pub account_key: String,
    pub jmap_id: String,
    pub name: String,
    pub email: String,
    pub reply_to: AddressList,
    pub bcc: AddressList,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Email {
    pub account_key: String,
    pub jmap_id: String,
    pub blob_id: String,
    pub thread_id: String,
    pub sender: AddressList,
    pub from: AddressList,
    pub reply_to: AddressList,
    pub to: AddressList,
    pub cc: AddressList,
    pub bcc: AddressList,
    pub subject: Option<String>,
    pub sent_at: Option<String>,
    pub received_at: String,
    pub size: u64,
    pub preview: String,
    pub has_attachment: bool,
    pub keywords: Vec<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailMembership {
    pub account_key: String,
    pub email_jmap_id: String,
    pub mailbox_jmap_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailSyncRecord {
    pub email: Email,
    pub memberships: Vec<EmailMembership>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmailBody {
    pub account_key: String,
    pub email_jmap_id: String,
    pub text: Option<String>,
    pub html: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AttachmentRef {
    pub account_key: String,
    pub email_jmap_id: String,
    pub part_id: String,
    pub blob_id: String,
    pub name: Option<String>,
    pub media_type: String,
    pub size: u64,
    pub disposition: Option<String>,
    pub cid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct MailboxViewSpec {
    pub account_key: String,
    pub mailbox_jmap_id: String,
    pub filter_kind: String,
    pub sort_property: String,
    pub sort_direction: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CoverageRange {
    pub start: u64,
    pub end_exclusive: u64,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ViewItem {
    pub position: u64,
    pub email_jmap_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MailboxView {
    pub spec: MailboxViewSpec,
    pub query_state: String,
    pub total: u64,
    pub coverage: Vec<CoverageRange>,
    pub items: Vec<ViewItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum CollectionDataType {
    Email,
    Mailbox,
    Identity,
}
impl CollectionDataType {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Email => "email",
            Self::Mailbox => "mailbox",
            Self::Identity => "identity",
        }
    }
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CollectionSyncCursor {
    pub account_key: String,
    pub data_type: CollectionDataType,
    pub state: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendBody {
    pub text: String,
    pub html: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SendIntent {
    pub identity_jmap_id: String,
    pub from: Address,
    pub reply_to: Vec<Address>,
    pub to: Vec<Address>,
    pub cc: Vec<Address>,
    pub bcc: Vec<Address>,
    pub subject: String,
    pub body: SendBody,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct KeywordChange {
    pub add: BTreeSet<String>,
    pub remove: BTreeSet<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct MembershipChange {
    pub add: Vec<String>,
    pub remove: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "camelCase", deny_unknown_fields)]
pub enum MutationLifecycle {
    Pending {
        attempt_count: u64,
    },
    InFlight {
        attempt_count: u64,
    },
    Retrying {
        attempt_count: u64,
        next_attempt_at: String,
    },
    Confirmed {
        attempt_count: u64,
        confirmation_email_jmap_id: Option<String>,
    },
    FailedTerminal {
        attempt_count: u64,
    },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum MutationPayload {
    Send(SendIntent),
    Keyword {
        email_jmap_id: String,
        change: KeywordChange,
    },
    MailboxMembership {
        email_jmap_id: String,
        change: MembershipChange,
    },
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMutation {
    pub account_key: String,
    pub mutation_id: String,
    pub created_at: String,
    pub payload: MutationPayload,
    pub lifecycle: MutationLifecycle,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LocalEntity<T> {
    Absent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedSnapshot<T> {
    OwnerAbsent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedOptional<T> {
    OwnerAbsent,
    Absent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OwnedCache<T> {
    OwnerAbsent,
    NotCached,
    Cached(T),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CursorPrecondition {
    Absent,
    Matches(CollectionSyncCursor),
}
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum CollectionSyncCommit {
    EmailDelta {
        expected: CollectionSyncCursor,
        next: CollectionSyncCursor,
        changed: Vec<EmailSyncRecord>,
        destroyed: Vec<String>,
    },
    EmailReplace {
        expected: CursorPrecondition,
        next: CollectionSyncCursor,
        snapshot: Vec<EmailSyncRecord>,
    },
    MailboxDelta {
        expected: CollectionSyncCursor,
        next: CollectionSyncCursor,
        changed: Vec<Mailbox>,
        destroyed: Vec<String>,
    },
    MailboxReplace {
        expected: CursorPrecondition,
        next: CollectionSyncCursor,
        snapshot: Vec<Mailbox>,
    },
    IdentityDelta {
        expected: CollectionSyncCursor,
        next: CollectionSyncCursor,
        changed: Vec<Identity>,
        destroyed: Vec<String>,
    },
    IdentityReplace {
        expected: CursorPrecondition,
        next: CollectionSyncCursor,
        snapshot: Vec<Identity>,
    },
}

pub(crate) fn non_empty(value: &str, field: &str) -> PersistResult<()> {
    if value.is_empty() {
        Err(PersistenceError::CorruptState(format!(
            "{field} must not be empty"
        )))
    } else {
        Ok(())
    }
}
pub(crate) fn validate_email(value: &Email) -> PersistResult<()> {
    for (field, id) in [
        ("accountKey", &value.account_key),
        ("Email id", &value.jmap_id),
        ("Blob id", &value.blob_id),
        ("Thread id", &value.thread_id),
        ("receivedAt", &value.received_at),
    ] {
        non_empty(id, field)?;
    }
    if value.sent_at.as_deref() == Some("") {
        return Err(PersistenceError::CorruptState(
            "sentAt must be null or non-empty".into(),
        ));
    }
    if value.keywords.iter().any(String::is_empty) {
        return Err(PersistenceError::CorruptState(
            "keyword must not be empty".into(),
        ));
    }
    let unique_keywords = value.keywords.iter().collect::<BTreeSet<_>>();
    if unique_keywords.len() != value.keywords.len() {
        return Err(PersistenceError::CorruptState(
            "Email keywords must be unique".into(),
        ));
    }
    Ok(())
}
pub(crate) fn validate_mutation(value: &PendingMutation) -> PersistResult<()> {
    non_empty(&value.account_key, "AccountKey")?;
    non_empty(&value.mutation_id, "MutationId")?;
    non_empty(&value.created_at, "createdAt")?;
    let attempt = match &value.lifecycle {
        MutationLifecycle::Pending { attempt_count }
        | MutationLifecycle::InFlight { attempt_count }
        | MutationLifecycle::Retrying { attempt_count, .. }
        | MutationLifecycle::Confirmed { attempt_count, .. }
        | MutationLifecycle::FailedTerminal { attempt_count } => *attempt_count,
    };
    match &value.lifecycle {
        MutationLifecycle::Pending { .. } if attempt != 0 => {
            return Err(PersistenceError::CorruptState(
                "pending attemptCount must be zero".into(),
            ));
        }
        MutationLifecycle::Pending { .. } => {}
        _ if attempt == 0 => {
            return Err(PersistenceError::CorruptState(
                "started attemptCount must be positive".into(),
            ));
        }
        MutationLifecycle::Retrying {
            next_attempt_at, ..
        } => non_empty(next_attempt_at, "nextAttemptAt")?,
        _ => {}
    }
    match &value.payload {
        MutationPayload::Send(intent) => {
            non_empty(&intent.identity_jmap_id, "Identity id")?;
            if intent.from.email.starts_with("*@") {
                return Err(PersistenceError::CorruptState(
                    "wildcard Identity cannot back SendIntent".into(),
                ));
            }
            if intent.to.len() + intent.cc.len() + intent.bcc.len() == 0 {
                return Err(PersistenceError::CorruptState(
                    "SendIntent needs an effective recipient".into(),
                ));
            }
            for address in std::iter::once(&intent.from)
                .chain(intent.reply_to.iter())
                .chain(intent.to.iter())
                .chain(intent.cc.iter())
                .chain(intent.bcc.iter())
            {
                validate_outbound_address(address)?;
            }
            if matches!(
                &value.lifecycle,
                MutationLifecycle::Confirmed {
                    confirmation_email_jmap_id: None,
                    ..
                }
            ) {
                return Err(PersistenceError::CorruptState(
                    "confirmed send needs confirmation".into(),
                ));
            }
        }
        MutationPayload::Keyword {
            email_jmap_id,
            change,
        } => {
            non_empty(email_jmap_id, "Email id")?;
            if change.add.is_empty() && change.remove.is_empty() {
                return Err(PersistenceError::CorruptState(
                    "empty keyword change".into(),
                ));
            }
            if change
                .add
                .iter()
                .chain(change.remove.iter())
                .any(String::is_empty)
            {
                return Err(PersistenceError::CorruptState(
                    "keyword change contains empty keyword".into(),
                ));
            }
            if !change.add.is_disjoint(&change.remove) {
                return Err(PersistenceError::CorruptState(
                    "overlapping keyword change".into(),
                ));
            }
            if matches!(
                &value.lifecycle,
                MutationLifecycle::Confirmed {
                    confirmation_email_jmap_id: Some(_),
                    ..
                }
            ) {
                return Err(PersistenceError::CorruptState(
                    "email update confirmation payload forbidden".into(),
                ));
            }
        }
        MutationPayload::MailboxMembership {
            email_jmap_id,
            change,
        } => {
            non_empty(email_jmap_id, "Email id")?;
            if change.add.is_empty() && change.remove.is_empty() {
                return Err(PersistenceError::CorruptState(
                    "empty membership change".into(),
                ));
            }
            let add = change.add.iter().collect::<BTreeSet<_>>();
            let remove = change.remove.iter().collect::<BTreeSet<_>>();
            if add.len() != change.add.len()
                || remove.len() != change.remove.len()
                || !add.is_disjoint(&remove)
                || add.iter().chain(remove.iter()).any(|id| id.is_empty())
            {
                return Err(PersistenceError::CorruptState(
                    "invalid mailbox membership change".into(),
                ));
            }
        }
    }
    Ok(())
}

fn validate_outbound_address(value: &Address) -> PersistResult<()> {
    let unsafe_character = |text: &str| {
        text.chars()
            .any(|value| matches!(value, '\r' | '\n' | '\0'))
    };
    let Some(at) = value.email.find('@') else {
        return Err(PersistenceError::CorruptState(
            "invalid outbound address".into(),
        ));
    };
    if at == 0
        || at == value.email.len() - 1
        || unsafe_character(&value.email)
        || value.name.as_deref().is_some_and(unsafe_character)
    {
        return Err(PersistenceError::CorruptState(
            "invalid outbound address".into(),
        ));
    }
    Ok(())
}
