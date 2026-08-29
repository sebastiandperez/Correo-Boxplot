use std::{
    net::{TcpStream, ToSocketAddrs},
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    thread,
    time::{Duration, Instant},
};

use correo_boxplot_lib::net::{
    ManagedNativeMailRuntime,
    dto::{
        NativeAddressDto, NativeFlag, NativeMailOpenRequest, NativeMessageRequest,
        NativeMoveRequest, NativeSmtpSubmitRequest, NativeStoreFlagsRequest,
        NativeSubmissionBodyDto,
    },
    errors::{NativeMailErrorKind, NativeMailOutcome, NativeMailRetry},
};

const HOST: &str = "127.0.0.1";
const IMAP_PORT: u16 = 1143;
const SMTP_PORT: u16 = 1587;

struct DemoServer {
    directory: PathBuf,
    child: Option<Child>,
}

impl DemoServer {
    fn start(reset: bool) -> Self {
        let directory = server_directory();
        if reset {
            let status = python(&directory)
                .current_dir(&directory)
                .args(["-m", "boxplot_mail_server", "--reset"])
                .status()
                .unwrap_or_else(|error| panic!("server reset failed: {error}"));
            assert!(status.success(), "server reset command failed");
        }
        let child = python(&directory)
            .current_dir(&directory)
            .args(["-m", "boxplot_mail_server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|error| panic!("server start failed: {error}"));
        wait_for_port(IMAP_PORT);
        wait_for_port(SMTP_PORT);
        Self {
            directory,
            child: Some(child),
        }
    }

    fn stop(&mut self) {
        if let Some(mut child) = self.child.take() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }

    fn restart(&mut self) {
        self.stop();
        let child = python(&self.directory)
            .current_dir(&self.directory)
            .args(["-m", "boxplot_mail_server"])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .unwrap_or_else(|error| panic!("server restart failed: {error}"));
        self.child = Some(child);
        wait_for_port(IMAP_PORT);
        wait_for_port(SMTP_PORT);
    }
}

impl Drop for DemoServer {
    fn drop(&mut self) {
        self.stop();
    }
}

#[test]
#[ignore = "requires sibling Servidor-Boxplot; run scripts/test-native-mail.sh"]
fn native_mail_alice_bob_acceptance() {
    let mut server = DemoServer::start(true);
    let runtime = ManagedNativeMailRuntime::default();

    let alice = open(&runtime, "alice@boxplot.test", "alice123");
    let bob = open(&runtime, "bob@boxplot.test", "bob123");
    let wrong = runtime
        .open(open_request("alice@boxplot.test", "wrong-password"))
        .expect_err("wrong password must fail");
    assert_eq!(wrong.kind, NativeMailErrorKind::Auth);
    let canary = "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291";
    let canary_error = runtime
        .open(open_request("alice@boxplot.test", canary))
        .expect_err("canary password must not authenticate");
    assert!(!format!("{canary_error:?}").contains(canary));

    for session in [&alice.session_id, &bob.session_id] {
        let names = runtime
            .list_mailboxes(session)
            .expect("mailbox listing")
            .into_iter()
            .map(|value| value.name)
            .collect::<Vec<_>>();
        assert_eq!(names, ["INBOX", "Sent", "Trash"]);
    }

    let accepted = runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "Hola Bob",
            NativeSubmissionBodyDto::Plain {
                text: "Mensaje desde Alice".to_owned(),
                html: None,
            },
            "alice-to-bob",
        ))
        .expect("Alice submission accepted");
    assert!(accepted.accepted);

    let alice_sent = runtime
        .snapshot_mailbox(&alice.session_id, "Sent")
        .expect("Alice Sent snapshot");
    assert_eq!(alice_sent.messages.len(), 1);
    let bob_inbox = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("Bob Inbox snapshot");
    let received = bob_inbox.messages.first().expect("Bob received message");
    assert_eq!(received.subject.as_deref(), Some("Hola Bob"));
    assert_eq!(
        received
            .from
            .as_ref()
            .and_then(|values| values.first())
            .map(|value| value.email.as_str()),
        Some("alice@boxplot.test")
    );
    assert_eq!(
        received
            .to
            .as_ref()
            .and_then(|values| values.first())
            .map(|value| value.email.as_str()),
        Some("bob@boxplot.test")
    );
    assert_eq!(received.preview, "Mensaje desde Alice");
    assert!(received.size > 0);
    assert!(!received.internal_date.is_empty());
    assert!(!received.flags.iter().any(|flag| flag == "\\Seen"));
    let target = NativeMessageRequest {
        session_id: bob.session_id.clone(),
        mailbox: "INBOX".to_owned(),
        uid_validity: received.uid_validity,
        uid: received.uid,
    };
    let body = runtime.fetch_body(&target).expect("BODY.PEEK fetch");
    assert!(
        matches!(body, correo_boxplot_lib::net::dto::NativeBodyDto::Plain { text: Some(ref value), html: None } if value.contains("Mensaje desde Alice"))
    );
    let after_peek = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("snapshot after peek");
    assert!(
        !after_peek.messages[0]
            .flags
            .iter()
            .any(|flag| flag == "\\Seen")
    );

    for flag in [NativeFlag::Seen, NativeFlag::Flagged] {
        runtime
            .store_flags(&NativeStoreFlagsRequest {
                session_id: bob.session_id.clone(),
                mailbox: "INBOX".to_owned(),
                uid_validity: received.uid_validity,
                uid: received.uid,
                add: vec![flag],
                remove: vec![],
            })
            .expect("flag add");
    }
    let flagged = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("flagged snapshot");
    assert!(flagged.messages[0].flags.contains(&"\\Seen".to_owned()));
    assert!(flagged.messages[0].flags.contains(&"\\Flagged".to_owned()));
    runtime
        .store_flags(&NativeStoreFlagsRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: received.uid_validity,
            uid: received.uid,
            add: vec![],
            remove: vec![NativeFlag::Seen, NativeFlag::Flagged],
        })
        .expect("flag removal");

    let stale = runtime
        .fetch_body(&NativeMessageRequest {
            uid_validity: received.uid_validity.saturating_add(1),
            ..target.clone()
        })
        .expect_err("stale UIDVALIDITY must fail before UID use");
    assert_eq!(stale.kind, NativeMailErrorKind::StateInvalid);

    let moved = runtime
        .move_message(&NativeMoveRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: received.uid_validity,
            uid: received.uid,
            destination_mailbox: "Trash".to_owned(),
        })
        .expect("move to Trash");
    assert_ne!(moved.destination_uid, 0);
    assert!(
        runtime
            .snapshot_mailbox(&bob.session_id, "INBOX")
            .expect("Inbox after move")
            .messages
            .is_empty()
    );
    assert_eq!(
        runtime
            .snapshot_mailbox(&bob.session_id, "Trash")
            .expect("Trash after move")
            .messages
            .len(),
        1
    );

    runtime
        .smtp_submit(&submission(
            &bob.session_id,
            "bob@boxplot.test",
            vec![address("alice@boxplot.test")],
            vec![],
            "Re: Hola Bob",
            NativeSubmissionBodyDto::Plain {
                text: "Recibido".to_owned(),
                html: None,
            },
            "bob-reply",
        ))
        .expect("Bob reply accepted");
    assert_eq!(
        runtime
            .snapshot_mailbox(&alice.session_id, "INBOX")
            .expect("Alice reply snapshot")
            .messages[0]
            .subject
            .as_deref(),
        Some("Re: Hola Bob")
    );

    runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "HTML",
            NativeSubmissionBodyDto::Plain {
                text: "plain".to_owned(),
                html: Some("<p>exact html</p>".to_owned()),
            },
            "html-message",
        ))
        .expect("HTML accepted");
    let html_snapshot = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("HTML snapshot");
    let html_message = html_snapshot
        .messages
        .iter()
        .find(|value| value.subject.as_deref() == Some("HTML"))
        .expect("HTML present");
    let html = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: html_message.uid_validity,
            uid: html_message.uid,
        })
        .expect("HTML body");
    assert!(
        matches!(html, correo_boxplot_lib::net::dto::NativeBodyDto::Plain { text: Some(ref text), html: Some(ref html) } if text == "plain" && html == "<p>exact html</p>")
    );

    runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "Encrypted transport",
            NativeSubmissionBodyDto::BoxplotE2ee {
                payload: "{\"version\":1,\"ciphertext\":\"opaque\"}".to_owned(),
            },
            "e2ee-transport",
        ))
        .expect("E2EE envelope accepted as opaque MIME");
    let e2ee_snapshot = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("E2EE snapshot");
    let e2ee_message = e2ee_snapshot
        .messages
        .iter()
        .find(|value| value.subject.as_deref() == Some("Encrypted transport"))
        .expect("E2EE transport present");
    let e2ee_body = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: e2ee_message.uid_validity,
            uid: e2ee_message.uid,
        })
        .expect("E2EE transport body");
    assert!(
        matches!(e2ee_body, correo_boxplot_lib::net::dto::NativeBodyDto::BoxplotE2ee { ref payload } if payload.contains("opaque"))
    );

    runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![],
            vec![address("bob@boxplot.test")],
            "Hidden",
            NativeSubmissionBodyDto::Plain {
                text: "secret recipient".to_owned(),
                html: None,
            },
            "bcc-message",
        ))
        .expect("Bcc accepted");
    let bcc_snapshot = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("Bcc snapshot");
    let hidden = bcc_snapshot
        .messages
        .iter()
        .find(|value| value.subject.as_deref() == Some("Hidden"))
        .expect("Bcc delivery exists");
    assert!(hidden.bcc.is_none() || hidden.bcc.as_ref().is_some_and(Vec::is_empty));

    deliver_attachment_fixture(&server.directory);
    let attachment_snapshot = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("attachment snapshot");
    let attachment_message = attachment_snapshot
        .messages
        .iter()
        .find(|value| value.subject.as_deref() == Some("Attachment fixture"))
        .expect("attachment fixture delivered");
    assert!(attachment_message.has_attachment);
    let attachments = runtime
        .fetch_attachments(&NativeMessageRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: attachment_message.uid_validity,
            uid: attachment_message.uid,
        })
        .expect("attachment metadata");
    assert_eq!(attachments.len(), 1);
    assert!(!attachments[0].part_id.is_empty());
    assert_eq!(attachments[0].name.as_deref(), Some("note.txt"));
    assert_eq!(attachments[0].media_type, "text/plain");
    assert!(attachments[0].size > 0);
    assert_eq!(attachments[0].disposition.as_deref(), Some("attachment"));
    assert_eq!(attachments[0].cid.as_deref(), Some("fixture@example"));

    let spoof = runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "bob@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "spoof",
            NativeSubmissionBodyDto::Plain {
                text: "no".to_owned(),
                html: None,
            },
            "spoof",
        ))
        .expect_err("spoof rejected before network");
    assert_eq!(spoof.kind, NativeMailErrorKind::Rejected);
    let oversized = runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "large",
            NativeSubmissionBodyDto::Plain {
                text: "x".repeat(1024 * 1024),
                html: None,
            },
            "large",
        ))
        .expect_err("oversized rejected before DATA");
    assert_eq!(oversized.kind, NativeMailErrorKind::TooLarge);
    assert_eq!(oversized.outcome, NativeMailOutcome::KnownNotApplied);

    runtime.close(&alice.session_id).expect("close Alice");
    runtime.close(&bob.session_id).expect("close Bob");
    assert_eq!(
        runtime
            .list_mailboxes(&alice.session_id)
            .expect_err("closed session invalid")
            .kind,
        NativeMailErrorKind::StateInvalid
    );

    server.stop();
    let started = Instant::now();
    let down = runtime
        .open(open_request("alice@boxplot.test", "alice123"))
        .expect_err("server down fails cleanly");
    assert!(started.elapsed() < Duration::from_secs(6));
    assert_eq!(down.retry, NativeMailRetry::SafeBackoff);

    server.restart();
    let reopened = open(&runtime, "bob@boxplot.test", "bob123");
    assert_eq!(
        runtime
            .snapshot_mailbox(&reopened.session_id, "Trash")
            .expect("persisted Trash after restart")
            .messages
            .len(),
        1
    );
    runtime.close(&reopened.session_id).expect("close reopened");
}

#[test]
#[ignore = "requires sibling Servidor-Boxplot; run scripts/test-native-mail.sh"]
fn independent_body_peek_and_move_identity_verification() {
    let _server = DemoServer::start(true);
    let runtime = ManagedNativeMailRuntime::default();
    let alice = open(&runtime, "alice@boxplot.test", "alice123");
    let bob = open(&runtime, "bob@boxplot.test", "bob123");

    runtime
        .smtp_submit(&submission(
            &alice.session_id,
            "alice@boxplot.test",
            vec![address("bob@boxplot.test")],
            vec![],
            "Independent BODY.PEEK and MOVE",
            NativeSubmissionBodyDto::Plain {
                text: "independent unread body".to_owned(),
                html: None,
            },
            "independent-body-peek-move",
        ))
        .expect("independent fixture accepted");

    let inbox = runtime
        .snapshot_mailbox(&bob.session_id, "INBOX")
        .expect("initial independent Inbox snapshot");
    let received = inbox
        .messages
        .iter()
        .find(|message| message.subject.as_deref() == Some("Independent BODY.PEEK and MOVE"))
        .expect("independent message present")
        .clone();
    assert!(!received.flags.contains(&"\\Seen".to_owned()));
    let target = NativeMessageRequest {
        session_id: bob.session_id.clone(),
        mailbox: "INBOX".to_owned(),
        uid_validity: received.uid_validity,
        uid: received.uid,
    };

    runtime.fetch_body(&target).expect("independent body fetch");
    assert!(
        !runtime
            .snapshot_mailbox(&bob.session_id, "INBOX")
            .expect("snapshot after body fetch")
            .messages[0]
            .flags
            .contains(&"\\Seen".to_owned())
    );
    assert!(
        runtime
            .fetch_attachments(&target)
            .expect("independent attachment metadata fetch")
            .is_empty()
    );
    assert!(
        !runtime
            .snapshot_mailbox(&bob.session_id, "INBOX")
            .expect("snapshot after attachment fetch")
            .messages[0]
            .flags
            .contains(&"\\Seen".to_owned())
    );

    for (flag, wire) in [
        (NativeFlag::Seen, "\\Seen"),
        (NativeFlag::Flagged, "\\Flagged"),
    ] {
        runtime
            .store_flags(&NativeStoreFlagsRequest {
                session_id: bob.session_id.clone(),
                mailbox: "INBOX".to_owned(),
                uid_validity: received.uid_validity,
                uid: received.uid,
                add: vec![flag],
                remove: vec![],
            })
            .expect("independent flag add");
        assert!(
            runtime
                .snapshot_mailbox(&bob.session_id, "INBOX")
                .expect("snapshot after flag add")
                .messages[0]
                .flags
                .contains(&wire.to_owned())
        );
        runtime
            .store_flags(&NativeStoreFlagsRequest {
                session_id: bob.session_id.clone(),
                mailbox: "INBOX".to_owned(),
                uid_validity: received.uid_validity,
                uid: received.uid,
                add: vec![],
                remove: vec![flag],
            })
            .expect("independent flag remove");
        assert!(
            !runtime
                .snapshot_mailbox(&bob.session_id, "INBOX")
                .expect("snapshot after flag remove")
                .messages[0]
                .flags
                .contains(&wire.to_owned())
        );
    }

    let moved = runtime
        .move_message(&NativeMoveRequest {
            session_id: bob.session_id.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: received.uid_validity,
            uid: received.uid,
            destination_mailbox: "Trash".to_owned(),
        })
        .expect("independent move accepted");
    assert!(
        runtime
            .snapshot_mailbox(&bob.session_id, "INBOX")
            .expect("source snapshot after move")
            .messages
            .is_empty()
    );
    let trash = runtime
        .snapshot_mailbox(&bob.session_id, "Trash")
        .expect("destination snapshot after move");
    let destination = trash
        .messages
        .iter()
        .find(|message| message.subject.as_deref() == Some("Independent BODY.PEEK and MOVE"))
        .expect("moved message has destination identity");
    assert_eq!(destination.uid, moved.destination_uid);
    assert_ne!(
        ("INBOX", received.uid_validity, received.uid),
        ("Trash", destination.uid_validity, destination.uid)
    );

    runtime.close(&alice.session_id).expect("close Alice");
    runtime.close(&bob.session_id).expect("close Bob");
}

fn open(
    runtime: &ManagedNativeMailRuntime,
    username: &str,
    password: &str,
) -> correo_boxplot_lib::net::dto::NativeMailOpenResponse {
    runtime
        .open(open_request(username, password))
        .expect("native session opens")
}

fn open_request(username: &str, password: &str) -> NativeMailOpenRequest {
    NativeMailOpenRequest {
        host: HOST.to_owned(),
        username: username.to_owned(),
        password: password.to_owned(),
        imap_port: IMAP_PORT,
        smtp_port: SMTP_PORT,
    }
}

fn submission(
    session_id: &str,
    from: &str,
    to: Vec<NativeAddressDto>,
    bcc: Vec<NativeAddressDto>,
    subject: &str,
    body: NativeSubmissionBodyDto,
    idempotency_key: &str,
) -> NativeSmtpSubmitRequest {
    NativeSmtpSubmitRequest {
        session_id: session_id.to_owned(),
        from: address(from),
        to,
        cc: vec![],
        bcc,
        reply_to: vec![],
        subject: subject.to_owned(),
        body,
        idempotency_key: idempotency_key.to_owned(),
    }
}

fn address(email: &str) -> NativeAddressDto {
    NativeAddressDto {
        name: None,
        email: email.to_owned(),
    }
}

fn server_directory() -> PathBuf {
    std::env::var_os("BOXPLOT_MAIL_SERVER_DIR")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            Path::new(env!("CARGO_MANIFEST_DIR"))
                .parent()
                .and_then(Path::parent)
                .map(|path| path.join("Servidor-Boxplot"))
                .unwrap_or_else(|| PathBuf::from("../Servidor-Boxplot"))
        })
}

fn python(directory: &Path) -> Command {
    let mut command = Command::new(directory.join(".venv/bin/python"));
    command.env("PYTHONUNBUFFERED", "1");
    command
}

fn deliver_attachment_fixture(directory: &Path) {
    let source = r#"
import smtplib
from email.message import EmailMessage
m = EmailMessage()
m['From'] = 'alice@boxplot.test'
m['To'] = 'bob@boxplot.test'
m['Subject'] = 'Attachment fixture'
m.set_content('fixture body')
m.add_attachment(b'hello attachment', maintype='text', subtype='plain', filename='note.txt', cid='fixture@example')
with smtplib.SMTP('127.0.0.1', 1587) as smtp:
    smtp.login('alice@boxplot.test', 'alice123')
    smtp.send_message(m)
"#;
    let status = python(directory)
        .current_dir(directory)
        .args(["-c", source])
        .status()
        .unwrap_or_else(|error| panic!("attachment fixture failed: {error}"));
    assert!(status.success(), "attachment fixture command failed");
}

fn wait_for_port(port: u16) {
    let deadline = Instant::now() + Duration::from_secs(10);
    let endpoint = (HOST, port)
        .to_socket_addrs()
        .unwrap_or_else(|error| panic!("resolve test endpoint: {error}"))
        .next()
        .unwrap_or_else(|| panic!("missing test endpoint"));
    while Instant::now() < deadline {
        if TcpStream::connect_timeout(&endpoint, Duration::from_millis(100)).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(25));
    }
    panic!("server port {port} did not become ready");
}
