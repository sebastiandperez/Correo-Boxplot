use std::{
    collections::HashSet,
    io::{BufRead, BufReader, Write},
    net::{SocketAddr, TcpStream},
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use base64::{Engine as _, engine::general_purpose::STANDARD};
use mail_parser::DateTime;
use zeroize::Zeroizing;

use super::{
    dto::{
        NativeAddressDto, NativeSmtpSubmitRequest, NativeSmtpSubmitResponse,
        NativeSubmissionBodyDto,
    },
    errors::NativeMailErrorDto,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);
const MAX_MESSAGE_BYTES: usize = 1024 * 1024;

pub fn submit(
    endpoint: SocketAddr,
    authenticated_user: &str,
    password: &str,
    request: &NativeSmtpSubmitRequest,
) -> Result<NativeSmtpSubmitResponse, NativeMailErrorDto> {
    if request.from.email != authenticated_user {
        return Err(NativeMailErrorDto::rejected("smtp_sender_mismatch"));
    }
    let built = build_message(request)?;
    if built.message.len() > MAX_MESSAGE_BYTES {
        return Err(NativeMailErrorDto::too_large());
    }
    let mut recipients = Vec::new();
    let mut seen = HashSet::new();
    for address in request.to.iter().chain(&request.cc).chain(&request.bcc) {
        validate_address(address)?;
        if seen.insert(address.email.as_str()) {
            recipients.push(address.email.as_str());
        }
    }
    if recipients.is_empty() {
        return Err(NativeMailErrorDto::rejected("smtp_recipient_required"));
    }

    let stream = TcpStream::connect_timeout(&endpoint, CONNECT_TIMEOUT)
        .map_err(|_| NativeMailErrorDto::unavailable("smtp_connect_failed"))?;
    stream
        .set_read_timeout(Some(COMMAND_TIMEOUT))
        .map_err(|_| NativeMailErrorDto::unavailable("smtp_timeout_setup_failed"))?;
    stream
        .set_write_timeout(Some(COMMAND_TIMEOUT))
        .map_err(|_| NativeMailErrorDto::unavailable("smtp_timeout_setup_failed"))?;
    let reader_stream = stream
        .try_clone()
        .map_err(|_| NativeMailErrorDto::unavailable("smtp_stream_failed"))?;
    let mut client = SmtpClient {
        writer: stream,
        reader: BufReader::new(reader_stream),
    };
    client.expect_code(220, false)?;
    client.command("EHLO boxplot.invalid", 250, false)?;
    let auth_command = auth_plain_command(authenticated_user, password);
    match client.command(&auth_command, 235, false) {
        Ok(()) => {}
        Err(error) if error.code == Some("smtp_rejected") => return Err(NativeMailErrorDto::auth()),
        Err(error) => return Err(error),
    }
    client.command(&format!("MAIL FROM:<{}>", request.from.email), 250, false)?;
    for recipient in recipients {
        client.command(&format!("RCPT TO:<{recipient}>"), 250, false)?;
    }
    client.command("DATA", 354, false)?;
    let wire_message = dot_stuff(&built.message);
    client
        .writer
        .write_all(&wire_message)
        .and_then(|_| client.writer.write_all(b"\r\n.\r\n"))
        .and_then(|_| client.writer.flush())
        .map_err(|_| NativeMailErrorDto::ambiguous("smtp_data_write_unknown"))?;
    client.expect_code(250, true)?;
    let _ = client.command("QUIT", 221, false);
    Ok(NativeSmtpSubmitResponse {
        accepted: true,
        receipt_id: built.message_id,
    })
}

fn auth_plain_command(username: &str, password: &str) -> Zeroizing<String> {
    let plaintext = auth_plain_payload(username, password);
    let encoded = encode_auth_plain(&plaintext);
    let mut command = Zeroizing::new(String::with_capacity(11 + encoded.len()));
    command.push_str("AUTH PLAIN ");
    command.push_str(encoded.as_str());
    command
}

fn auth_plain_payload(username: &str, password: &str) -> Zeroizing<Vec<u8>> {
    let mut plaintext = Zeroizing::new(Vec::with_capacity(username.len() + password.len() + 2));
    plaintext.push(0);
    plaintext.extend_from_slice(username.as_bytes());
    plaintext.push(0);
    plaintext.extend_from_slice(password.as_bytes());
    plaintext
}

fn encode_auth_plain(plaintext: &[u8]) -> Zeroizing<String> {
    Zeroizing::new(STANDARD.encode(plaintext))
}

pub struct BuiltMessage {
    pub message: Vec<u8>,
    pub message_id: String,
}

pub fn build_message(
    request: &NativeSmtpSubmitRequest,
) -> Result<BuiltMessage, NativeMailErrorDto> {
    validate_address(&request.from)?;
    for address in request
        .to
        .iter()
        .chain(&request.cc)
        .chain(&request.bcc)
        .chain(&request.reply_to)
    {
        validate_address(address)?;
    }
    validate_header(&request.subject)?;
    let encoded_key =
        base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(request.idempotency_key.as_bytes());
    let message_id = format!("<boxplot.{encoded_key}@boxplot.invalid>");
    let seconds = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|value| value.as_secs())
        .unwrap_or_default();
    let timestamp = i64::try_from(seconds).unwrap_or(i64::MAX);
    let mut headers = vec![
        format!("From: {}", format_address(&request.from)?),
        format!("To: {}", format_addresses(&request.to)?),
    ];
    if !request.cc.is_empty() {
        headers.push(format!("Cc: {}", format_addresses(&request.cc)?));
    }
    if !request.reply_to.is_empty() {
        headers.push(format!(
            "Reply-To: {}",
            format_addresses(&request.reply_to)?
        ));
    }
    headers.extend([
        format!("Subject: {}", encode_header(&request.subject)),
        format!("Date: {}", DateTime::from_timestamp(timestamp).to_rfc822()),
        format!("Message-ID: {message_id}"),
        "MIME-Version: 1.0".to_owned(),
    ]);
    let body = match &request.body {
        NativeSubmissionBodyDto::Plain { text, html: None } => {
            headers.push("Content-Type: text/plain; charset=utf-8".to_owned());
            headers.push("Content-Transfer-Encoding: base64".to_owned());
            encode_body(text.as_bytes())
        }
        NativeSubmissionBodyDto::Plain {
            text,
            html: Some(html),
        } => {
            let boundary = format!("boxplot-{encoded_key}");
            headers.push(format!(
                "Content-Type: multipart/alternative; boundary=\"{boundary}\""
            ));
            format!(
                "--{boundary}\r\nContent-Type: text/plain; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n--{boundary}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Transfer-Encoding: base64\r\n\r\n{}\r\n--{boundary}--",
                encode_body(text.as_bytes()),
                encode_body(html.as_bytes())
            )
        }
        NativeSubmissionBodyDto::BoxplotE2ee { payload } => {
            headers.push("Content-Type: application/vnd.boxplot.e2ee+json".to_owned());
            headers.push("Content-Transfer-Encoding: base64".to_owned());
            encode_body(payload.as_bytes())
        }
    };
    let message = format!("{}\r\n\r\n{}", headers.join("\r\n"), body).into_bytes();
    Ok(BuiltMessage {
        message,
        message_id,
    })
}

struct SmtpClient {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
}

impl SmtpClient {
    fn command(
        &mut self,
        command: &str,
        expected: u16,
        ambiguous: bool,
    ) -> Result<(), NativeMailErrorDto> {
        write_smtp_command(&mut self.writer, command).map_err(|_| {
            if ambiguous {
                NativeMailErrorDto::ambiguous("smtp_write_unknown")
            } else {
                NativeMailErrorDto::unavailable("smtp_write_failed")
            }
        })?;
        self.expect_code(expected, ambiguous)
    }

    fn expect_code(&mut self, expected: u16, ambiguous: bool) -> Result<(), NativeMailErrorDto> {
        loop {
            let mut line = String::new();
            let read = self.reader.read_line(&mut line).map_err(|_| {
                if ambiguous {
                    NativeMailErrorDto::ambiguous("smtp_response_unknown")
                } else {
                    NativeMailErrorDto::unavailable("smtp_read_failed")
                }
            })?;
            if read == 0 {
                return Err(if ambiguous {
                    NativeMailErrorDto::ambiguous("smtp_response_unknown")
                } else {
                    NativeMailErrorDto::unavailable("smtp_connection_closed")
                });
            }
            let code = line
                .get(..3)
                .and_then(|value| value.parse::<u16>().ok())
                .ok_or_else(|| NativeMailErrorDto::protocol("smtp_response_invalid"))?;
            let continuation = line.as_bytes().get(3) == Some(&b'-');
            if !continuation {
                if code == expected {
                    return Ok(());
                }
                return Err(if ambiguous {
                    NativeMailErrorDto::ambiguous("smtp_acceptance_unknown")
                } else if (400..500).contains(&code) {
                    NativeMailErrorDto::transient("smtp_transient_rejection")
                } else {
                    NativeMailErrorDto::rejected("smtp_rejected")
                });
            }
        }
    }
}

fn write_smtp_command(writer: &mut impl Write, command: &str) -> std::io::Result<()> {
    writer.write_all(command.as_bytes())?;
    writer.write_all(b"\r\n")?;
    writer.flush()
}

fn validate_address(address: &NativeAddressDto) -> Result<(), NativeMailErrorDto> {
    validate_header(&address.email)?;
    if address.email.is_empty() || !address.email.contains('@') {
        return Err(NativeMailErrorDto::rejected("smtp_address_invalid"));
    }
    if let Some(name) = &address.name {
        validate_header(name)?;
    }
    Ok(())
}

fn validate_header(value: &str) -> Result<(), NativeMailErrorDto> {
    if value.contains(['\r', '\n', '\0']) {
        Err(NativeMailErrorDto::rejected("smtp_header_invalid"))
    } else {
        Ok(())
    }
}

fn format_addresses(values: &[NativeAddressDto]) -> Result<String, NativeMailErrorDto> {
    values
        .iter()
        .map(format_address)
        .collect::<Result<Vec<_>, _>>()
        .map(|values| values.join(", "))
}

fn format_address(value: &NativeAddressDto) -> Result<String, NativeMailErrorDto> {
    validate_address(value)?;
    Ok(match &value.name {
        Some(name) if !name.is_empty() => {
            format!("{} <{}>", encode_display_name(name), value.email)
        }
        _ => value.email.clone(),
    })
}

fn encode_display_name(value: &str) -> String {
    if value.is_ascii() {
        format!("\"{}\"", value.replace('\\', "\\\\").replace('"', "\\\""))
    } else {
        encode_header(value)
    }
}

fn encode_header(value: &str) -> String {
    if value.is_ascii() {
        value.to_owned()
    } else {
        format!("=?UTF-8?B?{}?=", STANDARD.encode(value.as_bytes()))
    }
}

fn encode_body(value: &[u8]) -> String {
    STANDARD
        .encode(value)
        .as_bytes()
        .chunks(76)
        .map(|chunk| String::from_utf8_lossy(chunk))
        .collect::<Vec<_>>()
        .join("\r\n")
}

fn dot_stuff(value: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(value).replace("\r\n.", "\r\n..");
    text.into_bytes()
}

#[cfg(test)]
mod tests {
    use super::{
        auth_plain_command, auth_plain_payload, build_message, encode_auth_plain,
        write_smtp_command,
    };
    use crate::net::dto::{NativeAddressDto, NativeSmtpSubmitRequest, NativeSubmissionBodyDto};

    fn request() -> NativeSmtpSubmitRequest {
        NativeSmtpSubmitRequest {
            session_id: "session".to_owned(),
            from: NativeAddressDto {
                name: Some("Alíce".to_owned()),
                email: "alice@boxplot.test".to_owned(),
            },
            to: vec![NativeAddressDto {
                name: None,
                email: "bob@boxplot.test".to_owned(),
            }],
            cc: vec![],
            bcc: vec![NativeAddressDto {
                name: None,
                email: "hidden@boxplot.test".to_owned(),
            }],
            reply_to: vec![],
            subject: "Hola 👋".to_owned(),
            body: NativeSubmissionBodyDto::Plain {
                text: "plain".to_owned(),
                html: Some("<p>html</p>".to_owned()),
            },
            idempotency_key: "mutation-1".to_owned(),
        }
    }

    #[test]
    fn builds_multipart_without_bcc_header_and_with_deterministic_id() {
        let first = build_message(&request()).expect("message builds");
        let second = build_message(&request()).expect("message builds");
        let text = String::from_utf8(first.message).expect("ASCII MIME envelope");
        assert!(text.contains("multipart/alternative"));
        assert!(!text.to_ascii_lowercase().contains("\r\nbcc:"));
        assert_eq!(first.message_id, second.message_id);
    }

    #[test]
    fn rejects_header_injection() {
        let mut value = request();
        value.subject = "ok\r\nBcc: attacker@example.test".to_owned();
        assert!(build_message(&value).is_err());
    }

    #[test]
    fn auth_plain_command_is_owned_by_a_zeroizing_buffer() {
        let command = auth_plain_command(
            "alice@boxplot.test",
            "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291",
        );
        assert!(command.starts_with("AUTH PLAIN "));
        assert!(!command.contains("BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291"));
    }

    #[test]
    fn auth_plaintext_is_owned_by_a_zeroizing_buffer() {
        let plaintext = auth_plain_payload(
            "alice@boxplot.test",
            "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291",
        );
        assert!(plaintext.ends_with(b"BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291"));
    }

    #[test]
    fn auth_encoding_is_owned_by_a_zeroizing_buffer() {
        let plaintext = auth_plain_payload(
            "alice@boxplot.test",
            "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291",
        );
        let encoded = encode_auth_plain(&plaintext);
        assert!(!encoded.contains("BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291"));
    }

    #[test]
    fn smtp_framing_writes_exact_borrowed_command_bytes() {
        let mut wire = Vec::new();
        write_smtp_command(&mut wire, "AUTH PLAIN abc").expect("framing succeeds");
        assert_eq!(wire, b"AUTH PLAIN abc\r\n");
    }

    #[test]
    fn builds_boxplot_e2ee_transport_without_decrypting() {
        let mut value = request();
        value.body = NativeSubmissionBodyDto::BoxplotE2ee {
            payload: "{\"version\":1,\"ciphertext\":\"opaque\"}".to_owned(),
        };
        let built = build_message(&value).expect("E2EE transport builds");
        let text = String::from_utf8(built.message).expect("MIME headers are UTF-8");
        assert!(text.contains("Content-Type: application/vnd.boxplot.e2ee+json"));
        assert!(!text.contains("ciphertext"));
    }
}
