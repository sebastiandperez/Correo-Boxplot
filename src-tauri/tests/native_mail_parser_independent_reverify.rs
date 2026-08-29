use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::mpsc,
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use correo_boxplot_lib::net::{
    ManagedNativeMailRuntime,
    dto::{
        NativeBodyDto, NativeFlag, NativeMailOpenRequest, NativeMessageRequest,
        NativeStoreFlagsRequest,
    },
    errors::{
        NativeMailErrorDto, NativeMailErrorKind, NativeMailOutcome, NativeMailRetry,
        NativeMailSessionDisposition,
    },
};

const USER: &str = "parser-reverify@boxplot.test";
const SECRET: &str = "PARSER_REVERIFY_SECRET_48721";
const UID_VALIDITY: u32 = 77;
const MAX_LINE: usize = 65_536;
const MAX_LITERAL: usize = 2_097_152;

struct IndependentServer {
    port: u16,
    task: JoinHandle<()>,
}

impl IndependentServer {
    fn join(self) {
        self.task.join().expect("independent IMAP server panicked");
    }
}

/// A deliberately small wire actor owned by this verification suite. It does not
/// import or share parsing, response, or peer helpers with production or repair tests.
struct WireActor {
    input: BufReader<TcpStream>,
    output: TcpStream,
}

impl WireActor {
    fn attach(stream: TcpStream) -> Self {
        stream
            .set_read_timeout(Some(Duration::from_secs(4)))
            .expect("set server read timeout");
        stream
            .set_write_timeout(Some(Duration::from_secs(4)))
            .expect("set server write timeout");
        let input = BufReader::new(stream.try_clone().expect("clone accepted stream"));
        Self {
            input,
            output: stream,
        }
    }

    fn bytes(&mut self, value: &[u8]) {
        self.output.write_all(value).expect("write wire bytes");
        self.output.flush().expect("flush wire bytes");
    }

    fn fragmented_bytes(&mut self, value: &[u8]) {
        for byte in value {
            self.output.write_all(&[*byte]).expect("write fragment");
            self.output.flush().expect("flush fragment");
        }
    }

    fn client_command(&mut self) -> (String, String) {
        let mut value = String::new();
        let count = self
            .input
            .read_line(&mut value)
            .expect("read client command");
        assert!(count > 0, "client closed before command");
        let value = value.trim_end_matches(['\r', '\n']);
        let (tag, command) = value.split_once(' ').expect("tagged client command");
        (tag.to_owned(), command.to_owned())
    }

    fn expect_command(&mut self, expected: &str) -> String {
        let (tag, command) = self.client_command();
        assert_eq!(command, expected);
        tag
    }

    fn ok(&mut self, tag: &str) {
        self.bytes(format!("{tag} OK done\r\n").as_bytes());
    }

    fn authenticate(&mut self) {
        self.bytes(b"* OK independent parser verifier\r\n");
        let (tag, login) = self.client_command();
        assert!(login.starts_with("LOGIN "));
        assert!(login.contains(USER));
        assert!(login.contains(SECRET));
        self.ok(&tag);
    }

    fn select(&mut self, include_uid_validity: bool) {
        let tag = self.expect_command("SELECT \"INBOX\"");
        if include_uid_validity {
            self.bytes(format!("* OK [UIDVALIDITY {UID_VALIDITY}] selected\r\n").as_bytes());
        }
        self.ok(&tag);
    }

    fn status(&mut self, uids: &[u32], unseen: u64) {
        let tag = self.expect_command("STATUS \"INBOX\" (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)");
        let next = uids.iter().copied().max().unwrap_or(0).saturating_add(1);
        self.bytes(
            format!(
                "* STATUS \"INBOX\" (MESSAGES {} UNSEEN {unseen} UIDNEXT {next} UIDVALIDITY {UID_VALIDITY})\r\n",
                uids.len()
            )
            .as_bytes(),
        );
        self.ok(&tag);
    }

    fn search(&mut self, uids: &[u32]) {
        let tag = self.expect_command("UID SEARCH ALL");
        let suffix = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        let response = if suffix.is_empty() {
            "* SEARCH\r\n".to_owned()
        } else {
            format!("* SEARCH {suffix}\r\n")
        };
        self.bytes(response.as_bytes());
        self.ok(&tag);
    }

    fn full_fetch(&mut self, requested_uid: u32, sequence: u32, uid_field: &str, raw: &[u8]) {
        let tag = self.expect_command(&format!(
            "UID FETCH {requested_uid} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])"
        ));
        self.bytes(
            format!(
                "* {sequence} FETCH ({uid_field} FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE {} BODY[] {{{}}}\r\n",
                raw.len(),
                raw.len()
            )
            .as_bytes(),
        );
        self.bytes(raw);
        self.bytes(b")\r\n");
        self.ok(&tag);
    }

    fn flag_fetch(&mut self, uid: u32, flags: &str) {
        let tag = self.expect_command(&format!("UID FETCH {uid} (UID FLAGS)"));
        self.bytes(format!("* 9 FETCH (UID {uid} FLAGS ({flags}))\r\n").as_bytes());
        self.ok(&tag);
    }
}

fn launch(script: impl FnOnce(TcpStream) + Send + 'static) -> IndependentServer {
    let listener = TcpListener::bind(("127.0.0.1", 0)).expect("bind independent loopback server");
    let port = listener.local_addr().expect("server address").port();
    let task = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept IMAP client");
        script(stream);
    });
    IndependentServer { port, task }
}

fn unused_port() -> u16 {
    TcpListener::bind(("127.0.0.1", 0))
        .expect("reserve unused port")
        .local_addr()
        .expect("unused port address")
        .port()
}

fn open(runtime: &ManagedNativeMailRuntime, server: &IndependentServer) -> String {
    runtime
        .open(NativeMailOpenRequest {
            host: "127.0.0.1".to_owned(),
            username: USER.to_owned(),
            password: SECRET.to_owned(),
            imap_port: server.port,
            smtp_port: unused_port(),
        })
        .expect("independent test session opens")
        .session_id
}

fn message_request(session_id: &str) -> NativeMessageRequest {
    NativeMessageRequest {
        session_id: session_id.to_owned(),
        mailbox: "INBOX".to_owned(),
        uid_validity: UID_VALIDITY,
        uid: 42,
    }
}

fn message(subject: &str, body: &[u8]) -> Vec<u8> {
    let mut raw = format!(
        "From: A <a@boxplot.test>\r\nTo: B <b@boxplot.test>\r\nSubject: {subject}\r\nDate: Fri, 28 Aug 2026 12:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n"
    )
    .into_bytes();
    raw.extend_from_slice(body);
    raw
}

fn message_with_attachment(marker: &str) -> Vec<u8> {
    format!(
        "From: A <a@boxplot.test>\r\nTo: B <b@boxplot.test>\r\nSubject: wrong UID\r\nMIME-Version: 1.0\r\nContent-Type: multipart/mixed; boundary=x\r\n\r\n--x\r\nContent-Type: text/plain\r\n\r\nbody-{marker}\r\n--x\r\nContent-Type: application/octet-stream\r\nContent-Disposition: attachment; filename=\"{marker}.bin\"\r\nContent-Transfer-Encoding: base64\r\n\r\nQQ==\r\n--x--\r\n"
    )
    .into_bytes()
}

fn assert_error(
    error: &NativeMailErrorDto,
    kind: NativeMailErrorKind,
    code: &'static str,
    session: NativeMailSessionDisposition,
) {
    assert_eq!(error.kind, kind);
    assert_eq!(error.code, Some(code));
    assert_eq!(error.session, session);
}

fn assert_session_absent(runtime: &ManagedNativeMailRuntime, session_id: &str) {
    let error = runtime
        .list_mailboxes(session_id)
        .expect_err("expired parser session must be absent");
    assert_error(
        &error,
        NativeMailErrorKind::StateInvalid,
        "native_session_absent",
        NativeMailSessionDisposition::Keep,
    );
}

#[test]
fn rv01_rv04_uid_identity_is_the_uid_attribute_not_sequence_number() {
    for operation in ["body", "attachments", "snapshot"] {
        let raw = message_with_attachment("uid-99-secret");
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.authenticate();
            wire.select(true);
            if operation == "snapshot" {
                wire.status(&[42], 1);
                wire.search(&[42]);
            }
            wire.full_fetch(42, 42, "UID 99", &raw);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, &server);
        let error = match operation {
            "body" => runtime
                .fetch_body(&message_request(&session))
                .expect_err("UID 99 body must never be associated with UID 42"),
            "attachments" => runtime
                .fetch_attachments(&message_request(&session))
                .expect_err("UID 99 attachments must never be associated with UID 42"),
            "snapshot" => runtime
                .snapshot_mailbox(&session, "INBOX")
                .expect_err("UID 99 must never enter UID 42 snapshot"),
            _ => unreachable!(),
        };
        if operation == "snapshot" {
            assert_error(
                &error,
                NativeMailErrorKind::Conflict,
                "imap_snapshot_changed",
                NativeMailSessionDisposition::Keep,
            );
        } else {
            assert_error(
                &error,
                NativeMailErrorKind::StateInvalid,
                "imap_uid_mismatch",
                NativeMailSessionDisposition::Keep,
            );
        }
        server.join();
    }

    let raw = message("sequence differs", b"accepted");
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        wire.full_fetch(42, 999, "UID 42", &raw);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    assert_eq!(
        runtime.fetch_body(&message_request(&session)),
        Ok(NativeBodyDto::Plain {
            text: Some("accepted".to_owned()),
            html: None,
        })
    );
    server.join();
}

#[test]
fn rv02_rv03_missing_and_malformed_uid_are_typed_and_expire() {
    for uid_field in [
        "",
        "UID abc",
        "UID -1",
        "UID 4294967296",
        "UID 999999999999999999999999",
    ] {
        let raw = message("invalid UID", b"must not escape");
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.authenticate();
            wire.select(true);
            wire.full_fetch(42, 7, uid_field, &raw);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, &server);
        let error = runtime
            .fetch_body(&message_request(&session))
            .expect_err("missing/malformed UID must fail");
        assert_error(
            &error,
            NativeMailErrorKind::Protocol,
            if uid_field.is_empty() {
                "imap_uid_missing"
            } else {
                "imap_uid_invalid"
            },
            NativeMailSessionDisposition::Expire,
        );
        assert_session_absent(&runtime, &session);
        server.join();
    }
}

#[test]
fn rv05_duplicate_literal_fetch_is_rejected_without_returning_a_body() {
    let first = message("first", b"first");
    let second = message("second", b"second");
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        let tag =
            wire.expect_command("UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])");
        for (sequence, raw) in [(1, first), (2, second)] {
            wire.bytes(
                format!(
                    "* {sequence} FETCH (UID 42 FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE {} BODY[] {{{}}}\r\n",
                    raw.len(), raw.len()
                )
                .as_bytes(),
            );
            wire.bytes(&raw);
            wire.bytes(b")\r\n");
        }
        wire.ok(&tag);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .fetch_body(&message_request(&session))
        .expect_err("duplicate FETCH must not pick first or last");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_fetch_duplicate",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    server.join();
}

#[test]
fn rv06_rv08_line_boundary_overflow_and_fragmentation_are_observable_on_wire() {
    let server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        let tag = wire.expect_command("LIST \"\" \"*\"");
        let mut line = vec![b'x'; MAX_LINE - 2];
        line.extend_from_slice(b"\r\n");
        wire.fragmented_bytes(&line);
        wire.fragmented_bytes(format!("{tag} OK done\r\n").as_bytes());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    assert_eq!(runtime.list_mailboxes(&session), Ok(Vec::new()));
    server.join();

    for newline in [true, false] {
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.authenticate();
            let _tag = wire.expect_command("LIST \"\" \"*\"");
            let mut line = vec![b'x'; if newline { MAX_LINE } else { MAX_LINE + 1 }];
            if newline {
                line.extend_from_slice(b"\n");
            }
            wire.bytes(&line);
            let mut probe = [0_u8; 1];
            let read = wire.input.get_mut().read(&mut probe).unwrap_or(0);
            assert_eq!(
                read, 0,
                "client must close without waiting for newline/server close"
            );
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, &server);
        let started = Instant::now();
        let error = runtime
            .list_mailboxes(&session)
            .expect_err("line beyond configured byte bound");
        assert!(started.elapsed() < Duration::from_secs(3));
        assert_error(
            &error,
            NativeMailErrorKind::Protocol,
            "imap_line_too_large",
            NativeMailSessionDisposition::Expire,
        );
        assert_session_absent(&runtime, &session);
        server.join();
    }
}

#[test]
fn rv09_rv12_literal_boundaries_and_invalid_markers_fail_before_payload_read() {
    let header = message("literal max", b"");
    let mut raw = header;
    raw.resize(MAX_LITERAL, b'z');
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        wire.full_fetch(42, 1, "UID 42", &raw);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let body = runtime
        .fetch_body(&message_request(&session))
        .expect("literal exactly at configured maximum is accepted");
    assert!(matches!(body, NativeBodyDto::Plain { .. }));
    server.join();

    for (marker, code) in [
        ("2097153", "imap_literal_too_large"),
        ("184467440737095516160", "imap_literal_length_invalid"),
        (
            "999999999999999999999999999999999999",
            "imap_literal_length_invalid",
        ),
        ("", "imap_literal_length_invalid"),
        ("abc", "imap_literal_length_invalid"),
        ("-1", "imap_literal_length_invalid"),
        ("+1", "imap_literal_length_invalid"),
    ] {
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.authenticate();
            wire.select(true);
            let _tag = wire
                .expect_command("UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])");
            wire.bytes(
                format!(
                    "* 1 FETCH (UID 42 FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE 1 BODY[] {{{marker}}}\r\n"
                )
                .as_bytes(),
            );
            let mut probe = [0_u8; 1];
            let read = wire.input.get_mut().read(&mut probe).unwrap_or(0);
            assert_eq!(
                read, 0,
                "literal header must be rejected before payload read"
            );
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, &server);
        let error = runtime
            .fetch_body(&message_request(&session))
            .expect_err("invalid literal header must fail");
        assert_error(
            &error,
            NativeMailErrorKind::Protocol,
            code,
            NativeMailSessionDisposition::Expire,
        );
        assert_session_absent(&runtime, &session);
        server.join();
    }
}

#[test]
fn rv13_rv15_independent_response_budgets_are_enforced() {
    let line_server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        let _tag = wire.expect_command("LIST \"\" \"*\"");
        for _ in 0..4097 {
            if wire.output.write_all(b"* OK x\r\n").is_err() {
                break;
            }
        }
        let _ = wire.output.flush();
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &line_server);
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("response line count is bounded");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_response_too_large",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    line_server.join();

    let text_server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        let _tag = wire.expect_command("LIST \"\" \"*\"");
        let mut line = vec![b't'; 60_000];
        line.extend_from_slice(b"\r\n");
        for _ in 0..18 {
            if wire.output.write_all(&line).is_err() {
                break;
            }
        }
        let _ = wire.output.flush();
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &text_server);
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("cumulative response text is bounded independently");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_response_too_large",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    text_server.join();

    let literal_server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        let _tag =
            wire.expect_command("UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])");
        let first = MAX_LITERAL / 2;
        wire.bytes(format!("* 1 FETCH (UID 42 BODY[] {{{first}}}\r\n").as_bytes());
        wire.bytes(&vec![b'a'; first]);
        wire.bytes(b")\r\n");
        wire.bytes(format!("* 2 FETCH (UID 42 BODY[] {{{}}}\r\n", first + 1).as_bytes());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &literal_server);
    let error = runtime
        .fetch_body(&message_request(&session))
        .expect_err("cumulative literal bytes are bounded before second allocation/read");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_literal_too_large",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    literal_server.join();
}

#[test]
fn rv17_tagged_status_distinguishes_malformed_from_normal_rejection() {
    let server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        let tag = wire.expect_command("LIST \"\" \"*\"");
        wire.bytes(format!("{tag} WHAT nonsense\r\n").as_bytes());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("unknown tagged status is malformed protocol");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_tagged_response_invalid",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    server.join();

    for status in ["NO rejected", "BAD rejected"] {
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.authenticate();
            let tag = wire.expect_command("LIST \"\" \"*\"");
            wire.bytes(format!("{tag} {status}\r\n").as_bytes());
            let next = wire.expect_command("LIST \"\" \"*\"");
            wire.ok(&next);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, &server);
        let error = runtime
            .list_mailboxes(&session)
            .expect_err("NO/BAD remain normal rejection");
        assert_error(
            &error,
            NativeMailErrorKind::Rejected,
            "imap_command_rejected",
            NativeMailSessionDisposition::Keep,
        );
        assert_eq!(runtime.list_mailboxes(&session), Ok(Vec::new()));
        server.join();
    }
}

#[test]
fn rv18_malformed_greetings_never_register_a_session() {
    for greeting in ["HELLO", "garbage", "* PREAUTH unsupported"] {
        let server = launch(move |stream| {
            let mut wire = WireActor::attach(stream);
            wire.bytes(format!("{greeting}\r\n").as_bytes());
        });
        let runtime = ManagedNativeMailRuntime::default();
        let error = runtime
            .open(NativeMailOpenRequest {
                host: "127.0.0.1".to_owned(),
                username: USER.to_owned(),
                password: SECRET.to_owned(),
                imap_port: server.port,
                smtp_port: unused_port(),
            })
            .expect_err("malformed greeting must not open session");
        assert_error(
            &error,
            NativeMailErrorKind::Protocol,
            "imap_greeting_rejected",
            NativeMailSessionDisposition::Expire,
        );
        server.join();
    }
}

#[test]
fn rv19_select_without_uidvalidity_suppresses_uid_operations() {
    let (observed_tx, observed_rx) = mpsc::channel();
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(false);
        let mut unexpected = String::new();
        let observed = match wire.input.read_line(&mut unexpected) {
            Ok(0) => 0,
            Ok(_) => usize::from(unexpected.contains(" UID ") || unexpected.contains("UID ")),
            Err(_) => 0,
        };
        observed_tx.send(observed).expect("report UID operations");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .fetch_body(&message_request(&session))
        .expect_err("UIDVALIDITY is mandatory before UID operation");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_uidvalidity_missing",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    assert_eq!(observed_rx.recv_timeout(Duration::from_secs(2)), Ok(0));
    server.join();
}

#[test]
fn rv20_rv21_truncated_literal_and_invalid_trailer_never_return_partial_body() {
    let server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        let _tag =
            wire.expect_command("UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])");
        wire.bytes(b"* 1 FETCH (UID 42 BODY[] {100}\r\nshort");
        wire.output
            .shutdown(Shutdown::Both)
            .expect("close truncated stream");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .fetch_body(&message_request(&session))
        .expect_err("truncated literal must not become body");
    assert_eq!(error.kind, NativeMailErrorKind::Unavailable);
    assert_eq!(error.code, Some("imap_literal_failed"));
    assert_eq!(error.session, NativeMailSessionDisposition::Expire);
    assert_session_absent(&runtime, &session);
    server.join();

    let server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        let _tag =
            wire.expect_command("UID FETCH 42 (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])");
        wire.bytes(b"* 1 FETCH (UID 42 BODY[] {3}\r\nabcNOT-A-CLOSING-PAREN\r\n");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .fetch_body(&message_request(&session))
        .expect_err("wrong literal trailer must not become body");
    assert_error(
        &error,
        NativeMailErrorKind::Protocol,
        "imap_literal_trailer_invalid",
        NativeMailSessionDisposition::Expire,
    );
    assert_session_absent(&runtime, &session);
    server.join();
}

#[test]
fn rv22_rv23_snapshot_stability_still_rejects_flag_and_uid_set_changes() {
    let raw = message("flag changed", b"body");
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        wire.status(&[42], 1);
        wire.search(&[42]);
        wire.full_fetch(42, 8, "UID 42", &raw);
        wire.status(&[42], 1);
        wire.search(&[42]);
        wire.flag_fetch(42, "\\Flagged");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("per-message flag transition invalidates snapshot");
    assert_error(
        &error,
        NativeMailErrorKind::Conflict,
        "imap_snapshot_changed",
        NativeMailSessionDisposition::Keep,
    );
    server.join();

    let raws = [
        message("one", b"1"),
        message("two", b"2"),
        message("three", b"3"),
    ];
    let server = launch(move |stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        wire.status(&[1, 2, 3], 3);
        wire.search(&[1, 2, 3]);
        for (uid, raw) in [1_u32, 2, 3].into_iter().zip(raws) {
            wire.full_fetch(uid, uid + 10, &format!("UID {uid}"), &raw);
        }
        wire.status(&[1, 2, 4], 3);
        wire.search(&[1, 2, 4]);
        for uid in [1, 2, 4] {
            wire.flag_fetch(uid, "");
        }
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("same-count changed UID set invalidates snapshot");
    assert_error(
        &error,
        NativeMailErrorKind::Conflict,
        "imap_snapshot_changed",
        NativeMailSessionDisposition::Keep,
    );
    server.join();
}

#[test]
fn rv25_store_disconnect_after_command_remains_unknown_and_reconcile() {
    let server = launch(|stream| {
        let mut wire = WireActor::attach(stream);
        wire.authenticate();
        wire.select(true);
        let command = wire.client_command().1;
        assert_eq!(command, "UID STORE 42 +FLAGS.SILENT (\\Flagged)");
        wire.output
            .shutdown(Shutdown::Both)
            .expect("drop after mutation command");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, &server);
    let error = runtime
        .store_flags(&NativeStoreFlagsRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: UID_VALIDITY,
            uid: 42,
            add: vec![NativeFlag::Flagged],
            remove: Vec::new(),
        })
        .expect_err("post-command disconnect is ambiguous");
    assert_eq!(error.retry, NativeMailRetry::Reconcile);
    assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    server.join();
}
