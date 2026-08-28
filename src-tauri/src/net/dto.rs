use serde::{Deserialize, Serialize};

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailOpenRequest {
    pub host: String,
    pub username: String,
    pub password: String,
    pub imap_port: u16,
    pub smtp_port: u16,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailOpenResponse {
    pub session_id: String,
    pub authenticated_user: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSessionRequest {
    pub session_id: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAddressDto {
    pub name: Option<String>,
    pub email: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailboxDto {
    pub name: String,
    pub messages: u64,
    pub unseen: u64,
    pub uid_validity: u32,
    pub uid_next: u32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMessageMetadataDto {
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
    pub flags: Vec<String>,
    pub internal_date: String,
    pub size: u64,
    pub sender: Option<Vec<NativeAddressDto>>,
    pub from: Option<Vec<NativeAddressDto>>,
    pub reply_to: Option<Vec<NativeAddressDto>>,
    pub to: Option<Vec<NativeAddressDto>>,
    pub cc: Option<Vec<NativeAddressDto>>,
    pub bcc: Option<Vec<NativeAddressDto>>,
    pub subject: Option<String>,
    pub sent_at: Option<String>,
    pub preview: String,
    pub has_attachment: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailboxSnapshotDto {
    pub mailbox: NativeMailboxDto,
    pub messages: Vec<NativeMessageMetadataDto>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeBodyDto {
    Plain {
        text: Option<String>,
        html: Option<String>,
    },
    BoxplotE2ee {
        payload: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct NativeAttachmentDto {
    pub part_id: String,
    pub name: Option<String>,
    pub media_type: String,
    pub size: u64,
    pub disposition: Option<String>,
    pub cid: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMailboxRequest {
    pub session_id: String,
    pub mailbox: String,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMessageRequest {
    pub session_id: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum NativeFlag {
    Seen,
    Flagged,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeStoreFlagsRequest {
    pub session_id: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
    pub add: Vec<NativeFlag>,
    pub remove: Vec<NativeFlag>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMoveRequest {
    pub session_id: String,
    pub mailbox: String,
    pub uid_validity: u32,
    pub uid: u32,
    pub destination_mailbox: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeMoveResponse {
    pub source_mailbox: String,
    pub source_uid_validity: u32,
    pub source_uid: u32,
    pub destination_mailbox: String,
    pub destination_uid: u32,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum NativeSubmissionBodyDto {
    Plain { text: String, html: Option<String> },
    BoxplotE2ee { payload: String },
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSmtpSubmitRequest {
    pub session_id: String,
    pub from: NativeAddressDto,
    pub to: Vec<NativeAddressDto>,
    pub cc: Vec<NativeAddressDto>,
    pub bcc: Vec<NativeAddressDto>,
    pub reply_to: Vec<NativeAddressDto>,
    pub subject: String,
    pub body: NativeSubmissionBodyDto,
    pub idempotency_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NativeSmtpSubmitResponse {
    pub accepted: bool,
    pub receipt_id: String,
}
