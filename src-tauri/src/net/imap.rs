use std::{
    collections::BTreeMap,
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
const MAX_IMAP_LINE_BYTES: usize = 64 * 1024;
const MAX_IMAP_LITERAL_BYTES: usize = 2 * 1024 * 1024;
const MAX_IMAP_RESPONSE_LINES: usize = 4096;
const MAX_IMAP_RESPONSE_TEXT_BYTES: usize = 1024 * 1024;

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
        let login = login_command(username, password)?;
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
        let initial_status = self.status(mailbox)?;
        if initial_status.uid_validity != selected.uid_validity {
            return Err(NativeMailErrorDto::conflict("imap_snapshot_changed"));
        }
        let initial_uids = self.search_uids()?;
        let mut messages = Vec::with_capacity(initial_uids.len());
        let mut initial_flags = BTreeMap::new();
        for uid in initial_uids.iter().copied() {
            let fetched = self.fetch(uid).map_err(snapshot_fetch_error)?;
            initial_flags.insert(uid, canonical_flags(&fetched.flags));
            messages.push(parse_message(&fetched.raw)?.metadata(
                mailbox.to_owned(),
                selected.uid_validity,
                uid,
                fetched.flags,
                fetched.internal_date,
                fetched.size,
            ));
        }
        let final_status = self.status(mailbox)?;
        let final_uids = self.search_uids()?;
        let final_flags = self
            .fetch_flag_snapshot(&final_uids)
            .map_err(snapshot_fetch_error)?;
        ensure_snapshot_stable(
            selected.uid_validity,
            &initial_status,
            &initial_uids,
            &final_status,
            &final_uids,
            &initial_flags,
            &final_flags,
        )?;
        Ok(NativeMailboxSnapshotDto {
            mailbox: final_status,
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
            if let Err(mut error) = self.mutation_command(&command) {
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
        let lines = self.mutation_command(&format!("UID MOVE {uid} {}", quote(destination)?))?;
        let destination_uid = lines
            .iter()
            .find(|line| line.text.contains("[COPYUID "))
            .and_then(|line| line.text.split(']').next())
            .and_then(|value| value.split_whitespace().last())
            .and_then(|value| value.parse::<u32>().ok())
            .ok_or_else(|| {
                mutation_outcome(NativeMailErrorDto::protocol("imap_copyuid_missing"), true)
            })?;
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
        let mut fetched = lines.into_iter().filter(|line| {
            line.literal.is_some() && line.text.starts_with("* ") && line.text.contains(" FETCH ")
        });
        let line = fetched
            .next()
            .ok_or_else(|| NativeMailErrorDto::state_invalid("imap_message_absent"))?;
        if fetched.next().is_some() {
            return Err(NativeMailErrorDto::protocol("imap_fetch_duplicate"));
        }
        let fetched_uid = fetch_uid(&line.text)?;
        if fetched_uid != uid {
            return Err(NativeMailErrorDto::state_invalid("imap_uid_mismatch"));
        }
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

    fn search_uids(&mut self) -> Result<Vec<u32>, NativeMailErrorDto> {
        let lines = self.command("UID SEARCH ALL")?;
        let search = lines
            .iter()
            .find(|line| line.text.starts_with("* SEARCH"))
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_search_missing"))?;
        let mut uids = search
            .text
            .split_whitespace()
            .skip(2)
            .map(|value| {
                value
                    .parse::<u32>()
                    .map_err(|_| NativeMailErrorDto::protocol("imap_uid_invalid"))
            })
            .collect::<Result<Vec<_>, _>>()?;
        uids.sort_unstable();
        Ok(uids)
    }

    fn fetch_flag_snapshot(
        &mut self,
        uids: &[u32],
    ) -> Result<BTreeMap<u32, Vec<String>>, NativeMailErrorDto> {
        let mut snapshot = BTreeMap::new();
        for uid in uids.iter().copied() {
            let lines = self.command(&format!("UID FETCH {uid} (UID FLAGS)"))?;
            let line = lines
                .iter()
                .find(|line| line.text.starts_with("* ") && line.text.contains(" FETCH "))
                .ok_or_else(|| NativeMailErrorDto::state_invalid("imap_message_absent"))?;
            let fetched_uid = u32::try_from(number_after(&line.text, "UID")?)
                .map_err(|_| NativeMailErrorDto::protocol("imap_uid_invalid"))?;
            if fetched_uid != uid {
                return Err(NativeMailErrorDto::state_invalid("imap_message_absent"));
            }
            let flags = between(&line.text, "FLAGS (", ")")
                .ok_or_else(|| NativeMailErrorDto::protocol("imap_flags_missing"))?
                .split_whitespace()
                .map(str::to_owned)
                .collect::<Vec<_>>();
            snapshot.insert(uid, canonical_flags(&flags));
        }
        Ok(snapshot)
    }

    fn command(&mut self, command: &str) -> Result<Vec<ResponseLine>, NativeMailErrorDto> {
        self.command_with_outcome(command, false)
    }

    fn mutation_command(&mut self, command: &str) -> Result<Vec<ResponseLine>, NativeMailErrorDto> {
        self.command_with_outcome(command, true)
    }

    fn command_with_outcome(
        &mut self,
        command: &str,
        mutation: bool,
    ) -> Result<Vec<ResponseLine>, NativeMailErrorDto> {
        let tag = format!("B{:04}", self.next_tag);
        self.next_tag = self.next_tag.saturating_add(1);
        write_imap_command(&mut self.writer, &tag, command)
            .map_err(|_| NativeMailErrorDto::unavailable("imap_write_failed"))
            .map_err(|error| mutation_outcome(error, mutation))?;
        let mut lines = Vec::new();
        let mut response_line_count = 0_usize;
        let mut response_text_bytes = 0_usize;
        let mut response_literal_bytes = 0_usize;
        loop {
            let text = self
                .read_text_line()
                .map_err(|error| mutation_outcome(error, mutation))?;
            account_response_text(&mut response_line_count, &mut response_text_bytes, &text)
                .map_err(|error| mutation_outcome(error, mutation))?;
            let literal_length =
                parse_literal_length(&text).map_err(|error| mutation_outcome(error, mutation))?;
            let literal = match literal_length {
                Some(length) => {
                    response_literal_bytes = response_literal_bytes
                        .checked_add(length)
                        .filter(|total| *total <= MAX_IMAP_LITERAL_BYTES)
                        .ok_or_else(|| {
                            mutation_outcome(
                                NativeMailErrorDto::protocol("imap_literal_too_large"),
                                mutation,
                            )
                        })?;
                    let mut value = vec![0_u8; length];
                    self.reader
                        .read_exact(&mut value)
                        .map_err(|_| NativeMailErrorDto::unavailable("imap_literal_failed"))
                        .map_err(|error| mutation_outcome(error, mutation))?;
                    let trailer = self
                        .read_text_line()
                        .map_err(|error| mutation_outcome(error, mutation))?;
                    account_response_text(
                        &mut response_line_count,
                        &mut response_text_bytes,
                        &trailer,
                    )
                    .map_err(|error| mutation_outcome(error, mutation))?;
                    if trailer != ")" {
                        return Err(mutation_outcome(
                            NativeMailErrorDto::protocol("imap_literal_trailer_invalid"),
                            mutation,
                        ));
                    }
                    Some(value)
                }
                None => None,
            };
            if let Some(tagged) = text
                .strip_prefix(&tag)
                .and_then(|rest| rest.strip_prefix(' '))
            {
                return match tagged.split_whitespace().next() {
                    Some("OK") => Ok(lines),
                    Some("NO" | "BAD") => {
                        Err(NativeMailErrorDto::rejected("imap_command_rejected"))
                    }
                    _ => Err(mutation_outcome(
                        NativeMailErrorDto::protocol("imap_tagged_response_invalid"),
                        mutation,
                    )),
                };
            }
            lines.push(ResponseLine { text, literal });
        }
    }

    fn read_text_line(&mut self) -> Result<String, NativeMailErrorDto> {
        read_bounded_text_line(&mut self.reader)
    }
}

fn read_bounded_text_line(reader: &mut impl BufRead) -> Result<String, NativeMailErrorDto> {
    let mut line = Vec::new();
    loop {
        let available = reader
            .fill_buf()
            .map_err(|_| NativeMailErrorDto::unavailable("imap_read_failed"))?;
        if available.is_empty() {
            return Err(NativeMailErrorDto::unavailable("imap_connection_closed"));
        }

        let newline = available.iter().position(|byte| *byte == b'\n');
        let take = newline.map_or(available.len(), |position| position + 1);
        let next_length = line
            .len()
            .checked_add(take)
            .filter(|length| *length <= MAX_IMAP_LINE_BYTES)
            .ok_or_else(|| NativeMailErrorDto::protocol("imap_line_too_large"))?;
        line.reserve(next_length - line.len());
        line.extend_from_slice(&available[..take]);
        reader.consume(take);

        if newline.is_some() {
            break;
        }
    }

    while matches!(line.last(), Some(b'\n' | b'\r')) {
        line.pop();
    }
    String::from_utf8(line).map_err(|_| NativeMailErrorDto::protocol("imap_utf8_invalid"))
}

fn account_response_text(
    line_count: &mut usize,
    text_bytes: &mut usize,
    text: &str,
) -> Result<(), NativeMailErrorDto> {
    *line_count = line_count
        .checked_add(1)
        .filter(|count| *count <= MAX_IMAP_RESPONSE_LINES)
        .ok_or_else(|| NativeMailErrorDto::protocol("imap_response_too_large"))?;
    *text_bytes = text_bytes
        .checked_add(text.len())
        .filter(|bytes| *bytes <= MAX_IMAP_RESPONSE_TEXT_BYTES)
        .ok_or_else(|| NativeMailErrorDto::protocol("imap_response_too_large"))?;
    Ok(())
}

fn ensure_snapshot_stable(
    selected_uid_validity: u32,
    initial_status: &NativeMailboxDto,
    initial_uids: &[u32],
    final_status: &NativeMailboxDto,
    final_uids: &[u32],
    initial_flags: &BTreeMap<u32, Vec<String>>,
    final_flags: &BTreeMap<u32, Vec<String>>,
) -> Result<(), NativeMailErrorDto> {
    let initial_count = u64::try_from(initial_uids.len()).unwrap_or(u64::MAX);
    let final_count = u64::try_from(final_uids.len()).unwrap_or(u64::MAX);
    if initial_status.uid_validity != selected_uid_validity
        || final_status.uid_validity != selected_uid_validity
        || initial_status != final_status
        || initial_status.messages != initial_count
        || final_status.messages != final_count
        || initial_uids != final_uids
        || initial_flags != final_flags
    {
        return Err(NativeMailErrorDto::conflict("imap_snapshot_changed"));
    }
    Ok(())
}

fn canonical_flags(flags: &[String]) -> Vec<String> {
    let mut canonical = flags.to_vec();
    canonical.sort();
    canonical.dedup();
    canonical
}

fn write_imap_command(writer: &mut impl Write, tag: &str, command: &str) -> std::io::Result<()> {
    writer.write_all(tag.as_bytes())?;
    writer.write_all(b" ")?;
    writer.write_all(command.as_bytes())?;
    writer.write_all(b"\r\n")?;
    writer.flush()
}

fn snapshot_fetch_error(error: NativeMailErrorDto) -> NativeMailErrorDto {
    if error.kind == NativeMailErrorKind::StateInvalid {
        NativeMailErrorDto::conflict("imap_snapshot_changed")
    } else {
        error
    }
}

fn mutation_outcome(mut error: NativeMailErrorDto, mutation: bool) -> NativeMailErrorDto {
    if mutation {
        error.retry = NativeMailRetry::Reconcile;
        error.outcome = NativeMailOutcome::Unknown;
    }
    error
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
    let mut output = String::with_capacity(value.len() + 2);
    push_quoted(&mut output, value)?;
    Ok(output)
}

fn login_command(username: &str, password: &str) -> Result<Zeroizing<String>, NativeMailErrorDto> {
    let mut command = Zeroizing::new(String::with_capacity(
        username.len() + password.len() + "LOGIN  ".len() + 4,
    ));
    command.push_str("LOGIN ");
    push_quoted(&mut command, username)?;
    command.push(' ');
    push_quoted(&mut command, password)?;
    Ok(command)
}

fn push_quoted(output: &mut String, value: &str) -> Result<(), NativeMailErrorDto> {
    if value.contains(['\r', '\n', '\0']) {
        return Err(NativeMailErrorDto::protocol("imap_argument_invalid"));
    }
    output.push('"');
    for character in value.chars() {
        if matches!(character, '\\' | '"') {
            output.push('\\');
        }
        output.push(character);
    }
    output.push('"');
    Ok(())
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

fn fetch_uid(value: &str) -> Result<u32, NativeMailErrorDto> {
    let mut tokens = value
        .split(|character: char| character.is_ascii_whitespace() || matches!(character, '(' | ')'))
        .filter(|token| !token.is_empty());
    while let Some(token) = tokens.next() {
        if token == "UID" {
            return tokens
                .next()
                .ok_or_else(|| NativeMailErrorDto::protocol("imap_uid_invalid"))?
                .parse::<u32>()
                .map_err(|_| NativeMailErrorDto::protocol("imap_uid_invalid"));
        }
    }
    Err(NativeMailErrorDto::protocol("imap_uid_missing"))
}

fn bracket_number(value: &str, key: &str) -> Option<u32> {
    let marker = format!("[{key} ");
    value.split_once(&marker)?.1.split(']').next()?.parse().ok()
}

fn between<'a>(value: &'a str, start: &str, end: &str) -> Option<&'a str> {
    let rest = value.split_once(start)?.1;
    Some(rest.split_once(end)?.0)
}

fn parse_literal_length(value: &str) -> Result<Option<usize>, NativeMailErrorDto> {
    if !value.ends_with('}') {
        return Ok(None);
    }
    let Some((_, literal)) = value.rsplit_once('{') else {
        return Ok(None);
    };
    let literal = literal
        .strip_suffix('}')
        .ok_or_else(|| NativeMailErrorDto::protocol("imap_literal_length_invalid"))?;
    if literal.is_empty() || !literal.bytes().all(|byte| byte.is_ascii_digit()) {
        return Err(NativeMailErrorDto::protocol("imap_literal_length_invalid"));
    }
    let parsed = literal
        .parse::<u64>()
        .map_err(|_| NativeMailErrorDto::protocol("imap_literal_length_invalid"))?;
    let length = usize::try_from(parsed)
        .map_err(|_| NativeMailErrorDto::protocol("imap_literal_length_invalid"))?;
    if length > MAX_IMAP_LITERAL_BYTES {
        return Err(NativeMailErrorDto::protocol("imap_literal_too_large"));
    }
    Ok(Some(length))
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
    use super::{
        MAX_IMAP_LINE_BYTES, MAX_IMAP_LITERAL_BYTES, account_response_text, canonical_flags,
        ensure_snapshot_stable, fetch_uid, imap_date_to_rfc3339, login_command, mutation_outcome,
        parse_literal_length, quote, read_bounded_text_line, write_imap_command,
    };
    use crate::net::dto::NativeMailboxDto;
    use crate::net::errors::{
        NativeMailErrorDto, NativeMailErrorKind, NativeMailOutcome, NativeMailRetry,
    };
    use std::{collections::BTreeMap, io::Cursor};

    #[test]
    fn parses_literal_and_date() {
        assert_eq!(parse_literal_length("* 1 FETCH (BODY[] {42}"), Ok(Some(42)));
        assert_eq!(
            imap_date_to_rfc3339("28-Aug-2026 12:01:02 +0000").as_deref(),
            Some("2026-08-28T12:01:02+00:00")
        );
    }

    #[test]
    fn parses_mandatory_fetch_uid_without_using_sequence_number() {
        assert_eq!(fetch_uid("* 17 FETCH (UID 42 FLAGS ())"), Ok(42));
        assert_eq!(
            fetch_uid("* 17 FETCH (FLAGS ())")
                .expect_err("UID is mandatory")
                .code,
            Some("imap_uid_missing")
        );
        assert_eq!(
            fetch_uid("* 17 FETCH (UID 4294967296 FLAGS ())")
                .expect_err("UID must fit u32")
                .code,
            Some("imap_uid_invalid")
        );
    }

    #[test]
    fn literal_parser_rejects_malformed_overflow_and_oversized_lengths() {
        assert_eq!(parse_literal_length("* OK ordinary response"), Ok(None));
        assert_eq!(
            parse_literal_length(&format!("* 1 FETCH (BODY[] {{{MAX_IMAP_LITERAL_BYTES}}}")),
            Ok(Some(MAX_IMAP_LITERAL_BYTES))
        );
        for value in ["{}", "{abc}", "{-1}", "{184467440737095516160}"] {
            let error = parse_literal_length(value).expect_err("invalid literal marker");
            assert_eq!(error.kind, NativeMailErrorKind::Protocol);
            assert_eq!(error.code, Some("imap_literal_length_invalid"));
        }
        assert_eq!(
            parse_literal_length(&format!("{{{}}}", MAX_IMAP_LITERAL_BYTES + 1))
                .expect_err("oversized literal")
                .code,
            Some("imap_literal_too_large")
        );
    }

    #[test]
    fn bounded_line_reader_accepts_exact_limit_and_rejects_one_more_byte() {
        let mut accepted = vec![b'x'; MAX_IMAP_LINE_BYTES - 2];
        accepted.extend_from_slice(b"\r\n");
        let parsed = read_bounded_text_line(&mut Cursor::new(accepted)).expect("boundary line");
        assert_eq!(parsed.len(), MAX_IMAP_LINE_BYTES - 2);

        let mut rejected = vec![b'x'; MAX_IMAP_LINE_BYTES - 1];
        rejected.extend_from_slice(b"\r\n");
        let error =
            read_bounded_text_line(&mut Cursor::new(rejected)).expect_err("line above byte limit");
        assert_eq!(error.code, Some("imap_line_too_large"));
    }

    #[test]
    fn cumulative_response_accounting_is_checked_and_bounded() {
        let mut lines = 0;
        let mut bytes = 0;
        account_response_text(&mut lines, &mut bytes, "OK").expect("small response");
        assert_eq!((lines, bytes), (1, 2));

        let mut lines = super::MAX_IMAP_RESPONSE_LINES;
        let mut bytes = 0;
        assert_eq!(
            account_response_text(&mut lines, &mut bytes, "x")
                .expect_err("line count bound")
                .code,
            Some("imap_response_too_large")
        );

        let mut lines = 0;
        let mut bytes = super::MAX_IMAP_RESPONSE_TEXT_BYTES;
        assert_eq!(
            account_response_text(&mut lines, &mut bytes, "x")
                .expect_err("text byte bound")
                .code,
            Some("imap_response_too_large")
        );
    }

    #[test]
    fn quotes_without_allowing_command_injection() {
        assert_eq!(quote("A \\\" B").expect("valid"), "\"A \\\\\\\" B\"");
        assert!(quote("INBOX\r\nLOGOUT").is_err());
    }

    #[test]
    fn mutation_transport_failure_requires_reconciliation() {
        let error = mutation_outcome(NativeMailErrorDto::unavailable("imap_read_failed"), true);
        assert_eq!(error.retry, NativeMailRetry::Reconcile);
        assert_eq!(error.outcome, NativeMailOutcome::Unknown);
    }

    #[test]
    fn exact_uid_set_and_mailbox_status_guard_authoritative_snapshot() {
        let status = NativeMailboxDto {
            name: "INBOX".to_owned(),
            messages: 3,
            unseen: 3,
            uid_validity: 7,
            uid_next: 4,
        };
        let flags = flag_snapshot(&[(1, &["\\Seen"]), (2, &[]), (3, &[])]);
        assert!(
            ensure_snapshot_stable(7, &status, &[1, 2, 3], &status, &[1, 2, 3], &flags, &flags,)
                .is_ok()
        );
        assert!(
            ensure_snapshot_stable(7, &status, &[1, 2, 3], &status, &[1, 2, 4], &flags, &flags,)
                .is_err()
        );
        assert!(
            ensure_snapshot_stable(7, &status, &[1, 2], &status, &[1, 2], &flags, &flags,).is_err()
        );

        let changed_uid_next = NativeMailboxDto {
            uid_next: 5,
            ..status.clone()
        };
        assert!(
            ensure_snapshot_stable(
                7,
                &status,
                &[1, 2, 3],
                &changed_uid_next,
                &[1, 2, 3],
                &flags,
                &flags,
            )
            .is_err()
        );
        assert!(
            ensure_snapshot_stable(8, &status, &[1, 2, 3], &status, &[1, 2, 3], &flags, &flags,)
                .is_err()
        );
    }

    #[test]
    fn flagged_only_change_invalidates_snapshot() {
        let initial = flag_snapshot(&[(42, &[])]);
        let final_flags = flag_snapshot(&[(42, &["\\Flagged"])]);
        assert_flag_change_is_rejected(&initial, &final_flags);
    }

    #[test]
    fn seen_change_invalidates_snapshot() {
        let initial = flag_snapshot(&[(42, &[])]);
        let final_flags = flag_snapshot(&[(42, &["\\Seen"])]);
        assert_flag_change_is_rejected(&initial, &final_flags);
    }

    #[test]
    fn seen_swap_with_equal_aggregate_unseen_invalidates_snapshot() {
        let initial = flag_snapshot(&[(1, &[]), (2, &["\\Seen"])]);
        let final_flags = flag_snapshot(&[(1, &["\\Seen"]), (2, &[])]);
        assert_flag_change_is_rejected(&initial, &final_flags);
    }

    #[test]
    fn stable_flags_are_accepted() {
        let flags = flag_snapshot(&[(1, &["\\Flagged", "\\Seen"]), (2, &[])]);
        assert_flag_snapshot_is_stable(&flags, &flags);
    }

    #[test]
    fn flag_order_and_duplicates_do_not_create_false_conflicts() {
        let initial = canonical_flags(&[
            "\\Seen".to_owned(),
            "\\Flagged".to_owned(),
            "\\Seen".to_owned(),
        ]);
        let final_flags = canonical_flags(&["\\Flagged".to_owned(), "\\Seen".to_owned()]);
        assert_eq!(initial, final_flags);
    }

    #[test]
    fn login_command_uses_a_zeroizing_owned_buffer() {
        let command = login_command(
            "alice@boxplot.test",
            "BOXPL0T_NATIVE_MAIL_SECRET_CANARY_8291",
        )
        .expect("LOGIN command");
        assert!(command.starts_with("LOGIN "));
        assert!(!command.contains("[REDACTED]"));
    }

    #[test]
    fn imap_framing_writes_exact_borrowed_command_bytes() {
        let mut wire = Vec::new();
        write_imap_command(&mut wire, "B0001", "LOGIN \"alice\" \"secret\"")
            .expect("framing succeeds");
        assert_eq!(wire, b"B0001 LOGIN \"alice\" \"secret\"\r\n");
    }

    fn flag_snapshot(values: &[(u32, &[&str])]) -> BTreeMap<u32, Vec<String>> {
        values
            .iter()
            .map(|(uid, flags)| {
                let flags = flags
                    .iter()
                    .map(|flag| (*flag).to_owned())
                    .collect::<Vec<_>>();
                (*uid, canonical_flags(&flags))
            })
            .collect()
    }

    fn assert_flag_change_is_rejected(
        initial_flags: &BTreeMap<u32, Vec<String>>,
        final_flags: &BTreeMap<u32, Vec<String>>,
    ) {
        let mut status = NativeMailboxDto {
            name: "INBOX".to_owned(),
            messages: u64::try_from(initial_flags.len()).expect("test count fits"),
            unseen: 1,
            uid_validity: 7,
            uid_next: 43,
        };
        let uids = initial_flags.keys().copied().collect::<Vec<_>>();
        if uids == [42]
            && final_flags
                .get(&42)
                .is_some_and(|flags| flags.contains(&"\\Seen".to_owned()))
        {
            status.unseen = 0;
        }
        assert!(
            ensure_snapshot_stable(
                7,
                &status,
                &uids,
                &status,
                &uids,
                initial_flags,
                final_flags,
            )
            .is_err()
        );
    }

    fn assert_flag_snapshot_is_stable(
        initial_flags: &BTreeMap<u32, Vec<String>>,
        final_flags: &BTreeMap<u32, Vec<String>>,
    ) {
        let uids = initial_flags.keys().copied().collect::<Vec<_>>();
        let status = NativeMailboxDto {
            name: "INBOX".to_owned(),
            messages: u64::try_from(uids.len()).expect("test count fits"),
            unseen: 1,
            uid_validity: 7,
            uid_next: 43,
        };
        assert!(
            ensure_snapshot_stable(
                7,
                &status,
                &uids,
                &status,
                &uids,
                initial_flags,
                final_flags,
            )
            .is_ok()
        );
    }
}
