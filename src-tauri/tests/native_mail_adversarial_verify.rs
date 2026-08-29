use std::{
    io::{BufRead, BufReader, Write},
    net::{Shutdown, TcpListener, TcpStream},
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    thread::{self, JoinHandle},
    time::{Duration, Instant},
};

use correo_boxplot_lib::net::{
    ManagedNativeMailRuntime,
    dto::{
        NativeAddressDto, NativeBodyDto, NativeFlag, NativeMailOpenRequest, NativeMessageRequest,
        NativeMoveRequest, NativeSmtpSubmitRequest, NativeStoreFlagsRequest,
        NativeSubmissionBodyDto,
    },
    errors::{
        NativeMailErrorKind, NativeMailOutcome, NativeMailRetry, NativeMailSessionDisposition,
    },
};

const USER: &str = "alice@boxplot.test";
const PASSWORD: &str = "BOXPL0T_NATIVE_VERIFY_SECRET_CANARY_92713";

struct TestServer {
    port: u16,
    handle: JoinHandle<()>,
}

impl TestServer {
    fn finish(self) {
        self.handle.join().expect("test server did not panic");
    }
}

struct ImapPeer {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
    fragmented: bool,
}

impl ImapPeer {
    fn new(stream: TcpStream, fragmented: bool) -> Self {
        stream
            .set_read_timeout(Some(Duration::from_secs(2)))
            .expect("read timeout");
        stream
            .set_write_timeout(Some(Duration::from_secs(2)))
            .expect("write timeout");
        let reader = BufReader::new(stream.try_clone().expect("clone stream"));
        Self {
            writer: stream,
            reader,
            fragmented,
        }
    }

    fn write(&mut self, bytes: &[u8]) {
        if self.fragmented {
            for byte in bytes {
                self.writer.write_all(&[*byte]).expect("fragment write");
                self.writer.flush().expect("fragment flush");
            }
        } else {
            self.writer.write_all(bytes).expect("server write");
            self.writer.flush().expect("server flush");
        }
    }

    fn command(&mut self) -> (String, String) {
        let mut line = String::new();
        let read = self.reader.read_line(&mut line).expect("command read");
        assert!(read > 0, "client closed before expected command");
        let line = line.trim_end_matches(['\r', '\n']);
        let (tag, command) = line.split_once(' ').expect("tagged command");
        (tag.to_owned(), command.to_owned())
    }

    fn tagged(&mut self, tag: &str, untagged: &[String]) {
        let mut response = Vec::new();
        for line in untagged {
            response.extend_from_slice(line.as_bytes());
            response.extend_from_slice(b"\r\n");
        }
        response.extend_from_slice(format!("{tag} OK completed\r\n").as_bytes());
        self.write(&response);
    }

    fn expect(&mut self, prefix: &str, untagged: &[String]) {
        let (tag, command) = self.command();
        assert!(
            command.starts_with(prefix),
            "expected {prefix:?}, got {command:?}"
        );
        self.tagged(&tag, untagged);
    }

    fn authenticate(&mut self) {
        self.write(b"* OK test IMAP ready\r\n");
        let (tag, command) = self.command();
        assert!(command.starts_with("LOGIN "));
        assert!(command.contains(USER));
        assert!(command.contains(PASSWORD));
        self.tagged(&tag, &[]);
    }

    fn select(&mut self, uid_validity: u32) {
        self.expect(
            "SELECT ",
            &[format!("* OK [UIDVALIDITY {uid_validity}] selected")],
        );
    }

    fn status(&mut self, messages: u64, unseen: u64, uid_next: u32, uid_validity: u32) {
        self.expect(
            "STATUS ",
            &[format!(
                "* STATUS \"INBOX\" (MESSAGES {messages} UNSEEN {unseen} UIDNEXT {uid_next} UIDVALIDITY {uid_validity})"
            )],
        );
    }

    fn search(&mut self, uids: &[u32]) {
        let suffix = uids
            .iter()
            .map(u32::to_string)
            .collect::<Vec<_>>()
            .join(" ");
        self.expect(
            "UID SEARCH ALL",
            &[if suffix.is_empty() {
                "* SEARCH".to_owned()
            } else {
                format!("* SEARCH {suffix}")
            }],
        );
    }

    fn full_fetch(&mut self, uid: u32, flags: &[&str], raw: &[u8]) {
        self.full_fetch_with_uid_attribute(uid, &format!("UID {uid}"), flags, raw);
    }

    fn full_fetch_with_uid_attribute(
        &mut self,
        requested_uid: u32,
        uid_attribute: &str,
        flags: &[&str],
        raw: &[u8],
    ) {
        let (tag, command) = self.command();
        assert_eq!(
            command,
            format!("UID FETCH {requested_uid} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])")
        );
        let header = format!(
            "* 1 FETCH ({uid_attribute} FLAGS ({}) INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE {} BODY[] {{{}}}\r\n",
            flags.join(" "),
            raw.len(),
            raw.len()
        );
        self.write(header.as_bytes());
        self.write(raw);
        self.write(b")\r\n");
        self.tagged(&tag, &[]);
    }

    fn flag_fetch(&mut self, requested_uid: u32, returned_uid: u32, flags: &[&str]) {
        self.expect(
            &format!("UID FETCH {requested_uid} (UID FLAGS)"),
            &[format!(
                "* {returned_uid} FETCH (UID {returned_uid} FLAGS ({}))",
                flags.join(" ")
            )],
        );
    }
}

#[test]
fn parser_repair_wrong_full_fetch_uid_never_returns_snapshot_body_or_attachments() {
    let snapshot_raw = raw_message("Wrong full UID", "body-for-99");
    let snapshot_server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        peer.status(1, 1, 43, 7);
        peer.search(&[42]);
        peer.full_fetch_with_uid_attribute(42, "UID 99", &[], snapshot_raw.as_slice());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, snapshot_server.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("wrong full-FETCH UID must not produce a snapshot");
    assert_eq!(error.kind, NativeMailErrorKind::Conflict);
    assert_eq!(error.code, Some("imap_snapshot_changed"));
    snapshot_server.finish();

    for attachments in [false, true] {
        let raw = if attachments {
            concat!(
                "From: alice@boxplot.test\r\nTo: bob@boxplot.test\r\n",
                "Subject: wrong UID attachment\r\n",
                "Content-Type: multipart/mixed; boundary=x\r\n\r\n",
                "--x\r\nContent-Type: text/plain\r\n\r\nbody-for-99\r\n",
                "--x\r\nContent-Type: text/plain; name=secret.txt\r\n",
                "Content-Disposition: attachment; filename=secret.txt\r\n\r\nsecret\r\n",
                "--x--\r\n"
            )
            .as_bytes()
            .to_vec()
        } else {
            raw_message("Wrong direct UID", "body-for-99")
        };
        let server = spawn_server(move |stream| {
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            peer.select(7);
            peer.full_fetch_with_uid_attribute(42, "UID 99", &[], raw.as_slice());
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, server.port, unused_port());
        let target = NativeMessageRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
        };
        let error = if attachments {
            runtime
                .fetch_attachments(&target)
                .expect_err("wrong UID must not supply attachment metadata")
        } else {
            runtime
                .fetch_body(&target)
                .expect_err("wrong UID must not supply body")
        };
        assert_eq!(error.kind, NativeMailErrorKind::StateInvalid);
        assert_eq!(error.code, Some("imap_uid_mismatch"));
        assert_eq!(error.session, NativeMailSessionDisposition::Keep);
        server.finish();
    }
}

#[test]
fn parser_repair_missing_and_invalid_full_fetch_uid_expire_session() {
    for uid_attribute in ["", "UID abc", "UID 4294967296"] {
        let raw = raw_message("Invalid UID", "must-not-return");
        let server = spawn_server(move |stream| {
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            peer.select(7);
            peer.full_fetch_with_uid_attribute(42, uid_attribute, &[], raw.as_slice());
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, server.port, unused_port());
        let error = runtime
            .fetch_body(&NativeMessageRequest {
                session_id: session.clone(),
                mailbox: "INBOX".to_owned(),
                uid_validity: 7,
                uid: 42,
            })
            .expect_err("missing/malformed returned UID must fail");
        assert_eq!(error.kind, NativeMailErrorKind::Protocol);
        assert_eq!(
            error.code,
            Some(if uid_attribute.is_empty() {
                "imap_uid_missing"
            } else {
                "imap_uid_invalid"
            })
        );
        assert_eq!(error.session, NativeMailSessionDisposition::Expire);
        assert_eq!(
            runtime
                .list_mailboxes(&session)
                .expect_err("protocol error expires session")
                .kind,
            NativeMailErrorKind::StateInvalid
        );
        server.finish();
    }
}

#[test]
fn parser_repair_huge_and_malformed_literal_lengths_fail_before_body_read() {
    for (literal, code) in [
        ("2097153", "imap_literal_too_large"),
        ("184467440737095516160", "imap_literal_length_invalid"),
        ("", "imap_literal_length_invalid"),
        ("abc", "imap_literal_length_invalid"),
        ("-1", "imap_literal_length_invalid"),
    ] {
        let server = spawn_server(move |stream| {
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            peer.select(7);
            let (_tag, command) = peer.command();
            assert!(command.starts_with("UID FETCH 42 "));
            peer.write(format!("* 1 FETCH (UID 42 FLAGS () BODY[] {{{literal}}}\r\n").as_bytes());
            let _ = peer.writer.shutdown(Shutdown::Write);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, server.port, unused_port());
        let error = runtime
            .fetch_body(&NativeMessageRequest {
                session_id: session.clone(),
                mailbox: "INBOX".to_owned(),
                uid_validity: 7,
                uid: 42,
            })
            .expect_err("invalid literal length must fail before reading body");
        assert_eq!(error.kind, NativeMailErrorKind::Protocol);
        assert_eq!(error.code, Some(code));
        assert_eq!(error.session, NativeMailSessionDisposition::Expire);
        server.finish();
    }
}

#[test]
fn parser_repair_oversized_no_newline_line_fails_without_waiting_for_newline() {
    let server = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        let (_tag, command) = peer.command();
        assert!(command.starts_with("LIST "));
        peer.write(&vec![b'x'; 64 * 1024 + 1]);
        let _ = read_line(&mut peer.reader);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let started = Instant::now();
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("oversized unterminated line must fail at the bound");
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_line_too_large"));
    assert_eq!(error.session, NativeMailSessionDisposition::Expire);
    server.finish();
}

#[test]
fn parser_repair_duplicate_and_cumulative_literals_fail_closed() {
    let raw = raw_message("Duplicate", "first");
    let duplicate = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        let (tag, command) = peer.command();
        assert!(command.starts_with("UID FETCH 42 "));
        for sequence in [1, 2] {
            peer.write(
                format!(
                    "* {sequence} FETCH (UID 42 FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE {} BODY[] {{{}}}\r\n",
                    raw.len(),
                    raw.len()
                )
                .as_bytes(),
            );
            peer.write(raw.as_slice());
            peer.write(b")\r\n");
        }
        peer.tagged(&tag, &[]);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, duplicate.port, unused_port());
    let error = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
        })
        .expect_err("two literal-bearing FETCH responses are invalid");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_fetch_duplicate"));
    duplicate.finish();

    let cumulative = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        let (_tag, command) = peer.command();
        assert!(command.starts_with("UID FETCH 42 "));
        peer.write(
            b"* 1 FETCH (UID 42 FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE 2097152 BODY[] {2097152}\r\n",
        );
        peer.write(&vec![b'x'; 2 * 1024 * 1024]);
        peer.write(b")\r\n");
        peer.write(b"* 2 FETCH (UID 42 BODY[] {1}\r\n");
        let _ = peer.writer.shutdown(Shutdown::Write);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, cumulative.port, unused_port());
    let error = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
        })
        .expect_err("cumulative literals above the command budget are invalid");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_literal_too_large"));
    assert_eq!(error.session, NativeMailSessionDisposition::Expire);
    cumulative.finish();
}

#[test]
fn parser_repair_response_line_and_text_budgets_fail_finitely() {
    let too_many = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        let (_tag, command) = peer.command();
        assert!(command.starts_with("LIST "));
        for _ in 0..4097 {
            if peer.writer.write_all(b"* OK filler\r\n").is_err() {
                break;
            }
        }
        let _ = peer.writer.flush();
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, too_many.port, unused_port());
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("response line count is bounded");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_response_too_large"));
    too_many.finish();

    let cumulative_text = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        let (_tag, command) = peer.command();
        assert!(command.starts_with("LIST "));
        let mut line = Vec::with_capacity(65_532);
        line.extend_from_slice(b"* OK ");
        line.extend(std::iter::repeat_n(b'x', 65_525));
        line.extend_from_slice(b"\r\n");
        for _ in 0..17 {
            if peer.writer.write_all(&line).is_err() {
                break;
            }
            let _ = peer.writer.flush();
        }
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, cumulative_text.port, unused_port());
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("cumulative response text is bounded");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_response_too_large"));
    cumulative_text.finish();
}

#[test]
fn parser_repair_malformed_tag_greeting_and_select_are_typed_failures() {
    let malformed_tag = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        let (tag, command) = peer.command();
        assert!(command.starts_with("LIST "));
        peer.write(format!("{tag} WHAT nonsense\r\n").as_bytes());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, malformed_tag.port, unused_port());
    let error = runtime
        .list_mailboxes(&session)
        .expect_err("unknown tagged status is malformed protocol");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_tagged_response_invalid"));
    malformed_tag.finish();

    for greeting in ["HELLO\r\n", "* PREAUTH unsupported\r\n", "garbage\r\n"] {
        let server = spawn_server(move |mut stream| {
            stream
                .write_all(greeting.as_bytes())
                .expect("malformed greeting");
            stream.flush().expect("greeting flush");
        });
        let runtime = ManagedNativeMailRuntime::default();
        let error = runtime
            .open(request("127.0.0.1", server.port, unused_port(), PASSWORD))
            .expect_err("non-OK greeting must not register a session");
        assert_eq!(error.kind, NativeMailErrorKind::Protocol);
        assert_eq!(error.code, Some("imap_greeting_rejected"));
        server.finish();
    }

    let missing_uidvalidity = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        let (tag, command) = peer.command();
        assert!(command.starts_with("SELECT "));
        peer.tagged(&tag, &[]);
        assert!(
            read_line(&mut peer.reader).is_err(),
            "no UID command follows a SELECT without UIDVALIDITY"
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, missing_uidvalidity.port, unused_port());
    let error = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
        })
        .expect_err("SELECT without UIDVALIDITY fails before UID FETCH");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    assert_eq!(error.code, Some("imap_uidvalidity_missing"));
    missing_uidvalidity.finish();
}

fn spawn_server(handler: impl FnOnce(TcpStream) + Send + 'static) -> TestServer {
    spawn_server_on("127.0.0.1:0", handler)
}

fn spawn_server_on(address: &str, handler: impl FnOnce(TcpStream) + Send + 'static) -> TestServer {
    let listener = TcpListener::bind(address).expect("bind loopback server");
    let port = listener.local_addr().expect("listener address").port();
    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().expect("accept client");
        handler(stream);
    });
    TestServer { port, handle }
}

fn unused_port() -> u16 {
    TcpListener::bind("127.0.0.1:0")
        .expect("reserve unused port")
        .local_addr()
        .expect("unused address")
        .port()
}

fn request(host: &str, imap_port: u16, smtp_port: u16, password: &str) -> NativeMailOpenRequest {
    request_for(host, imap_port, smtp_port, USER, password)
}

fn request_for(
    host: &str,
    imap_port: u16,
    smtp_port: u16,
    username: &str,
    password: &str,
) -> NativeMailOpenRequest {
    NativeMailOpenRequest {
        host: host.to_owned(),
        username: username.to_owned(),
        password: password.to_owned(),
        imap_port,
        smtp_port,
    }
}

fn open(runtime: &ManagedNativeMailRuntime, imap_port: u16, smtp_port: u16) -> String {
    runtime
        .open(request("127.0.0.1", imap_port, smtp_port, PASSWORD))
        .expect("test session opens")
        .session_id
}

fn raw_message(subject: &str, body: &str) -> Vec<u8> {
    format!(
        "From: Alice <alice@boxplot.test>\r\nTo: Bob <bob@boxplot.test>\r\nSubject: {subject}\r\nDate: Fri, 28 Aug 2026 12:00:00 +0000\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n{body}"
    )
    .into_bytes()
}

fn serve_snapshot(
    peer: &mut ImapPeer,
    initial: &[(u32, &[&str], &[u8])],
    final_uids: &[u32],
    final_flags: &[(u32, u32, &[&str])],
    unseen: u64,
) {
    let uid_next = initial
        .iter()
        .map(|(uid, _, _)| *uid)
        .chain(final_uids.iter().copied())
        .max()
        .unwrap_or(0)
        .saturating_add(1);
    peer.select(7);
    peer.status(initial.len() as u64, unseen, uid_next, 7);
    peer.search(&initial.iter().map(|(uid, _, _)| *uid).collect::<Vec<_>>());
    for (uid, flags, raw) in initial {
        peer.full_fetch(*uid, flags, raw);
    }
    peer.status(final_uids.len() as u64, unseen, uid_next, 7);
    peer.search(final_uids);
    for (requested, returned, flags) in final_flags {
        peer.flag_fetch(*requested, *returned, flags);
    }
}

#[test]
fn actual_protocol_flagged_transition_is_rejected_without_partial_snapshot() {
    let raw = raw_message("Flag transition", "hello");
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[(42, &[], raw.as_slice())],
            &[42],
            &[(42, 42, &["\\Flagged"])],
            1,
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("Flagged transition must invalidate replacement");
    assert_eq!(error.kind, NativeMailErrorKind::Conflict);
    assert_eq!(error.code, Some("imap_snapshot_changed"));
    server.finish();
}

#[test]
fn actual_protocol_seen_swap_with_equal_unseen_is_rejected() {
    let first = raw_message("First", "one");
    let second = raw_message("Second", "two");
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[
                (1, &[], first.as_slice()),
                (2, &["\\Seen"], second.as_slice()),
            ],
            &[1, 2],
            &[(1, 1, &["\\Seen"]), (2, 2, &[])],
            1,
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("per-message Seen swap must not hide behind aggregate UNSEEN");
    assert_eq!(error.kind, NativeMailErrorKind::Conflict);
    server.finish();
}

#[test]
fn actual_protocol_reverse_flag_and_seen_transitions_are_rejected() {
    for (label, initial_flags, final_flags) in [
        ("Flagged removal", vec!["\\Flagged"], vec![]),
        ("Seen addition", vec![], vec!["\\Seen"]),
        ("Seen removal", vec!["\\Seen"], vec![]),
    ] {
        let raw = raw_message(label, "transition");
        let server = spawn_server(move |stream| {
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            serve_snapshot(
                &mut peer,
                &[(42, initial_flags.as_slice(), raw.as_slice())],
                &[42],
                &[(42, 42, final_flags.as_slice())],
                1,
            );
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, server.port, unused_port());
        let error = runtime
            .snapshot_mailbox(&session, "INBOX")
            .expect_err("any per-message flag transition must invalidate replacement");
        assert_eq!(error.kind, NativeMailErrorKind::Conflict);
        server.finish();
    }
}

#[test]
fn actual_protocol_uid_replacement_with_same_count_is_rejected() {
    let raw = raw_message("UID transition", "hello");
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[(1, &[], raw.as_slice())],
            &[2],
            &[(2, 2, &[])],
            1,
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("same-count UID replacement must conflict");
    assert_eq!(error.kind, NativeMailErrorKind::Conflict);
    server.finish();
}

#[test]
fn actual_protocol_uidvalidity_and_uidnext_transitions_fail_closed() {
    for (final_uid_next, final_uid_validity) in [(2, 8), (3, 7)] {
        let raw = raw_message("Status transition", "hello");
        let server = spawn_server(move |stream| {
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            peer.select(7);
            peer.status(1, 1, 2, 7);
            peer.search(&[1]);
            peer.full_fetch(1, &[], raw.as_slice());
            peer.status(1, 1, final_uid_next, final_uid_validity);
            peer.search(&[1]);
            peer.flag_fetch(1, 1, &[]);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, server.port, unused_port());
        let error = runtime
            .snapshot_mailbox(&session, "INBOX")
            .expect_err("mailbox status transition invalidates replacement");
        assert!(matches!(
            error.kind,
            NativeMailErrorKind::Conflict | NativeMailErrorKind::StateInvalid
        ));
        server.finish();
    }
}

#[test]
fn fragmented_stable_snapshot_and_flag_order_are_accepted() {
    let raw = raw_message("Fragmented", "split response body");
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, true);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[(7, &["\\Seen", "\\Flagged"], raw.as_slice())],
            &[7],
            &[(7, 7, &["\\Flagged", "\\Seen", "\\Seen"])],
            0,
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let snapshot = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect("fragmented stable snapshot accepted");
    assert_eq!(snapshot.messages.len(), 1);
    assert_eq!(snapshot.messages[0].subject.as_deref(), Some("Fragmented"));
    server.finish();
}

#[test]
fn test_owned_nested_mime_is_normalized_through_actual_imap_flow() {
    let raw = concat!(
        "From: =?UTF-8?B?QWzDrWNl?= <alice@boxplot.test>\r\n",
        "To: Bob <bob@boxplot.test>\r\n",
        "Cc: Carol <carol@boxplot.test>\r\n",
        "Reply-To: reply@boxplot.test\r\n",
        "Subject: =?UTF-8?B?SG9sYSDwn5GL?=\r\n",
        "Date: Fri, 28 Aug 2026 12:00:00 +0000\r\n",
        "Content-Type: multipart/mixed; boundary=outer\r\n\r\n",
        "--outer\r\nContent-Type: multipart/alternative; boundary=inner\r\n\r\n",
        "--inner\r\nContent-Type: text/plain; charset=utf-8\r\n\r\n  hello   world  \r\n",
        "--inner\r\nContent-Type: text/html; charset=utf-8\r\n\r\n<p>hello</p>\r\n",
        "--inner--\r\n",
        "--outer\r\nContent-Type: image/png; name=logo.png\r\n",
        "Content-Disposition: attachment; filename=logo.png\r\n",
        "Content-ID: logo@example\r\nContent-Transfer-Encoding: base64\r\n\r\naGVsbG8=\r\n",
        "--outer--\r\n"
    )
    .as_bytes()
    .to_vec();
    let served = raw.clone();
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[(5, &[], served.as_slice())],
            &[5],
            &[(5, 5, &[])],
            1,
        );
        for _ in 0..3 {
            peer.select(7);
            peer.full_fetch(5, &[], served.as_slice());
        }
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let snapshot = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect("test-owned MIME snapshot");
    let metadata = &snapshot.messages[0];
    assert_eq!(metadata.subject.as_deref(), Some("Hola 👋"));
    assert_eq!(
        metadata.from.as_ref().unwrap()[0].name.as_deref(),
        Some("Alíce")
    );
    assert_eq!(
        metadata.reply_to.as_ref().unwrap()[0].email,
        "reply@boxplot.test"
    );
    assert_eq!(metadata.cc.as_ref().unwrap()[0].email, "carol@boxplot.test");
    assert_eq!(metadata.preview, "hello world");
    assert!(metadata.has_attachment);
    let target = NativeMessageRequest {
        session_id: session,
        mailbox: "INBOX".to_owned(),
        uid_validity: 7,
        uid: 5,
    };
    assert_eq!(
        runtime.fetch_body(&target).expect("normalized body"),
        NativeBodyDto::Plain {
            text: Some("  hello   world  ".to_owned()),
            html: Some("<p>hello</p>".to_owned()),
        }
    );
    let attachments = runtime
        .fetch_attachments(&target)
        .expect("normalized attachment metadata");
    assert_eq!(attachments.len(), 1);
    assert_eq!(attachments[0].name.as_deref(), Some("logo.png"));
    assert_eq!(attachments[0].media_type, "image/png");
    assert_eq!(attachments[0].disposition.as_deref(), Some("attachment"));
    assert_eq!(attachments[0].cid.as_deref(), Some("logo@example"));
    assert!(attachments[0].size > 0);
    assert_eq!(
        runtime
            .fetch_attachments(&target)
            .expect("repeated attachment metadata"),
        attachments
    );
    server.finish();
}

#[test]
fn boxplot_e2ee_mime_remains_opaque_through_actual_imap_flow() {
    let raw = concat!(
        "From: alice@boxplot.test\r\nTo: bob@boxplot.test\r\n",
        "Subject: encrypted\r\n",
        "Content-Type: application/vnd.boxplot.e2ee+json\r\n\r\n",
        "{\"version\":1,\"ciphertext\":\"opaque\"}"
    )
    .as_bytes()
    .to_vec();
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        peer.full_fetch(3, &[], raw.as_slice());
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let body = runtime
        .fetch_body(&NativeMessageRequest {
            session_id: session,
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 3,
        })
        .expect("E2EE body remains transport payload");
    assert!(matches!(body, NativeBodyDto::BoxplotE2ee { payload } if payload.contains("opaque")));
    server.finish();
}

#[test]
fn wrong_final_uid_is_typed_conflict_and_never_returns_snapshot() {
    let raw = raw_message("Wrong UID", "hello");
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        serve_snapshot(
            &mut peer,
            &[(9, &[], raw.as_slice())],
            &[9],
            &[(9, 10, &[])],
            1,
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("wrong final UID fails closed");
    assert_eq!(error.kind, NativeMailErrorKind::Conflict);
    server.finish();
}

#[test]
fn malformed_status_and_truncated_literal_fail_finitely_without_panicking() {
    let malformed = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        peer.expect(
            "STATUS ",
            &["* STATUS \"INBOX\" (MESSAGES nope UNSEEN 1 UIDNEXT 2 UIDVALIDITY 7)".to_owned()],
        );
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, malformed.port, unused_port());
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("malformed STATUS is typed");
    assert_eq!(error.kind, NativeMailErrorKind::Protocol);
    malformed.finish();

    let truncated = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        peer.status(1, 1, 2, 7);
        peer.search(&[1]);
        let (tag, command) = peer.command();
        assert!(command.contains("BODY.PEEK[]"));
        peer.write(b"* 1 FETCH (UID 1 FLAGS () INTERNALDATE \"28-Aug-2026 12:01:02 +0000\" RFC822.SIZE 100 BODY[] {100}\r\nshort");
        let _ = tag;
        peer.writer
            .shutdown(Shutdown::Both)
            .expect("close truncated stream");
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, truncated.port, unused_port());
    let started = Instant::now();
    let error = runtime
        .snapshot_mailbox(&session, "INBOX")
        .expect_err("truncated literal must fail");
    assert!(started.elapsed() < Duration::from_secs(3));
    assert_eq!(error.kind, NativeMailErrorKind::Unavailable);
    truncated.finish();
}

#[test]
fn stale_uidvalidity_suppresses_fetch_attachment_store_and_move_commands() {
    let unexpected_uid_commands = Arc::new(AtomicUsize::new(0));
    let observed = Arc::clone(&unexpected_uid_commands);
    let server = spawn_server(move |stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        for _ in 0..5 {
            let (tag, command) = peer.command();
            if !command.starts_with("SELECT ") {
                observed.fetch_add(1, Ordering::SeqCst);
            }
            peer.tagged(&tag, &["* OK [UIDVALIDITY 99] selected".to_owned()]);
        }
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, server.port, unused_port());
    let target = NativeMessageRequest {
        session_id: session.clone(),
        mailbox: "INBOX".to_owned(),
        uid_validity: 7,
        uid: 42,
    };
    assert_eq!(
        runtime.fetch_body(&target).expect_err("stale body").kind,
        NativeMailErrorKind::StateInvalid
    );
    assert_eq!(
        runtime
            .fetch_attachments(&target)
            .expect_err("stale attachments")
            .kind,
        NativeMailErrorKind::StateInvalid
    );
    for request in [
        NativeStoreFlagsRequest {
            session_id: session.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
            add: vec![NativeFlag::Seen],
            remove: vec![],
        },
        NativeStoreFlagsRequest {
            session_id: session.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
            add: vec![],
            remove: vec![NativeFlag::Flagged],
        },
    ] {
        assert_eq!(
            runtime.store_flags(&request).expect_err("stale STORE").kind,
            NativeMailErrorKind::StateInvalid
        );
    }
    assert_eq!(
        runtime
            .move_message(&NativeMoveRequest {
                session_id: session,
                mailbox: "INBOX".to_owned(),
                uid_validity: 7,
                uid: 42,
                destination_mailbox: "Trash".to_owned(),
            })
            .expect_err("stale MOVE")
            .kind,
        NativeMailErrorKind::StateInvalid
    );
    server.finish();
    assert_eq!(unexpected_uid_commands.load(Ordering::SeqCst), 0);
}

#[test]
fn imap_store_and_move_disconnects_after_command_are_ambiguous() {
    let store_server = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        let (_tag, command) = peer.command();
        assert_eq!(command, "UID STORE 42 +FLAGS.SILENT (\\Seen)");
        let _ = peer.writer.shutdown(Shutdown::Both);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, store_server.port, unused_port());
    let error = runtime
        .store_flags(&NativeStoreFlagsRequest {
            session_id: session.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
            add: vec![NativeFlag::Seen],
            remove: vec![],
        })
        .expect_err("STORE disconnect after command is ambiguous");
    assert_eq!(error.retry, NativeMailRetry::Reconcile);
    assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    let _ = runtime.close(&session);
    store_server.finish();

    let move_server = spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        peer.select(7);
        let (_tag, command) = peer.command();
        assert_eq!(command, "UID MOVE 42 \"Trash\"");
        let _ = peer.writer.shutdown(Shutdown::Both);
    });
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, move_server.port, unused_port());
    let error = runtime
        .move_message(&NativeMoveRequest {
            session_id: session.clone(),
            mailbox: "INBOX".to_owned(),
            uid_validity: 7,
            uid: 42,
            destination_mailbox: "Trash".to_owned(),
        })
        .expect_err("MOVE disconnect after command is ambiguous");
    assert_eq!(error.retry, NativeMailRetry::Reconcile);
    assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    let _ = runtime.close(&session);
    move_server.finish();
}

fn spawn_idle_imap() -> TestServer {
    spawn_server(|stream| {
        let mut peer = ImapPeer::new(stream, false);
        peer.authenticate();
        while let Ok(line) = read_line(&mut peer.reader) {
            let Some((tag, command)) = line.trim_end().split_once(' ') else {
                break;
            };
            if command == "LOGOUT" {
                peer.tagged(tag, &["* BYE logout".to_owned()]);
                break;
            }
        }
    })
}

fn read_line(reader: &mut BufReader<TcpStream>) -> std::io::Result<String> {
    let mut line = String::new();
    let count = reader.read_line(&mut line)?;
    if count == 0 {
        return Err(std::io::ErrorKind::UnexpectedEof.into());
    }
    Ok(line)
}

#[derive(Clone, Copy)]
enum SmtpMode {
    Accept,
    RejectAuth,
    DropAfterBody,
    DropDuringBody,
    RejectMail,
    RejectRecipient,
    RejectData,
}

fn spawn_smtp(mode: SmtpMode, transcript: Arc<Mutex<Vec<u8>>>) -> TestServer {
    spawn_server(move |stream| {
        let mut writer = stream.try_clone().expect("SMTP clone");
        let mut reader = BufReader::new(stream);
        writer.write_all(b"220 test SMTP\r\n").expect("greeting");
        let ehlo = read_line(&mut reader).expect("EHLO");
        assert!(ehlo.starts_with("EHLO "));
        writer
            .write_all(b"250-test\r\n250 AUTH PLAIN\r\n")
            .expect("EHLO response");
        let auth = read_line(&mut reader).expect("AUTH");
        assert!(auth.starts_with("AUTH PLAIN "));
        assert!(!auth.contains(PASSWORD));
        if matches!(mode, SmtpMode::RejectAuth) {
            writer
                .write_all(b"535 auth rejected\r\n")
                .expect("auth rejected");
            return;
        }
        writer.write_all(b"235 authenticated\r\n").expect("auth ok");
        let mail = read_line(&mut reader).expect("MAIL FROM");
        assert!(mail.starts_with("MAIL FROM:<alice@boxplot.test>"));
        if matches!(mode, SmtpMode::RejectMail) {
            writer
                .write_all(b"550 rejected\r\n")
                .expect("MAIL rejected");
            return;
        }
        writer.write_all(b"250 sender ok\r\n").expect("MAIL ok");
        loop {
            let command = read_line(&mut reader).expect("SMTP command");
            if command.starts_with("RCPT TO:") {
                transcript
                    .lock()
                    .expect("transcript")
                    .extend_from_slice(command.as_bytes());
                if matches!(mode, SmtpMode::RejectRecipient) {
                    writer
                        .write_all(b"550 recipient rejected\r\n")
                        .expect("RCPT rejected");
                    return;
                }
                writer.write_all(b"250 recipient ok\r\n").expect("RCPT ok");
            } else {
                assert_eq!(command, "DATA\r\n");
                if matches!(mode, SmtpMode::RejectData) {
                    writer
                        .write_all(b"550 DATA rejected\r\n")
                        .expect("DATA rejected");
                    return;
                }
                writer.write_all(b"354 send body\r\n").expect("DATA ready");
                if matches!(mode, SmtpMode::DropDuringBody) {
                    let _ = writer.shutdown(Shutdown::Both);
                    return;
                }
                break;
            }
        }
        let mut data = Vec::new();
        loop {
            let line = read_line(&mut reader).expect("message line");
            if line == ".\r\n" {
                break;
            }
            data.extend_from_slice(line.as_bytes());
        }
        transcript
            .lock()
            .expect("transcript")
            .extend_from_slice(&data);
        if matches!(mode, SmtpMode::DropAfterBody) {
            let _ = writer.shutdown(Shutdown::Both);
            return;
        }
        writer.write_all(b"250 accepted\r\n").expect("final 250");
        if let Ok(quit) = read_line(&mut reader) {
            assert_eq!(quit, "QUIT\r\n");
            writer.write_all(b"221 bye\r\n").expect("QUIT response");
        }
    })
}

fn submission(session_id: &str, body: String) -> NativeSmtpSubmitRequest {
    submission_with_id(session_id, body, "verify-mutation")
}

fn submission_with_id(
    session_id: &str,
    body: String,
    idempotency_key: &str,
) -> NativeSmtpSubmitRequest {
    NativeSmtpSubmitRequest {
        session_id: session_id.to_owned(),
        from: NativeAddressDto {
            name: Some("Alíce".to_owned()),
            email: USER.to_owned(),
        },
        to: vec![NativeAddressDto {
            name: None,
            email: "bob@boxplot.test".to_owned(),
        }],
        cc: vec![NativeAddressDto {
            name: None,
            email: "carol@boxplot.test".to_owned(),
        }],
        bcc: vec![NativeAddressDto {
            name: None,
            email: "hidden@boxplot.test".to_owned(),
        }],
        reply_to: vec![NativeAddressDto {
            name: None,
            email: "reply@boxplot.test".to_owned(),
        }],
        subject: "Hola 👋".to_owned(),
        body: NativeSubmissionBodyDto::Plain {
            text: body,
            html: Some("<p>html</p>".to_owned()),
        },
        idempotency_key: idempotency_key.to_owned(),
    }
}

#[test]
fn smtp_raw_bytes_hide_bcc_and_post_data_disconnect_is_ambiguous() {
    let transcript = Arc::new(Mutex::new(Vec::new()));
    let smtp = spawn_smtp(SmtpMode::Accept, Arc::clone(&transcript));
    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, imap.port, smtp.port);
    let accepted = runtime
        .smtp_submit(&submission(&session, "plain body".to_owned()))
        .expect("SMTP accepted");
    assert!(accepted.accepted);
    runtime.close(&session).expect("close accepted session");
    smtp.finish();
    imap.finish();
    let transcript = String::from_utf8(transcript.lock().expect("transcript").clone())
        .expect("ASCII SMTP transcript");
    assert!(transcript.contains("RCPT TO:<bob@boxplot.test>"));
    assert!(transcript.contains("RCPT TO:<carol@boxplot.test>"));
    assert!(transcript.contains("RCPT TO:<hidden@boxplot.test>"));
    assert!(!transcript.to_ascii_lowercase().contains("\r\nbcc:"));
    assert!(transcript.contains("Reply-To: reply@boxplot.test"));
    assert!(transcript.contains("multipart/alternative"));
    assert!(transcript.contains("Message-ID: <boxplot."));

    let transcript = Arc::new(Mutex::new(Vec::new()));
    let smtp = spawn_smtp(SmtpMode::DropAfterBody, Arc::clone(&transcript));
    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, imap.port, smtp.port);
    let error = runtime
        .smtp_submit(&submission(&session, "ambiguous body".to_owned()))
        .expect_err("missing final 250 is ambiguous");
    assert_eq!(error.retry, NativeMailRetry::Reconcile);
    assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    runtime.close(&session).expect("close ambiguous session");
    smtp.finish();
    imap.finish();
    assert!(!transcript.lock().expect("transcript").is_empty());
}

#[test]
fn smtp_message_id_is_deterministic_and_envelope_recipients_are_deduplicated() {
    let mut receipts = Vec::new();
    for idempotency_key in ["same-mutation", "same-mutation", "different-mutation"] {
        let transcript = Arc::new(Mutex::new(Vec::new()));
        let smtp = spawn_smtp(SmtpMode::Accept, Arc::clone(&transcript));
        let imap = spawn_idle_imap();
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, imap.port, smtp.port);
        let mut request = submission_with_id(&session, "deduplicated".to_owned(), idempotency_key);
        let repeated = NativeAddressDto {
            name: None,
            email: "bob@boxplot.test".to_owned(),
        };
        request.to = vec![repeated.clone()];
        request.cc = vec![repeated.clone()];
        request.bcc = vec![repeated];
        let response = runtime
            .smtp_submit(&request)
            .expect("deduplicated submission accepted");
        receipts.push(response.receipt_id);
        runtime.close(&session).expect("close Message-ID session");
        smtp.finish();
        imap.finish();
        let raw = String::from_utf8(transcript.lock().expect("transcript").clone())
            .expect("SMTP transcript text");
        assert_eq!(raw.matches("RCPT TO:<bob@boxplot.test>").count(), 1);
        assert!(!raw.to_ascii_lowercase().contains("\r\nbcc:"));
    }
    assert_eq!(receipts[0], receipts[1]);
    assert_ne!(receipts[0], receipts[2]);
    for message_id in receipts {
        assert!(message_id.starts_with("<boxplot."));
        assert!(message_id.ends_with("@boxplot.invalid>"));
        assert!(!message_id.contains("imap-email"));
    }
}

#[test]
fn smtp_pre_data_rejection_and_local_size_limit_are_known_not_applied() {
    let transcript = Arc::new(Mutex::new(Vec::new()));
    let smtp = spawn_smtp(SmtpMode::RejectMail, transcript);
    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, imap.port, smtp.port);
    let rejected = runtime
        .smtp_submit(&submission(&session, "small".to_owned()))
        .expect_err("MAIL rejection");
    assert_eq!(rejected.kind, NativeMailErrorKind::Rejected);
    assert_eq!(rejected.outcome, NativeMailOutcome::KnownNotApplied);
    runtime.close(&session).expect("close rejected session");
    smtp.finish();
    imap.finish();

    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, imap.port, unused_port());
    let too_large = runtime
        .smtp_submit(&submission(&session, "x".repeat(1024 * 1024)))
        .expect_err("serialized message over limit rejected before SMTP connect");
    assert_eq!(too_large.kind, NativeMailErrorKind::TooLarge);
    assert_eq!(too_large.outcome, NativeMailOutcome::KnownNotApplied);
    let mut spoof = submission(&session, "spoof".to_owned());
    spoof.from.email = "external@example.test".to_owned();
    let rejected = runtime
        .smtp_submit(&spoof)
        .expect_err("external sender rejected before SMTP connect");
    assert_eq!(rejected.kind, NativeMailErrorKind::Rejected);
    assert_eq!(rejected.outcome, NativeMailOutcome::KnownNotApplied);
    runtime.close(&session).expect("close size session");
    imap.finish();
}

#[test]
fn smtp_phase_failures_are_classified_by_possible_remote_application() {
    for (mode, expected_kind) in [
        (SmtpMode::RejectAuth, NativeMailErrorKind::Auth),
        (SmtpMode::RejectMail, NativeMailErrorKind::Rejected),
        (SmtpMode::RejectRecipient, NativeMailErrorKind::Rejected),
        (SmtpMode::RejectData, NativeMailErrorKind::Rejected),
    ] {
        let smtp = spawn_smtp(mode, Arc::new(Mutex::new(Vec::new())));
        let imap = spawn_idle_imap();
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, imap.port, smtp.port);
        let error = runtime
            .smtp_submit(&submission(&session, "phase rejection".to_owned()))
            .expect_err("pre-DATA rejection is typed");
        assert_eq!(error.kind, expected_kind);
        assert_eq!(error.outcome, NativeMailOutcome::KnownNotApplied);
        let _ = runtime.close(&session);
        smtp.finish();
        imap.finish();
    }

    let smtp = spawn_smtp(SmtpMode::DropDuringBody, Arc::new(Mutex::new(Vec::new())));
    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let session = open(&runtime, imap.port, smtp.port);
    let error = runtime
        .smtp_submit(&submission(&session, "x".repeat(256 * 1024)))
        .expect_err("body-phase disconnect is ambiguous");
    assert_eq!(error.retry, NativeMailRetry::Reconcile);
    assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    runtime.close(&session).expect("close body-drop session");
    smtp.finish();
    imap.finish();
}

#[test]
fn exact_local_smtp_size_boundary_accepts_maximal_body_and_rejects_next() {
    let mut low = 0usize;
    let mut high = 1024 * 1024;
    while low < high {
        let candidate = low + (high - low).div_ceil(2);
        let imap = spawn_idle_imap();
        let runtime = ManagedNativeMailRuntime::default();
        let session = open(&runtime, imap.port, unused_port());
        let error = runtime
            .smtp_submit(&submission(&session, "x".repeat(candidate)))
            .expect_err("probe either rejects locally or cannot connect");
        let too_large = error.kind == NativeMailErrorKind::TooLarge;
        let _ = runtime.close(&session);
        imap.finish();
        if too_large {
            high = candidate - 1;
        } else {
            assert_eq!(error.kind, NativeMailErrorKind::Unavailable);
            low = candidate;
        }
    }

    let transcript = Arc::new(Mutex::new(Vec::new()));
    let smtp = spawn_smtp(SmtpMode::Accept, Arc::clone(&transcript));
    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let accepted_session = open(&runtime, imap.port, smtp.port);
    runtime
        .smtp_submit(&submission(&accepted_session, "x".repeat(low)))
        .expect("largest generated body below serialized limit is accepted");
    runtime
        .close(&accepted_session)
        .expect("close accepted boundary session");
    smtp.finish();
    imap.finish();
    assert!(!transcript.lock().expect("transcript").is_empty());

    let imap = spawn_idle_imap();
    let runtime = ManagedNativeMailRuntime::default();
    let rejected_session = open(&runtime, imap.port, unused_port());
    let over = runtime
        .smtp_submit(&submission(&rejected_session, "x".repeat(low + 1)))
        .expect_err("next body size crosses the serialized limit");
    assert_eq!(over.kind, NativeMailErrorKind::TooLarge);
    assert_eq!(over.outcome, NativeMailOutcome::KnownNotApplied);
    runtime
        .close(&rejected_session)
        .expect("close rejected boundary session");
    imap.finish();
}

#[test]
fn non_loopback_rejection_and_debug_surfaces_do_not_expose_canary() {
    let runtime = ManagedNativeMailRuntime::default();
    for host in ["192.168.1.10", "10.0.0.1", "8.8.8.8", "0.0.0.0"] {
        let request = request(host, 1143, 1587, PASSWORD);
        assert!(!format!("{request:?}").contains(PASSWORD));
        let error = runtime.open(request).expect_err("non-loopback rejected");
        assert_eq!(error.kind, NativeMailErrorKind::Unsupported);
        assert!(!format!("{error:?}").contains(PASSWORD));
    }

    let policy = include_str!("../src/net/policy.rs");
    assert_eq!(policy.matches(".to_socket_addrs()").count(), 1);
    assert!(policy.contains("addresses.iter().any"));
    assert!(policy.contains("addresses.first().copied()"));

    let imap = include_str!("../src/net/imap.rs");
    let smtp = include_str!("../src/net/smtp.rs");
    assert!(!imap.contains("format!(\"{tag} {command}\\r\\n\")"));
    assert!(!smtp.contains("format!(\"{command}\\r\\n\")"));
    assert!(imap.contains("writer.write_all(command.as_bytes())"));
    assert!(smtp.contains("writer.write_all(command.as_bytes())"));
    assert!(imap.contains("Zeroizing<String>"));
    assert!(smtp.contains("Zeroizing<Vec<u8>>"));
}

#[test]
fn alternate_ipv4_and_ipv6_loopback_addresses_are_accepted_when_available() {
    for (bind_address, host) in [("127.0.0.2:0", "127.0.0.2"), ("[::1]:0", "::1")] {
        let Ok(listener) = TcpListener::bind(bind_address) else {
            assert_eq!(host, "::1", "IPv4 loopback support is required");
            continue;
        };
        let port = listener.local_addr().expect("listener address").port();
        let handle = thread::spawn(move || {
            let (stream, _) = listener.accept().expect("loopback client");
            let mut peer = ImapPeer::new(stream, false);
            peer.authenticate();
            let (tag, command) = peer.command();
            assert_eq!(command, "LOGOUT");
            peer.tagged(&tag, &["* BYE logout".to_owned()]);
        });
        let runtime = ManagedNativeMailRuntime::default();
        let session = runtime
            .open(request(host, port, unused_port(), PASSWORD))
            .expect("verified loopback address accepted")
            .session_id;
        runtime.close(&session).expect("loopback session closes");
        handle.join().expect("loopback server");
    }
}

#[test]
fn session_ids_are_opaque_unique_and_closed_sessions_are_unusable() {
    let accepted = Arc::new(AtomicUsize::new(0));
    let accepted_count = Arc::clone(&accepted);
    let listener = TcpListener::bind("127.0.0.1:0").expect("session server bind");
    let port = listener.local_addr().expect("session address").port();
    let handle = thread::spawn(move || {
        let mut clients = Vec::new();
        for _ in 0..33 {
            let (stream, _) = listener.accept().expect("session accept");
            let accepted_count = Arc::clone(&accepted_count);
            clients.push(thread::spawn(move || {
                let mut peer = ImapPeer::new(stream, false);
                peer.write(b"* OK auth test\r\n");
                let (tag, login) = peer.command();
                let username = if login.contains("\"alice@boxplot.test\"") {
                    "alice@boxplot.test"
                } else if login.contains("\"bob@boxplot.test\"") {
                    "bob@boxplot.test"
                } else {
                    "unknown"
                };
                let valid = username != "unknown" && login.contains(PASSWORD);
                if !valid {
                    peer.write(format!("{tag} NO invalid credentials\r\n").as_bytes());
                    return;
                }
                accepted_count.fetch_add(1, Ordering::SeqCst);
                peer.tagged(&tag, &[]);
                loop {
                    let Ok((tag, command)) =
                        std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| peer.command()))
                    else {
                        break;
                    };
                    if command.starts_with("LIST ") {
                        peer.tagged(&tag, &[format!("* LIST () \"/\" \"{username}\"")]);
                    } else if command.starts_with("STATUS ") {
                        peer.tagged(
                            &tag,
                            &[format!(
                                "* STATUS \"{username}\" (MESSAGES 0 UNSEEN 0 UIDNEXT 1 UIDVALIDITY 1)"
                            )],
                        );
                    } else if command == "LOGOUT" {
                        peer.tagged(&tag, &["* BYE logout".to_owned()]);
                        break;
                    } else {
                        panic!("unexpected session command: {command}");
                    }
                }
            }));
        }
        for client in clients {
            client.join().expect("session client");
        }
    });

    let runtime = ManagedNativeMailRuntime::default();
    let first = runtime
        .open(request("127.0.0.1", port, unused_port(), PASSWORD))
        .expect("first session");
    let second = runtime
        .open(request_for(
            "127.0.0.1",
            port,
            unused_port(),
            "bob@boxplot.test",
            PASSWORD,
        ))
        .expect("second session");
    let mut sessions = vec![first, second];
    for index in 0..30 {
        let username = if index % 2 == 0 {
            "alice@boxplot.test"
        } else {
            "bob@boxplot.test"
        };
        sessions.push(
            runtime
                .open(request_for(
                    "127.0.0.1",
                    port,
                    unused_port(),
                    username,
                    PASSWORD,
                ))
                .expect("sample session"),
        );
    }
    let unique = sessions
        .iter()
        .map(|session| session.session_id.as_str())
        .collect::<std::collections::BTreeSet<_>>();
    assert_eq!(unique.len(), sessions.len());
    let first = &sessions[0];
    let second = &sessions[1];
    assert_ne!(first.session_id, second.session_id);
    assert!(!first.session_id.contains("alice"));
    assert_eq!(
        runtime
            .list_mailboxes(&first.session_id)
            .expect("first list")[0]
            .name,
        USER
    );
    assert_eq!(
        runtime
            .list_mailboxes(&second.session_id)
            .expect("second list")[0]
            .name,
        "bob@boxplot.test"
    );
    let canary = "BOXPL0T_WRONG_AUTH_CANARY_551";
    let auth = runtime
        .open(request("127.0.0.1", port, unused_port(), canary))
        .expect_err("wrong auth rejected");
    assert_eq!(auth.kind, NativeMailErrorKind::Auth);
    assert!(!format!("{auth:?}").contains(canary));
    runtime.close(&first.session_id).expect("first close");
    assert_eq!(
        runtime
            .list_mailboxes(&first.session_id)
            .expect_err("closed session invalid")
            .kind,
        NativeMailErrorKind::StateInvalid
    );
    for session in sessions.iter().skip(1) {
        runtime.close(&session.session_id).expect("sample close");
    }
    assert_eq!(accepted.load(Ordering::SeqCst), 32);
    handle.join().expect("session server");
}
