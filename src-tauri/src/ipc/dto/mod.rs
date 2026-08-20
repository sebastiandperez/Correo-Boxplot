use serde::{Deserialize, Serialize};

use crate::persistence as semantic;

pub const IPC_PROTOCOL_VERSION: u16 = 1;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcScopedMailboxId {
    pub account_key: String,
    pub jmap_mailbox_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcScopedEmailId {
    pub account_key: String,
    pub jmap_email_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcScopedIdentityId {
    pub account_key: String,
    pub jmap_identity_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcScopedThreadId {
    pub account_key: String,
    pub jmap_thread_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcScopedBlobId {
    pub account_key: String,
    pub jmap_blob_id: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcEmailAddress {
    pub name: Option<String>,
    pub email: String,
}
pub type IpcEmailAddressList = Option<Vec<IpcEmailAddress>>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcRemoteAccountRef {
    pub service_key: String,
    pub jmap_account_id: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcAccount {
    pub key: String,
    pub remote_ref: IpcRemoteAccountRef,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxRights {
    pub may_read_items: bool,
    pub may_add_items: bool,
    pub may_remove_items: bool,
    pub may_set_seen: bool,
    pub may_set_keywords: bool,
    pub may_submit: bool,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailbox {
    pub id: IpcScopedMailboxId,
    pub name: String,
    pub parent: Option<IpcScopedMailboxId>,
    pub role: Option<String>,
    pub sort_order: u32,
    pub total_emails: u64,
    pub unread_emails: u64,
    pub rights: IpcMailboxRights,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcIdentity {
    pub id: IpcScopedIdentityId,
    pub name: String,
    pub email: String,
    pub reply_to: IpcEmailAddressList,
    pub bcc: IpcEmailAddressList,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcEmail {
    pub id: IpcScopedEmailId,
    pub blob_id: IpcScopedBlobId,
    pub thread_id: IpcScopedThreadId,
    pub sender: IpcEmailAddressList,
    pub from: IpcEmailAddressList,
    pub reply_to: IpcEmailAddressList,
    pub to: IpcEmailAddressList,
    pub cc: IpcEmailAddressList,
    pub bcc: IpcEmailAddressList,
    pub subject: Option<String>,
    pub sent_at: Option<String>,
    pub received_at: String,
    pub size: u64,
    pub preview: String,
    pub has_attachment: bool,
    pub keywords: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcEmailMailbox {
    pub email_id: IpcScopedEmailId,
    pub mailbox_id: IpcScopedMailboxId,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcEmailBody {
    pub email_id: IpcScopedEmailId,
    pub text: Option<String>,
    pub html: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcAttachmentRef {
    pub email_id: IpcScopedEmailId,
    pub part_id: String,
    pub blob_id: IpcScopedBlobId,
    pub name: Option<String>,
    pub media_type: String,
    pub size: u64,
    pub disposition: Option<String>,
    pub cid: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IpcMailboxViewFilterSpec {
    All,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IpcSortDirection {
    Ascending,
    Descending,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxViewSortSpec {
    pub property: String,
    pub direction: IpcSortDirection,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxViewSpec {
    pub mailbox_id: IpcScopedMailboxId,
    pub filter: IpcMailboxViewFilterSpec,
    pub sort: IpcMailboxViewSortSpec,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcCoverageRange {
    pub start: u64,
    pub end_exclusive: u64,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxViewItem {
    pub position: u64,
    pub email_id: IpcScopedEmailId,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxView {
    pub spec: IpcMailboxViewSpec,
    pub query_state: String,
    pub total: u64,
    pub coverage: Vec<IpcCoverageRange>,
    pub items: Vec<IpcMailboxViewItem>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IpcCollectionDataType {
    Email,
    Mailbox,
    Identity,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcCollectionSyncCursor {
    pub account_key: String,
    pub data_type: IpcCollectionDataType,
    pub state: String,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IpcCursorPrecondition {
    Absent,
    Matches { cursor: IpcCollectionSyncCursor },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum IpcMatchingCursorPrecondition {
    Matches { cursor: IpcCollectionSyncCursor },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcSendBody {
    pub text: String,
    pub html: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcSendIntent {
    pub identity_id: IpcScopedIdentityId,
    pub from: IpcEmailAddress,
    pub reply_to: Vec<IpcEmailAddress>,
    pub to: Vec<IpcEmailAddress>,
    pub cc: Vec<IpcEmailAddress>,
    pub bcc: Vec<IpcEmailAddress>,
    pub subject: String,
    pub body: IpcSendBody,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcSendConfirmation {
    pub email_id: IpcScopedEmailId,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcSendMutationLifecycle {
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
        confirmation: IpcSendConfirmation,
    },
    FailedTerminal {
        attempt_count: u64,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcEmailUpdateLifecycle {
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
    },
    FailedTerminal {
        attempt_count: u64,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcPendingMutation {
    Send {
        mutation_id: String,
        account_key: String,
        created_at: String,
        intent: IpcSendIntent,
        lifecycle: IpcSendMutationLifecycle,
    },
    Keyword {
        mutation_id: String,
        account_key: String,
        created_at: String,
        email_id: IpcScopedEmailId,
        change: IpcKeywordChange,
        lifecycle: IpcEmailUpdateLifecycle,
    },
    MailboxMembership {
        mutation_id: String,
        account_key: String,
        created_at: String,
        email_id: IpcScopedEmailId,
        change: IpcMailboxMembershipChange,
        lifecycle: IpcEmailUpdateLifecycle,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcKeywordChange {
    pub add: Vec<String>,
    pub remove: Vec<String>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcMailboxMembershipChange {
    pub add: Vec<IpcScopedMailboxId>,
    pub remove: Vec<IpcScopedMailboxId>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IpcEmailSyncRecord {
    pub email: IpcEmail,
    pub memberships: Vec<IpcEmailMailbox>,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcCollectionSyncCommit {
    Email {
        #[serde(flatten)]
        commit: IpcEmailCollectionCommit,
    },
    Mailbox {
        #[serde(flatten)]
        commit: IpcMailboxCollectionCommit,
    },
    Identity {
        #[serde(flatten)]
        commit: IpcIdentityCollectionCommit,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcEmailCollectionCommit {
    Delta {
        expected_cursor: IpcMatchingCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        changed: Vec<IpcEmailSyncRecord>,
        destroyed: Vec<IpcScopedEmailId>,
    },
    Replace {
        expected_cursor: IpcCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        snapshot: Vec<IpcEmailSyncRecord>,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcMailboxCollectionCommit {
    Delta {
        expected_cursor: IpcMatchingCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        changed: Vec<IpcMailbox>,
        destroyed: Vec<IpcScopedMailboxId>,
    },
    Replace {
        expected_cursor: IpcCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        snapshot: Vec<IpcMailbox>,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "mode",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcIdentityCollectionCommit {
    Delta {
        expected_cursor: IpcMatchingCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        changed: Vec<IpcIdentity>,
        destroyed: Vec<IpcScopedIdentityId>,
    },
    Replace {
        expected_cursor: IpcCursorPrecondition,
        next_cursor: IpcCollectionSyncCursor,
        snapshot: Vec<IpcIdentity>,
    },
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum IpcLocalEntity<T> {
    Absent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum IpcOwnedSnapshot<T> {
    OwnerAbsent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum IpcOwnedOptional<T> {
    OwnerAbsent,
    Absent,
    Present(T),
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "value", rename_all = "camelCase")]
pub enum IpcOwnedCache<T> {
    OwnerAbsent,
    NotCached,
    Cached(T),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IpcReadErrorKind {
    Unavailable,
    CorruptState,
    Unexpected,
}
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum IpcWriteErrorKind {
    Unavailable,
    CorruptState,
    Conflict,
    Unexpected,
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IpcResult<T, E> {
    Ok { ok: IpcTrue, value: T },
    Error { ok: IpcFalse, error: IpcError<E> },
}
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcTrue;
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct IpcFalse;
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcError<E> {
    pub kind: E,
}

impl Serialize for IpcTrue {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(true)
    }
}
impl<'de> Deserialize<'de> for IpcTrue {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if bool::deserialize(d)? {
            Ok(Self)
        } else {
            Err(serde::de::Error::custom("expected true"))
        }
    }
}
impl Serialize for IpcFalse {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_bool(false)
    }
}
impl<'de> Deserialize<'de> for IpcFalse {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        if bool::deserialize(d)? {
            Err(serde::de::Error::custom("expected false"))
        } else {
            Ok(Self)
        }
    }
}
pub type IpcReadResult<T> = IpcResult<T, IpcReadErrorKind>;
pub type IpcWriteResult = IpcResult<(), IpcWriteErrorKind>;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum IpcLocalChangeHint {
    Accounts,
    Mailboxes {
        account_key: String,
    },
    Identities {
        account_key: String,
    },
    Emails {
        account_key: String,
    },
    EmailMemberships {
        account_key: String,
    },
    EmailBody {
        email_id: IpcScopedEmailId,
    },
    AttachmentRefs {
        email_id: IpcScopedEmailId,
    },
    MailboxView {
        spec: IpcMailboxViewSpec,
    },
    SyncCursor {
        account_key: String,
        data_type: IpcCollectionDataType,
    },
    PendingMutations {
        account_key: String,
    },
}
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct IpcLocalChangeBatch {
    pub hints: Vec<IpcLocalChangeHint>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct IpcEmptyRequest {}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcAccountKeyRequest {
    pub account_key: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcMailboxIdRequest {
    pub mailbox_id: IpcScopedMailboxId,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcIdentityIdRequest {
    pub identity_id: IpcScopedIdentityId,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcEmailIdRequest {
    pub email_id: IpcScopedEmailId,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcEmailIdsRequest {
    pub email_ids: Vec<IpcScopedEmailId>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcViewRequest {
    pub spec: IpcMailboxViewSpec,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcCursorRequest {
    pub account_key: String,
    pub data_type: IpcCollectionDataType,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcMutationIdRequest {
    pub account_key: String,
    pub mutation_id: String,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcAccountRequest {
    pub account: IpcAccount,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcCollectionCommitRequest {
    pub commit: IpcCollectionSyncCommit,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcBodyRequest {
    pub body: IpcEmailBody,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct IpcAttachmentsRequest {
    pub email_id: IpcScopedEmailId,
    pub refs: Vec<IpcAttachmentRef>,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMailboxViewRequest {
    pub view: IpcMailboxView,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMutationRequest {
    pub mutation: IpcPendingMutation,
}
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct IpcMutationCasRequest {
    pub expected: IpcPendingMutation,
    pub next: IpcPendingMutation,
}

fn addresses_to_semantic(v: IpcEmailAddressList) -> semantic::AddressList {
    v.map(|xs| {
        xs.into_iter()
            .map(|x| semantic::Address {
                name: x.name,
                email: x.email,
            })
            .collect()
    })
}
fn addresses_from_semantic(v: semantic::AddressList) -> IpcEmailAddressList {
    v.map(|xs| {
        xs.into_iter()
            .map(|x| IpcEmailAddress {
                name: x.name,
                email: x.email,
            })
            .collect()
    })
}
fn data_type_to_semantic(v: IpcCollectionDataType) -> semantic::CollectionDataType {
    match v {
        IpcCollectionDataType::Email => semantic::CollectionDataType::Email,
        IpcCollectionDataType::Mailbox => semantic::CollectionDataType::Mailbox,
        IpcCollectionDataType::Identity => semantic::CollectionDataType::Identity,
    }
}
pub fn data_type_to_semantic_public(v: IpcCollectionDataType) -> semantic::CollectionDataType {
    data_type_to_semantic(v)
}
fn data_type_from_semantic(v: semantic::CollectionDataType) -> IpcCollectionDataType {
    match v {
        semantic::CollectionDataType::Email => IpcCollectionDataType::Email,
        semantic::CollectionDataType::Mailbox => IpcCollectionDataType::Mailbox,
        semantic::CollectionDataType::Identity => IpcCollectionDataType::Identity,
    }
}

impl From<IpcAccount> for semantic::Account {
    fn from(v: IpcAccount) -> Self {
        Self {
            key: v.key,
            service_key: v.remote_ref.service_key,
            jmap_account_id: v.remote_ref.jmap_account_id,
        }
    }
}
impl From<semantic::Account> for IpcAccount {
    fn from(v: semantic::Account) -> Self {
        Self {
            key: v.key,
            remote_ref: IpcRemoteAccountRef {
                service_key: v.service_key,
                jmap_account_id: v.jmap_account_id,
            },
        }
    }
}
impl From<IpcMailbox> for semantic::Mailbox {
    fn from(v: IpcMailbox) -> Self {
        let account = v.id.account_key;
        Self {
            account_key: account.clone(),
            jmap_id: v.id.jmap_mailbox_id,
            name: v.name,
            parent_jmap_id: v.parent.map(|p| p.jmap_mailbox_id),
            role: v.role,
            sort_order: v.sort_order,
            total_emails: v.total_emails,
            unread_emails: v.unread_emails,
            rights: semantic::MailboxRights {
                may_read_items: v.rights.may_read_items,
                may_add_items: v.rights.may_add_items,
                may_remove_items: v.rights.may_remove_items,
                may_set_seen: v.rights.may_set_seen,
                may_set_keywords: v.rights.may_set_keywords,
                may_submit: v.rights.may_submit,
            },
        }
    }
}
impl From<semantic::Mailbox> for IpcMailbox {
    fn from(v: semantic::Mailbox) -> Self {
        let a = v.account_key;
        Self {
            id: IpcScopedMailboxId {
                account_key: a.clone(),
                jmap_mailbox_id: v.jmap_id,
            },
            name: v.name,
            parent: v.parent_jmap_id.map(|id| IpcScopedMailboxId {
                account_key: a,
                jmap_mailbox_id: id,
            }),
            role: v.role,
            sort_order: v.sort_order,
            total_emails: v.total_emails,
            unread_emails: v.unread_emails,
            rights: IpcMailboxRights {
                may_read_items: v.rights.may_read_items,
                may_add_items: v.rights.may_add_items,
                may_remove_items: v.rights.may_remove_items,
                may_set_seen: v.rights.may_set_seen,
                may_set_keywords: v.rights.may_set_keywords,
                may_submit: v.rights.may_submit,
            },
        }
    }
}
impl From<IpcIdentity> for semantic::Identity {
    fn from(v: IpcIdentity) -> Self {
        Self {
            account_key: v.id.account_key,
            jmap_id: v.id.jmap_identity_id,
            name: v.name,
            email: v.email,
            reply_to: addresses_to_semantic(v.reply_to),
            bcc: addresses_to_semantic(v.bcc),
        }
    }
}
impl From<semantic::Identity> for IpcIdentity {
    fn from(v: semantic::Identity) -> Self {
        Self {
            id: IpcScopedIdentityId {
                account_key: v.account_key,
                jmap_identity_id: v.jmap_id,
            },
            name: v.name,
            email: v.email,
            reply_to: addresses_from_semantic(v.reply_to),
            bcc: addresses_from_semantic(v.bcc),
        }
    }
}

impl From<IpcEmail> for semantic::Email {
    fn from(v: IpcEmail) -> Self {
        Self {
            account_key: v.id.account_key,
            jmap_id: v.id.jmap_email_id,
            blob_id: v.blob_id.jmap_blob_id,
            thread_id: v.thread_id.jmap_thread_id,
            sender: addresses_to_semantic(v.sender),
            from: addresses_to_semantic(v.from),
            reply_to: addresses_to_semantic(v.reply_to),
            to: addresses_to_semantic(v.to),
            cc: addresses_to_semantic(v.cc),
            bcc: addresses_to_semantic(v.bcc),
            subject: v.subject,
            sent_at: v.sent_at,
            received_at: v.received_at,
            size: v.size,
            preview: v.preview,
            has_attachment: v.has_attachment,
            keywords: v.keywords.into_iter().collect(),
        }
    }
}
impl From<semantic::Email> for IpcEmail {
    fn from(v: semantic::Email) -> Self {
        let a = v.account_key;
        Self {
            id: IpcScopedEmailId {
                account_key: a.clone(),
                jmap_email_id: v.jmap_id,
            },
            blob_id: IpcScopedBlobId {
                account_key: a.clone(),
                jmap_blob_id: v.blob_id,
            },
            thread_id: IpcScopedThreadId {
                account_key: a,
                jmap_thread_id: v.thread_id,
            },
            sender: addresses_from_semantic(v.sender),
            from: addresses_from_semantic(v.from),
            reply_to: addresses_from_semantic(v.reply_to),
            to: addresses_from_semantic(v.to),
            cc: addresses_from_semantic(v.cc),
            bcc: addresses_from_semantic(v.bcc),
            subject: v.subject,
            sent_at: v.sent_at,
            received_at: v.received_at,
            size: v.size,
            preview: v.preview,
            has_attachment: v.has_attachment,
            keywords: v.keywords.into_iter().collect(),
        }
    }
}
impl From<IpcEmailMailbox> for semantic::EmailMembership {
    fn from(v: IpcEmailMailbox) -> Self {
        Self {
            account_key: v.email_id.account_key,
            email_jmap_id: v.email_id.jmap_email_id,
            mailbox_jmap_id: v.mailbox_id.jmap_mailbox_id,
        }
    }
}
impl From<semantic::EmailMembership> for IpcEmailMailbox {
    fn from(v: semantic::EmailMembership) -> Self {
        let a = v.account_key;
        Self {
            email_id: IpcScopedEmailId {
                account_key: a.clone(),
                jmap_email_id: v.email_jmap_id,
            },
            mailbox_id: IpcScopedMailboxId {
                account_key: a,
                jmap_mailbox_id: v.mailbox_jmap_id,
            },
        }
    }
}
impl From<IpcEmailBody> for semantic::EmailBody {
    fn from(v: IpcEmailBody) -> Self {
        Self {
            account_key: v.email_id.account_key,
            email_jmap_id: v.email_id.jmap_email_id,
            text: v.text,
            html: v.html,
        }
    }
}
impl From<semantic::EmailBody> for IpcEmailBody {
    fn from(v: semantic::EmailBody) -> Self {
        Self {
            email_id: IpcScopedEmailId {
                account_key: v.account_key,
                jmap_email_id: v.email_jmap_id,
            },
            text: v.text,
            html: v.html,
        }
    }
}
impl From<IpcAttachmentRef> for semantic::AttachmentRef {
    fn from(v: IpcAttachmentRef) -> Self {
        Self {
            account_key: v.email_id.account_key,
            email_jmap_id: v.email_id.jmap_email_id,
            part_id: v.part_id,
            blob_id: v.blob_id.jmap_blob_id,
            name: v.name,
            media_type: v.media_type,
            size: v.size,
            disposition: v.disposition,
            cid: v.cid,
        }
    }
}
impl From<semantic::AttachmentRef> for IpcAttachmentRef {
    fn from(v: semantic::AttachmentRef) -> Self {
        let a = v.account_key;
        Self {
            email_id: IpcScopedEmailId {
                account_key: a.clone(),
                jmap_email_id: v.email_jmap_id,
            },
            part_id: v.part_id,
            blob_id: IpcScopedBlobId {
                account_key: a,
                jmap_blob_id: v.blob_id,
            },
            name: v.name,
            media_type: v.media_type,
            size: v.size,
            disposition: v.disposition,
            cid: v.cid,
        }
    }
}

impl From<IpcMailboxViewSpec> for semantic::MailboxViewSpec {
    fn from(v: IpcMailboxViewSpec) -> Self {
        Self {
            account_key: v.mailbox_id.account_key,
            mailbox_jmap_id: v.mailbox_id.jmap_mailbox_id,
            filter_kind: match v.filter {
                IpcMailboxViewFilterSpec::All => "all".into(),
            },
            sort_property: v.sort.property,
            sort_direction: match v.sort.direction {
                IpcSortDirection::Ascending => "ascending",
                IpcSortDirection::Descending => "descending",
            }
            .into(),
        }
    }
}
impl From<semantic::MailboxViewSpec> for IpcMailboxViewSpec {
    fn from(v: semantic::MailboxViewSpec) -> Self {
        Self {
            mailbox_id: IpcScopedMailboxId {
                account_key: v.account_key,
                jmap_mailbox_id: v.mailbox_jmap_id,
            },
            filter: IpcMailboxViewFilterSpec::All,
            sort: IpcMailboxViewSortSpec {
                property: v.sort_property,
                direction: if v.sort_direction == "ascending" {
                    IpcSortDirection::Ascending
                } else {
                    IpcSortDirection::Descending
                },
            },
        }
    }
}
impl From<IpcMailboxView> for semantic::MailboxView {
    fn from(v: IpcMailboxView) -> Self {
        Self {
            spec: v.spec.into(),
            query_state: v.query_state,
            total: v.total,
            coverage: v
                .coverage
                .into_iter()
                .map(|r| semantic::CoverageRange {
                    start: r.start,
                    end_exclusive: r.end_exclusive,
                })
                .collect(),
            items: v
                .items
                .into_iter()
                .map(|i| semantic::ViewItem {
                    position: i.position,
                    email_jmap_id: i.email_id.jmap_email_id,
                })
                .collect(),
        }
    }
}
impl From<semantic::MailboxView> for IpcMailboxView {
    fn from(v: semantic::MailboxView) -> Self {
        let a = v.spec.account_key.clone();
        Self {
            spec: v.spec.into(),
            query_state: v.query_state,
            total: v.total,
            coverage: v
                .coverage
                .into_iter()
                .map(|r| IpcCoverageRange {
                    start: r.start,
                    end_exclusive: r.end_exclusive,
                })
                .collect(),
            items: v
                .items
                .into_iter()
                .map(|i| IpcMailboxViewItem {
                    position: i.position,
                    email_id: IpcScopedEmailId {
                        account_key: a.clone(),
                        jmap_email_id: i.email_jmap_id,
                    },
                })
                .collect(),
        }
    }
}
impl From<IpcCollectionSyncCursor> for semantic::CollectionSyncCursor {
    fn from(v: IpcCollectionSyncCursor) -> Self {
        Self {
            account_key: v.account_key,
            data_type: data_type_to_semantic(v.data_type),
            state: v.state,
        }
    }
}
impl From<semantic::CollectionSyncCursor> for IpcCollectionSyncCursor {
    fn from(v: semantic::CollectionSyncCursor) -> Self {
        Self {
            account_key: v.account_key,
            data_type: data_type_from_semantic(v.data_type),
            state: v.state,
        }
    }
}
impl From<IpcCursorPrecondition> for semantic::CursorPrecondition {
    fn from(v: IpcCursorPrecondition) -> Self {
        match v {
            IpcCursorPrecondition::Absent => Self::Absent,
            IpcCursorPrecondition::Matches { cursor } => Self::Matches(cursor.into()),
        }
    }
}

fn address_to_semantic(v: IpcEmailAddress) -> semantic::Address {
    semantic::Address {
        name: v.name,
        email: v.email,
    }
}
fn address_from_semantic(v: semantic::Address) -> IpcEmailAddress {
    IpcEmailAddress {
        name: v.name,
        email: v.email,
    }
}
fn intent_to_semantic(v: IpcSendIntent) -> semantic::SendIntent {
    semantic::SendIntent {
        identity_jmap_id: v.identity_id.jmap_identity_id,
        from: address_to_semantic(v.from),
        reply_to: v.reply_to.into_iter().map(address_to_semantic).collect(),
        to: v.to.into_iter().map(address_to_semantic).collect(),
        cc: v.cc.into_iter().map(address_to_semantic).collect(),
        bcc: v.bcc.into_iter().map(address_to_semantic).collect(),
        subject: v.subject,
        body: semantic::SendBody {
            text: v.body.text,
            html: v.body.html,
        },
    }
}
fn intent_from_semantic(a: &str, v: semantic::SendIntent) -> IpcSendIntent {
    IpcSendIntent {
        identity_id: IpcScopedIdentityId {
            account_key: a.into(),
            jmap_identity_id: v.identity_jmap_id,
        },
        from: address_from_semantic(v.from),
        reply_to: v.reply_to.into_iter().map(address_from_semantic).collect(),
        to: v.to.into_iter().map(address_from_semantic).collect(),
        cc: v.cc.into_iter().map(address_from_semantic).collect(),
        bcc: v.bcc.into_iter().map(address_from_semantic).collect(),
        subject: v.subject,
        body: IpcSendBody {
            text: v.body.text,
            html: v.body.html,
        },
    }
}
fn send_lifecycle_to_semantic(v: IpcSendMutationLifecycle) -> semantic::MutationLifecycle {
    match v {
        IpcSendMutationLifecycle::Pending { attempt_count } => {
            semantic::MutationLifecycle::Pending { attempt_count }
        }
        IpcSendMutationLifecycle::InFlight { attempt_count } => {
            semantic::MutationLifecycle::InFlight { attempt_count }
        }
        IpcSendMutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        } => semantic::MutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        },
        IpcSendMutationLifecycle::Confirmed {
            attempt_count,
            confirmation,
        } => semantic::MutationLifecycle::Confirmed {
            attempt_count,
            confirmation_email_jmap_id: Some(confirmation.email_id.jmap_email_id),
        },
        IpcSendMutationLifecycle::FailedTerminal { attempt_count } => {
            semantic::MutationLifecycle::FailedTerminal { attempt_count }
        }
    }
}
fn update_lifecycle_to_semantic(v: IpcEmailUpdateLifecycle) -> semantic::MutationLifecycle {
    match v {
        IpcEmailUpdateLifecycle::Pending { attempt_count } => {
            semantic::MutationLifecycle::Pending { attempt_count }
        }
        IpcEmailUpdateLifecycle::InFlight { attempt_count } => {
            semantic::MutationLifecycle::InFlight { attempt_count }
        }
        IpcEmailUpdateLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        } => semantic::MutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        },
        IpcEmailUpdateLifecycle::Confirmed { attempt_count } => {
            semantic::MutationLifecycle::Confirmed {
                attempt_count,
                confirmation_email_jmap_id: None,
            }
        }
        IpcEmailUpdateLifecycle::FailedTerminal { attempt_count } => {
            semantic::MutationLifecycle::FailedTerminal { attempt_count }
        }
    }
}
fn send_lifecycle_from_semantic(
    a: &str,
    v: semantic::MutationLifecycle,
) -> IpcSendMutationLifecycle {
    match v {
        semantic::MutationLifecycle::Pending { attempt_count } => {
            IpcSendMutationLifecycle::Pending { attempt_count }
        }
        semantic::MutationLifecycle::InFlight { attempt_count } => {
            IpcSendMutationLifecycle::InFlight { attempt_count }
        }
        semantic::MutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        } => IpcSendMutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        },
        semantic::MutationLifecycle::Confirmed {
            attempt_count,
            confirmation_email_jmap_id,
        } => IpcSendMutationLifecycle::Confirmed {
            attempt_count,
            confirmation: IpcSendConfirmation {
                email_id: IpcScopedEmailId {
                    account_key: a.into(),
                    jmap_email_id: confirmation_email_jmap_id
                        .expect("validated send confirmation must exist"),
                },
            },
        },
        semantic::MutationLifecycle::FailedTerminal { attempt_count } => {
            IpcSendMutationLifecycle::FailedTerminal { attempt_count }
        }
    }
}
fn update_lifecycle_from_semantic(v: semantic::MutationLifecycle) -> IpcEmailUpdateLifecycle {
    match v {
        semantic::MutationLifecycle::Pending { attempt_count } => {
            IpcEmailUpdateLifecycle::Pending { attempt_count }
        }
        semantic::MutationLifecycle::InFlight { attempt_count } => {
            IpcEmailUpdateLifecycle::InFlight { attempt_count }
        }
        semantic::MutationLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        } => IpcEmailUpdateLifecycle::Retrying {
            attempt_count,
            next_attempt_at,
        },
        semantic::MutationLifecycle::Confirmed {
            attempt_count,
            confirmation_email_jmap_id,
        } => {
            debug_assert!(confirmation_email_jmap_id.is_none());
            IpcEmailUpdateLifecycle::Confirmed { attempt_count }
        }
        semantic::MutationLifecycle::FailedTerminal { attempt_count } => {
            IpcEmailUpdateLifecycle::FailedTerminal { attempt_count }
        }
    }
}
impl From<IpcPendingMutation> for semantic::PendingMutation {
    fn from(v: IpcPendingMutation) -> Self {
        match v {
            IpcPendingMutation::Send {
                mutation_id,
                account_key,
                created_at,
                intent,
                lifecycle,
            } => Self {
                account_key,
                mutation_id,
                created_at,
                payload: semantic::MutationPayload::Send(intent_to_semantic(intent)),
                lifecycle: send_lifecycle_to_semantic(lifecycle),
            },
            IpcPendingMutation::Keyword {
                mutation_id,
                account_key,
                created_at,
                email_id,
                change,
                lifecycle,
            } => Self {
                account_key,
                mutation_id,
                created_at,
                payload: semantic::MutationPayload::Keyword {
                    email_jmap_id: email_id.jmap_email_id,
                    change: semantic::KeywordChange {
                        add: change.add.into_iter().collect(),
                        remove: change.remove.into_iter().collect(),
                    },
                },
                lifecycle: update_lifecycle_to_semantic(lifecycle),
            },
            IpcPendingMutation::MailboxMembership {
                mutation_id,
                account_key,
                created_at,
                email_id,
                change,
                lifecycle,
            } => Self {
                account_key,
                mutation_id,
                created_at,
                payload: semantic::MutationPayload::MailboxMembership {
                    email_jmap_id: email_id.jmap_email_id,
                    change: semantic::MembershipChange {
                        add: change.add.into_iter().map(|x| x.jmap_mailbox_id).collect(),
                        remove: change
                            .remove
                            .into_iter()
                            .map(|x| x.jmap_mailbox_id)
                            .collect(),
                    },
                },
                lifecycle: update_lifecycle_to_semantic(lifecycle),
            },
        }
    }
}
impl From<semantic::PendingMutation> for IpcPendingMutation {
    fn from(v: semantic::PendingMutation) -> Self {
        let a = v.account_key;
        match v.payload {
            semantic::MutationPayload::Send(intent) => Self::Send {
                mutation_id: v.mutation_id,
                account_key: a.clone(),
                created_at: v.created_at,
                intent: intent_from_semantic(&a, intent),
                lifecycle: send_lifecycle_from_semantic(&a, v.lifecycle),
            },
            semantic::MutationPayload::Keyword {
                email_jmap_id,
                change,
            } => Self::Keyword {
                mutation_id: v.mutation_id,
                account_key: a.clone(),
                created_at: v.created_at,
                email_id: IpcScopedEmailId {
                    account_key: a,
                    jmap_email_id: email_jmap_id,
                },
                change: IpcKeywordChange {
                    add: change.add.into_iter().collect(),
                    remove: change.remove.into_iter().collect(),
                },
                lifecycle: update_lifecycle_from_semantic(v.lifecycle),
            },
            semantic::MutationPayload::MailboxMembership {
                email_jmap_id,
                change,
            } => Self::MailboxMembership {
                mutation_id: v.mutation_id,
                account_key: a.clone(),
                created_at: v.created_at,
                email_id: IpcScopedEmailId {
                    account_key: a.clone(),
                    jmap_email_id: email_jmap_id,
                },
                change: IpcMailboxMembershipChange {
                    add: change
                        .add
                        .into_iter()
                        .map(|id| IpcScopedMailboxId {
                            account_key: a.clone(),
                            jmap_mailbox_id: id,
                        })
                        .collect(),
                    remove: change
                        .remove
                        .into_iter()
                        .map(|id| IpcScopedMailboxId {
                            account_key: a.clone(),
                            jmap_mailbox_id: id,
                        })
                        .collect(),
                },
                lifecycle: update_lifecycle_from_semantic(v.lifecycle),
            },
        }
    }
}

impl From<IpcCollectionSyncCommit> for semantic::CollectionSyncCommit {
    fn from(v: IpcCollectionSyncCommit) -> Self {
        match v {
            IpcCollectionSyncCommit::Email { commit } => match commit {
                IpcEmailCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches { cursor },
                    next_cursor,
                    changed,
                    destroyed,
                } => Self::EmailDelta {
                    expected: cursor.into(),
                    next: next_cursor.into(),
                    changed: changed
                        .into_iter()
                        .map(|r| semantic::EmailSyncRecord {
                            email: r.email.into(),
                            memberships: r.memberships.into_iter().map(Into::into).collect(),
                        })
                        .collect(),
                    destroyed: destroyed.into_iter().map(|x| x.jmap_email_id).collect(),
                },
                IpcEmailCollectionCommit::Replace {
                    expected_cursor,
                    next_cursor,
                    snapshot,
                } => Self::EmailReplace {
                    expected: expected_cursor.into(),
                    next: next_cursor.into(),
                    snapshot: snapshot
                        .into_iter()
                        .map(|r| semantic::EmailSyncRecord {
                            email: r.email.into(),
                            memberships: r.memberships.into_iter().map(Into::into).collect(),
                        })
                        .collect(),
                },
            },
            IpcCollectionSyncCommit::Mailbox { commit } => match commit {
                IpcMailboxCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches { cursor },
                    next_cursor,
                    changed,
                    destroyed,
                } => Self::MailboxDelta {
                    expected: cursor.into(),
                    next: next_cursor.into(),
                    changed: changed.into_iter().map(Into::into).collect(),
                    destroyed: destroyed.into_iter().map(|x| x.jmap_mailbox_id).collect(),
                },
                IpcMailboxCollectionCommit::Replace {
                    expected_cursor,
                    next_cursor,
                    snapshot,
                } => Self::MailboxReplace {
                    expected: expected_cursor.into(),
                    next: next_cursor.into(),
                    snapshot: snapshot.into_iter().map(Into::into).collect(),
                },
            },
            IpcCollectionSyncCommit::Identity { commit } => match commit {
                IpcIdentityCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches { cursor },
                    next_cursor,
                    changed,
                    destroyed,
                } => Self::IdentityDelta {
                    expected: cursor.into(),
                    next: next_cursor.into(),
                    changed: changed.into_iter().map(Into::into).collect(),
                    destroyed: destroyed.into_iter().map(|x| x.jmap_identity_id).collect(),
                },
                IpcIdentityCollectionCommit::Replace {
                    expected_cursor,
                    next_cursor,
                    snapshot,
                } => Self::IdentityReplace {
                    expected: expected_cursor.into(),
                    next: next_cursor.into(),
                    snapshot: snapshot.into_iter().map(Into::into).collect(),
                },
            },
        }
    }
}

pub fn local_entity<T, U: From<T>>(v: semantic::LocalEntity<T>) -> IpcLocalEntity<U> {
    match v {
        semantic::LocalEntity::Absent => IpcLocalEntity::Absent,
        semantic::LocalEntity::Present(x) => IpcLocalEntity::Present(x.into()),
    }
}
pub fn owned_snapshot<T, U: From<T>>(
    v: semantic::OwnedSnapshot<Vec<T>>,
) -> IpcOwnedSnapshot<Vec<U>> {
    match v {
        semantic::OwnedSnapshot::OwnerAbsent => IpcOwnedSnapshot::OwnerAbsent,
        semantic::OwnedSnapshot::Present(xs) => {
            IpcOwnedSnapshot::Present(xs.into_iter().map(Into::into).collect())
        }
    }
}
pub fn owned_optional<T, U: From<T>>(v: semantic::OwnedOptional<T>) -> IpcOwnedOptional<U> {
    match v {
        semantic::OwnedOptional::OwnerAbsent => IpcOwnedOptional::OwnerAbsent,
        semantic::OwnedOptional::Absent => IpcOwnedOptional::Absent,
        semantic::OwnedOptional::Present(x) => IpcOwnedOptional::Present(x.into()),
    }
}
pub fn owned_cache<T, U: From<T>>(v: semantic::OwnedCache<T>) -> IpcOwnedCache<U> {
    match v {
        semantic::OwnedCache::OwnerAbsent => IpcOwnedCache::OwnerAbsent,
        semantic::OwnedCache::NotCached => IpcOwnedCache::NotCached,
        semantic::OwnedCache::Cached(x) => IpcOwnedCache::Cached(x.into()),
    }
}
pub fn owned_cache_vec<T, U: From<T>>(v: semantic::OwnedCache<Vec<T>>) -> IpcOwnedCache<Vec<U>> {
    match v {
        semantic::OwnedCache::OwnerAbsent => IpcOwnedCache::OwnerAbsent,
        semantic::OwnedCache::NotCached => IpcOwnedCache::NotCached,
        semantic::OwnedCache::Cached(xs) => {
            IpcOwnedCache::Cached(xs.into_iter().map(Into::into).collect())
        }
    }
}
pub fn read_ok<T>(value: T) -> IpcReadResult<T> {
    IpcResult::Ok { ok: IpcTrue, value }
}
pub fn write_ok() -> IpcWriteResult {
    IpcResult::Ok {
        ok: IpcTrue,
        value: (),
    }
}

pub fn validate_mailbox_scope(v: &IpcMailbox) -> Result<(), semantic::PersistenceError> {
    if v.parent
        .as_ref()
        .is_some_and(|p| p.account_key != v.id.account_key)
    {
        Err(semantic::PersistenceError::Conflict)
    } else {
        Ok(())
    }
}
pub fn validate_email_scope(v: &IpcEmail) -> Result<(), semantic::PersistenceError> {
    if v.blob_id.account_key != v.id.account_key || v.thread_id.account_key != v.id.account_key {
        Err(semantic::PersistenceError::Conflict)
    } else {
        Ok(())
    }
}
pub fn validate_attachment_scope(
    email: &IpcScopedEmailId,
    v: &IpcAttachmentRef,
) -> Result<(), semantic::PersistenceError> {
    if v.email_id != *email || v.blob_id.account_key != email.account_key {
        Err(semantic::PersistenceError::Conflict)
    } else {
        Ok(())
    }
}
pub fn validate_view_scope(v: &IpcMailboxView) -> Result<(), semantic::PersistenceError> {
    let a = &v.spec.mailbox_id.account_key;
    if v.items.iter().any(|i| &i.email_id.account_key != a) {
        Err(semantic::PersistenceError::Conflict)
    } else {
        Ok(())
    }
}
pub fn validate_mutation_scope(v: &IpcPendingMutation) -> Result<(), semantic::PersistenceError> {
    let valid = match v {
        IpcPendingMutation::Send {
            account_key,
            intent,
            lifecycle,
            ..
        } => {
            intent.identity_id.account_key == *account_key
                && match lifecycle {
                    IpcSendMutationLifecycle::Confirmed { confirmation, .. } => {
                        confirmation.email_id.account_key == *account_key
                    }
                    _ => true,
                }
        }
        IpcPendingMutation::Keyword {
            account_key,
            email_id,
            ..
        } => email_id.account_key == *account_key,
        IpcPendingMutation::MailboxMembership {
            account_key,
            email_id,
            change,
            ..
        } => {
            email_id.account_key == *account_key
                && change
                    .add
                    .iter()
                    .chain(&change.remove)
                    .all(|id| id.account_key == *account_key)
        }
    };
    if valid {
        Ok(())
    } else {
        Err(semantic::PersistenceError::Conflict)
    }
}
pub fn validate_collection_scope(
    v: &IpcCollectionSyncCommit,
) -> Result<(), semantic::PersistenceError> {
    match v {
        IpcCollectionSyncCommit::Email { commit } => match commit {
            IpcEmailCollectionCommit::Delta {
                next_cursor,
                changed,
                destroyed,
                ..
            } => {
                let a = &next_cursor.account_key;
                if next_cursor.data_type != IpcCollectionDataType::Email
                    || destroyed.iter().any(|x| &x.account_key != a)
                    || changed.iter().any(|r| {
                        validate_email_scope(&r.email).is_err()
                            || &r.email.id.account_key != a
                            || r.memberships.iter().any(|m| {
                                &m.email_id.account_key != a
                                    || &m.mailbox_id.account_key != a
                                    || m.email_id != r.email.id
                            })
                    })
                {
                    Err(semantic::PersistenceError::Conflict)
                } else {
                    Ok(())
                }
            }
            IpcEmailCollectionCommit::Replace {
                next_cursor,
                snapshot,
                ..
            } => validate_collection_scope(&IpcCollectionSyncCommit::Email {
                commit: IpcEmailCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches {
                        cursor: next_cursor.clone(),
                    },
                    next_cursor: next_cursor.clone(),
                    changed: snapshot.clone(),
                    destroyed: vec![],
                },
            }),
        },
        IpcCollectionSyncCommit::Mailbox { commit } => match commit {
            IpcMailboxCollectionCommit::Delta {
                next_cursor,
                changed,
                destroyed,
                ..
            } => {
                let a = &next_cursor.account_key;
                if next_cursor.data_type != IpcCollectionDataType::Mailbox
                    || destroyed.iter().any(|x| &x.account_key != a)
                    || changed
                        .iter()
                        .any(|m| &m.id.account_key != a || validate_mailbox_scope(m).is_err())
                {
                    Err(semantic::PersistenceError::Conflict)
                } else {
                    Ok(())
                }
            }
            IpcMailboxCollectionCommit::Replace {
                next_cursor,
                snapshot,
                ..
            } => validate_collection_scope(&IpcCollectionSyncCommit::Mailbox {
                commit: IpcMailboxCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches {
                        cursor: next_cursor.clone(),
                    },
                    next_cursor: next_cursor.clone(),
                    changed: snapshot.clone(),
                    destroyed: vec![],
                },
            }),
        },
        IpcCollectionSyncCommit::Identity { commit } => match commit {
            IpcIdentityCollectionCommit::Delta {
                next_cursor,
                changed,
                destroyed,
                ..
            } => {
                let a = &next_cursor.account_key;
                if next_cursor.data_type != IpcCollectionDataType::Identity
                    || destroyed.iter().any(|x| &x.account_key != a)
                    || changed.iter().any(|i| &i.id.account_key != a)
                {
                    Err(semantic::PersistenceError::Conflict)
                } else {
                    Ok(())
                }
            }
            IpcIdentityCollectionCommit::Replace {
                next_cursor,
                snapshot,
                ..
            } => validate_collection_scope(&IpcCollectionSyncCommit::Identity {
                commit: IpcIdentityCollectionCommit::Delta {
                    expected_cursor: IpcMatchingCursorPrecondition::Matches {
                        cursor: next_cursor.clone(),
                    },
                    next_cursor: next_cursor.clone(),
                    changed: snapshot.clone(),
                    destroyed: vec![],
                },
            }),
        },
    }
}
