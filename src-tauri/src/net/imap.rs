use std::{
    io::{BufRead, BufReader, Read, Write},
    net::{SocketAddr, TcpStream},
    time::Duration,
};
use zeroize::Zeroizing;

use super::{
    dto::{NativeMailboxDto, NativeMailboxSnapshotDto, NativeMoveResponse},
    errors::{NativeMailErrorDto, NativeMailErrorKind, NativeMailOutcome, NativeMailRetry},
    mime::parse_message,
};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(5);
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

struct ResponseLine {
    text: String,
    literal: Option<Vec<u8>>,
}

pub struct ImapConnection {
    writer: TcpStream,
    reader: BufReader<TcpStream>,
    next_tag: u32,
}

impl std::fmt::Debug for ImapConnection {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("ImapConnection")
            .finish_non_exhaustive()
    }
}

impl ImapConnection {
    pub fn connect(
        endpoint: SocketAddr,
        username: &str,
        password: &str,
    ) -> Result<Self, NativeMailErrorDto> {
        let writer = TcpStream::connect_timeout(&endpoint, CONNECT_TIMEOUT)
            .map_err(|_| NativeMailErrorDto::unavailable("imap_connect_failed"))?;
        writer
            .set_read_timeout(Some(COMMAND_TIMEOUT))
            .map_err(|_| NativeMailErrorDto::unavailable("imap_timeout_setup_failed"))?;
        writer
            .set_write_timeout(Some(COMMAND_TIMEOUT))
            .map_err(|_| NativeMailErrorDto::unavailable("imap_timeout_setup_failed"))?;
        let reader_stream = writer
            .try_clone()
            .map_err(|_| NativeMailErrorDto::unavailable("imap_stream_failed"))?;
        let mut connection = Self {
            writer,
            reader: BufReader::new(reader_stream),
            next_tag: 1,
        };
        let greeting = connection.read_text_line()?;
        if !greeting.starts_with("* OK") {
            return Err(NativeMailErrorDto::protocol("imap_greeting_rejected"));
        }
        validate_atom(username)?;
        let login = Zeroizing::new(format!("LOGIN {} {}", quote(username)?, quote(password)?));
        match connection.command(&login) {
            Ok(_) => Ok(connection),
            Err(error) if error.kind == NativeMailErrorKind::Rejected => {
                Err(NativeMailErrorDto::auth())
            }
            Err(error) => Err(error),
        }
    }

    pub fn logout(&mut self) {
        let _ = self.command("LOGOUT");
    }

    pub fn list_mailboxes(&mut self) -> Result<Vec<NativeMailboxDto>, NativeMailErrorDto> {
        let lines = self.command("LIST \"\" \"*\"")?;
        let mut names = Vec::new();
        for line in lines {
            if line.text.starts_with("* LIST ")
                && let Some(name) = last_quoted(&line.text)
            {
                names.push(name);
            }
        }
        let mut mailboxes = Vec::with_capacity(names.len());
        for name in names {
            mailboxes.push(self.status(&name)?);
        }
        Ok(mailboxes)
    }

    pub fn status(&mut self, mailbox: &str) -> Result<NativeMailboxDto, NativeMailErrorDto> {
        let lines = self.command(&format!(
            "STATUS {} (MESSAGES UNSEEN UIDNEXT UIDVALIDITY)",
            quote(mailbox)?
        ))?;
        let line = lines
            .iter()
            .find(|line| line.text.starts_with("* STATUS "))
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_status_missing"))?;
        Ok(NativeMailboxDto {
            name: mailbox.to_owned(),
            messages: number_after(&line.text, "MESSAGES")?,
            unseen: number_after(&line.text, "UNSEEN")?,
            uid_next: u32::try_from(number_after(&line.text, "UIDNEXT")?)
                .map_err(|_| NativeMailErrorDto::protocol("imap_uidnext_invalid"))?,
            uid_validity: u32::try_from(number_after(&line.text, "UIDVALIDITY")?)
                .map_err(|_| NativeMailErrorDto::protocol("imap_uidvalidity_invalid"))?,
        })
    }

    pub fn snapshot(
        &mut self,
        mailbox: &str,
    ) -> Result<NativeMailboxSnapshotDto, NativeMailErrorDto> {
        let selected = self.select(mailbox)?;
        let lines = self.command("UID SEARCH ALL")?;
        let search = lines
            .iter()
            .find(|line| line.text.starts_with("* SEARCH"))
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_search_missing"))?;
        let uids = search
            .text
            .split_whitespace()
            .skip(2)
            .map(|value| {
                value
                    .parse::<u32>()
                    .map_err(|_| NativeMailErrorDto::protocol("imap_uid_invalid"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        let mut messages = Vec::with_capacity(uids.len());
        for uid in uids {
            let fetched = self.fetch(uid)?;
            messages.push(parse_message(&fetched.raw)?.metadata(
                mailbox.to_owned(),
                selected.uid_validity,
                uid,
                fetched.flags,
                fetched.internal_date,
                fetched.size,
            ));
        }
        let mailbox_status = self.status(mailbox)?;
        if mailbox_status.uid_validity != selected.uid_validity
            || mailbox_status.messages != u64::try_from(messages.len()).unwrap_or(u64::MAX)
        {
            return Err(NativeMailErrorDto::conflict("imap_snapshot_changed"));
        }
        Ok(NativeMailboxSnapshotDto {
            mailbox: mailbox_status,
            messages,
        })
    }

    pub fn fetch_raw_checked(
        &mut self,
        mailbox: &str,
        expected_uid_validity: u32,
        uid: u32,
    ) -> Result<Vec<u8>, NativeMailErrorDto> {
        let selected = self.select(mailbox)?;
        if selected.uid_validity != expected_uid_validity {
            return Err(NativeMailErrorDto::state_invalid("uidvalidity_changed"));
        }
        Ok(self.fetch(uid)?.raw)
    }

    pub fn store_flags(
        &mut self,
        mailbox: &str,
        expected_uid_validity: u32,
        uid: u32,
        operations: &[(bool, &'static str)],
    ) -> Result<(), NativeMailErrorDto> {
        let selected = self.select(mailbox)?;
        if selected.uid_validity != expected_uid_validity {
            return Err(NativeMailErrorDto::state_invalid("uidvalidity_changed"));
        }
        let mut applied = false;
        for (add, flag) in operations {
            let command = format!(
                "UID STORE {uid} {}FLAGS.SILENT ({flag})",
                if *add { "+" } else { "-" }
            );
            if let Err(mut error) = self.command(&command) {
                if applied {
                    error.retry = NativeMailRetry::Reconcile;
                    error.outcome = NativeMailOutcome::Unknown;
                }
                return Err(error);
            }
            applied = true;
        }
        Ok(())
    }

    pub fn move_message(
        &mut self,
        mailbox: &str,
        expected_uid_validity: u32,
        uid: u32,
        destination: &str,
    ) -> Result<NativeMoveResponse, NativeMailErrorDto> {
        let selected = self.select(mailbox)?;
        if selected.uid_validity != expected_uid_validity {
            return Err(NativeMailErrorDto::state_invalid("uidvalidity_changed"));
        }
        let lines = self.command(&format!("UID MOVE {uid} {}", quote(destination)?))?;
        let destination_uid = lines
            .iter()
            .find(|line| line.text.contains("[COPYUID "))
            .and_then(|line| line.text.split(']').next())
            .and_then(|value| value.split_whitespace().last())
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_copyuid_missing"))?;
        Ok(NativeMoveResponse {
            source_mailbox: mailbox.to_owned(),
            source_uid_validity: expected_uid_validity,
            source_uid: uid,
            destination_mailbox: destination.to_owned(),
            destination_uid,
        })
    }

    fn select(&mut self, mailbox: &str) -> Result<SelectedMailbox, NativeMailErrorDto> {
        let lines = self.command(&format!("SELECT {}", quote(mailbox)?))?;
        let uid_validity = lines
            .iter()
            .find_map(|line| bracket_number(&line.text, "UIDVALIDITY"))
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_uidvalidity_missing"))?;
        Ok(SelectedMailbox { uid_validity })
    }

    fn fetch(&mut self, uid: u32) -> Result<FetchedMessage, NativeMailErrorDto> {
        let lines = self.command(&format!(
            "UID FETCH {uid} (UID FLAGS INTERNALDATE RFC822.SIZE BODY.PEEK[])"
        ))?;
        let line = lines
            .into_iter()
            .find(|line| line.literal.is_some())
            .ok_or_else(|| NativeMailErrorDto::state_invalid("imap_message_absent"))?;
        let flags = between(&line.text, "FLAGS (", ")")
            .unwrap_or_default()
            .split_whitespace()
            .map(str::to_owned)
            .collect();
        let internal_date = between(&line.text, "INTERNALDATE \"", "\"")
            .and_then(imap_date_to_rfc3339)
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_internaldate_invalid"))?;
        let size = number_after(&line.text, "RFC822.SIZE")?;
        Ok(FetchedMessage {
            flags,
            internal_date,
            size,
            raw: line.literal.unwrap_or_default(),
        })
    }

    fn command(&mut self, command: &str) -> Result<Vec<ResponseLine>, NativeMailErrorDto> {
        let tag = format!("B{:04}", self.next_tag);
        self.next_tag = self.next_tag.saturating_add(1);
        self.writer
            .write_all(format!("{tag} {command}\r\n").as_bytes())
            .and_then(|_| self.writer.flush())
            .map_err(|_| NativeMailErrorDto::unavailable("imap_write_failed"))?;
        let mut lines = Vec::new();
        loop {
            let text = self.read_text_line()?;
            let literal_length = literal_length(&text);
            let literal = match literal_length {
                Some(length) => {
                    let mut value = vec![0_u8; length];
                    self.reader
                        .read_exact(&mut value)
                        .map_err(|_| NativeMailErrorDto::unavailable("imap_literal_failed"))?;
                    let trailer = self.read_text_line()?;
                    if trailer != ")" {
                        return Err(NativeMailErrorDto::protocol("imap_literal_trailer_invalid"));
                    }
                    Some(value)
                }
                None => None,
            };
            if text.starts_with(&format!("{tag} ")) {
                if text.starts_with(&format!("{tag} OK")) {
                    return Ok(lines);
                }
                return Err(NativeMailErrorDto::rejected("imap_command_rejected"));
            }
            lines.push(ResponseLine { text, literal });
        }
    }

    fn read_text_line(&mut self) -> Result<String, NativeMailErrorDto> {
        let mut line = Vec::new();
        let read = self
            .reader
            .read_until(b'\n', &mut line)
            .map_err(|_| NativeMailErrorDto::unavailable("imap_read_failed"))?;
        if read == 0 {
            return Err(NativeMailErrorDto::unavailable("imap_connection_closed"));
        }
        while matches!(line.last(), Some(b'\n' | b'\r')) {
            line.pop();
        }
        String::from_utf8(line).map_err(|_| NativeMailErrorDto::protocol("imap_utf8_invalid"))
    }
}

struct SelectedMailbox {
    uid_validity: u32,
}

struct FetchedMessage {
    flags: Vec<String>,
    internal_date: String,
    size: u64,
    raw: Vec<u8>,
}

fn quote(value: &str) -> Result<String, NativeMailErrorDto> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(NativeMailErrorDto::protocol("imap_argument_invalid"));
    }
    Ok(format!(
        "\"{}\"",
        value.replace('\\', "\\\\").replace('"', "\\\"")
    ))
}

fn validate_atom(value: &str) -> Result<(), NativeMailErrorDto> {
    if value.is_empty() || value.contains(['\r', '\n', '\0']) {
        Err(NativeMailErrorDto::protocol("imap_argument_invalid"))
    } else {
        Ok(())
    }
}

fn last_quoted(value: &str) -> Option<String> {
    let end = value.rfind('"')?;
    let start = value[..end].rfind('"')?;
    Some(
        value[start + 1..end]
            .replace("\\\"", "\"")
            .replace("\\\\", "\\"),
    )
}

fn number_after(value: &str, key: &str) -> Result<u64, NativeMailErrorDto> {
    let remainder = value
        .split_once(key)
        .map(|(_, rest)| rest)
        .ok_or_else(|| NativeMailErrorDto::protocol("imap_numeric_response_missing"))?;
    remainder
        .trim_start()
        .split(|character: char| !character.is_ascii_digit())
        .next()
        .and_then(|number| number.parse().ok())
        .ok_or_else(|| NativeMailErrorDto::protocol("imap_numeric_response_invalid"))
}

fn bracket_number(value: &str, key: &str) -> Option<u32> {
    let marker = format!("[{key} ");
    value.split_once(&marker)?.1.split(']').next()?.parse().ok()
}

fn between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let rest = value.split_once(start)?.1;
    Some(rest.split_once(end)?.0)
}

fn literal_length(value: &str) -> Option<usize> {
    value.strip_suffix('}')?.rsplit_once('{')?.1.parse().ok()
}

fn imap_date_to_rfc3339(value: &str) -> Option<String> {
    let mut parts = value.split_whitespace();
    let date = parts.next()?;
    let time = parts.next()?;
    let timezone = parts.next()?;
    let mut date_parts = date.split('-');
    let day = date_parts.next()?.parse::<u8>().ok()?;
    let month = match date_parts.next()?.to_ascii_lowercase().as_str() {
        "jan" => 1,
        "feb" => 2,
        "mar" => 3,
        "apr" => 4,
        "may" => 5,
        "jun" => 6,
        "jul" => 7,
        "aug" => 8,
        "sep" => 9,
        "oct" => 10,
        "nov" => 11,
        "dec" => 12,
        _ => return None,
    };
    let year = date_parts.next()?.parse::<u16>().ok()?;
    if time.split(':').count() != 3 || timezone.len() != 5 {
        return None;
    }
    Some(format!(
        "{year:04}-{month:02}-{day:02}T{time}{}:{}",
        &timezone[..3],
        &timezone[3..]
    ))
}

#[cfg(test)]
mod tests {
    use super::{imap_date_to_rfc3339, literal_length, quote};

    #[test]
    fn parses_literal_and_date() {
        assert_eq!(literal_length("* 1 FETCH (BODY[] {42}"), Some(42));
        assert_eq!(
            imap_date_to_rfc3339("28-Aug-2026 12:01:02 +0000").as_deref(),
            Some("2026-08-28T12:01:02+00:00")
        );
    }

    #[test]
    fn quotes_without_allowing_command_injection() {
        assert_eq!(quote("A \\\" B").expect("valid"), "\"A \\\\\\\" B\"");
        assert!(quote("INBOX\r\nLOGOUT").is_err());
    }
}
