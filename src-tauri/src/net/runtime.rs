use std::{
    collections::HashMap,
    sync::{Arc, Mutex},
};

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use zeroize::Zeroizing;

use super::{
    dto::{
        NativeAttachmentDto, NativeBodyDto, NativeFindMessageIdRequest,
        NativeFindMessageIdResponse, NativeFlag, NativeMailOpenRequest, NativeMailOpenResponse,
        NativeMailboxDto, NativeMailboxSnapshotDto, NativeMessageRequest, NativeMoveRequest,
        NativeMoveResponse, NativeSmtpSubmitRequest, NativeSmtpSubmitResponse,
        NativeStoreFlagsRequest,
    },
    errors::{NativeMailErrorDto, NativeMailSessionDisposition},
    imap::ImapConnection,
    mime::parse_message,
    policy::resolve_verified_loopback,
    smtp,
};

#[derive(Default)]
pub struct ManagedNativeMailRuntime {
    sessions: Mutex<HashMap<String, Arc<Mutex<NativeMailSession>>>>,
}

struct NativeMailSession {
    username: String,
    password: Zeroizing<String>,
    smtp_endpoint: std::net::SocketAddr,
    imap: ImapConnection,
}

impl std::fmt::Debug for NativeMailSession {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        NativeMailSessionDebug {
            username: &self.username,
            password: self.password.as_str(),
            smtp_endpoint: self.smtp_endpoint,
        }
        .fmt(formatter)
    }
}

struct NativeMailSessionDebug<'a> {
    username: &'a str,
    password: &'a str,
    smtp_endpoint: std::net::SocketAddr,
}

impl std::fmt::Debug for NativeMailSessionDebug<'_> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        let _credential_length = self.password.len();
        formatter
            .debug_struct("NativeMailSession")
            .field("username", &self.username)
            .field("password", &"[REDACTED]")
            .field("smtp_endpoint", &self.smtp_endpoint)
            .field("imap", &"ImapConnection { .. }")
            .finish()
    }
}

impl ManagedNativeMailRuntime {
    pub fn open(
        &self,
        request: NativeMailOpenRequest,
    ) -> Result<NativeMailOpenResponse, NativeMailErrorDto> {
        let NativeMailOpenRequest {
            host,
            username,
            password,
            imap_port,
            smtp_port,
        } = request;
        let password = Zeroizing::new(password);
        let imap_endpoint = resolve_verified_loopback(&host, imap_port)?;
        let smtp_endpoint = resolve_verified_loopback(&host, smtp_port)?;
        let imap = ImapConnection::connect(imap_endpoint, &username, &password)?;
        let mut random = [0_u8; 16];
        getrandom::fill(&mut random)
            .map_err(|_| NativeMailErrorDto::unavailable("session_entropy_failed"))?;
        let session_id = URL_SAFE_NO_PAD.encode(random);
        let response = NativeMailOpenResponse {
            session_id: session_id.clone(),
            authenticated_user: username.clone(),
        };
        let session = NativeMailSession {
            username,
            password,
            smtp_endpoint,
            imap,
        };
        self.sessions
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("session_registry_poisoned"))?
            .insert(session_id, Arc::new(Mutex::new(session)));
        Ok(response)
    }

    pub fn close(&self, session_id: &str) -> Result<(), NativeMailErrorDto> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("session_registry_poisoned"))?
            .remove(session_id)
            .ok_or_else(|| NativeMailErrorDto::state_invalid("native_session_absent"))?;
        if let Ok(mut session) = session.lock() {
            session.imap.logout();
        }
        Ok(())
    }

    pub fn list_mailboxes(
        &self,
        session_id: &str,
    ) -> Result<Vec<NativeMailboxDto>, NativeMailErrorDto> {
        self.with_session(session_id, |session| session.imap.list_mailboxes())
    }

    pub fn snapshot_mailbox(
        &self,
        session_id: &str,
        mailbox: &str,
    ) -> Result<NativeMailboxSnapshotDto, NativeMailErrorDto> {
        self.with_session(session_id, |session| session.imap.snapshot(mailbox))
    }

    pub fn fetch_body(
        &self,
        request: &NativeMessageRequest,
    ) -> Result<NativeBodyDto, NativeMailErrorDto> {
        self.with_session(&request.session_id, |session| {
            let raw = session.imap.fetch_raw_checked(
                &request.mailbox,
                request.uid_validity,
                request.uid,
            )?;
            Ok(parse_message(&raw)?.body())
        })
    }

    pub fn fetch_attachments(
        &self,
        request: &NativeMessageRequest,
    ) -> Result<Vec<NativeAttachmentDto>, NativeMailErrorDto> {
        self.with_session(&request.session_id, |session| {
            let raw = session.imap.fetch_raw_checked(
                &request.mailbox,
                request.uid_validity,
                request.uid,
            )?;
            Ok(parse_message(&raw)?.attachments())
        })
    }

    pub fn find_message_id(
        &self,
        request: &NativeFindMessageIdRequest,
    ) -> Result<NativeFindMessageIdResponse, NativeMailErrorDto> {
        self.with_session_or(
            &request.session_id,
            NativeMailErrorDto::session_absent(),
            |session| {
                session
                    .imap
                    .find_message_id(&request.mailbox, &request.message_id)
            },
        )
    }

    pub fn store_flags(&self, request: &NativeStoreFlagsRequest) -> Result<(), NativeMailErrorDto> {
        let mut operations = Vec::with_capacity(request.add.len() + request.remove.len());
        for flag in &request.add {
            operations.push((true, flag_name(*flag)));
        }
        for flag in &request.remove {
            operations.push((false, flag_name(*flag)));
        }
        self.with_session(&request.session_id, |session| {
            session.imap.store_flags(
                &request.mailbox,
                request.uid_validity,
                request.uid,
                &operations,
            )
        })
    }

    pub fn move_message(
        &self,
        request: &NativeMoveRequest,
    ) -> Result<NativeMoveResponse, NativeMailErrorDto> {
        self.with_session(&request.session_id, |session| {
            session.imap.move_message(
                &request.mailbox,
                request.uid_validity,
                request.uid,
                &request.destination_mailbox,
            )
        })
    }

    pub fn smtp_submit(
        &self,
        request: &NativeSmtpSubmitRequest,
    ) -> Result<NativeSmtpSubmitResponse, NativeMailErrorDto> {
        self.with_session(&request.session_id, |session| {
            smtp::submit(
                session.smtp_endpoint,
                &session.username,
                &session.password,
                request,
            )
        })
    }

    fn with_session<T>(
        &self,
        session_id: &str,
        operation: impl FnOnce(&mut NativeMailSession) -> Result<T, NativeMailErrorDto>,
    ) -> Result<T, NativeMailErrorDto> {
        self.with_session_or(
            session_id,
            NativeMailErrorDto::state_invalid("native_session_absent"),
            operation,
        )
    }

    fn with_session_or<T>(
        &self,
        session_id: &str,
        absent: NativeMailErrorDto,
        operation: impl FnOnce(&mut NativeMailSession) -> Result<T, NativeMailErrorDto>,
    ) -> Result<T, NativeMailErrorDto> {
        let session = self
            .sessions
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("session_registry_poisoned"))?
            .get(session_id)
            .cloned()
            .ok_or(absent)?;
        let mut session = session
            .lock()
            .map_err(|_| NativeMailErrorDto::unavailable("native_session_poisoned"))?;
        let result = operation(&mut session);
        let must_expire = result
            .as_ref()
            .err()
            .is_some_and(|error| error.session == NativeMailSessionDisposition::Expire);
        drop(session);
        if must_expire && let Ok(mut sessions) = self.sessions.lock() {
            sessions.remove(session_id);
        }
        result
    }
}

fn flag_name(flag: NativeFlag) -> &'static str {
    match flag {
        NativeFlag::Seen => "\\Seen",
        NativeFlag::Flagged => "\\Flagged",
    }
}

#[cfg(test)]
mod tests {
    use super::{ManagedNativeMailRuntime, NativeMailSessionDebug};
    use crate::net::{
        dto::NativeMailOpenRequest,
        errors::{NativeMailErrorKind, NativeMailOutcome},
    };
    use std::fmt::Write as _;

    #[test]
    fn native_session_debug_never_exposes_password_source() {
        let canary = "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291";
        let session_debug = NativeMailSessionDebug {
            username: "alice@boxplot.test",
            password: canary,
            smtp_endpoint: "127.0.0.1:1587".parse().expect("SMTP endpoint"),
        };
        let mut value = String::new();
        let _ = write!(&mut value, "{session_debug:#?}");
        assert!(!value.contains(canary));
        assert!(value.contains("[REDACTED]"));
    }

    #[test]
    fn non_loopback_fails_closed_before_auth_and_does_not_retain_session() {
        let runtime = ManagedNativeMailRuntime::default();
        let canary = "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291";
        let error = runtime
            .open(NativeMailOpenRequest {
                host: "192.168.1.10".to_owned(),
                username: "alice@boxplot.test".to_owned(),
                password: canary.to_owned(),
                imap_port: 1143,
                smtp_port: 1587,
            })
            .expect_err("non-loopback must fail before connection");
        assert_eq!(error.kind, NativeMailErrorKind::Unsupported);
        assert_eq!(error.outcome, NativeMailOutcome::KnownNotApplied);
        assert!(!format!("{error:?}").contains(canary));
        assert!(
            runtime
                .list_mailboxes("not-a-session")
                .is_err_and(|error| error.kind == NativeMailErrorKind::StateInvalid)
        );
    }
}
