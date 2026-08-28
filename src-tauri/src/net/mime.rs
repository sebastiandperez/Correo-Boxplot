use mail_parser::{Address, Message, MessageParser, MimeHeaders};

use super::{
    dto::{NativeAddressDto, NativeAttachmentDto, NativeBodyDto, NativeMessageMetadataDto},
    errors::NativeMailErrorDto,
};

pub struct ParsedMessage {
    message: Message<'static>,
}

impl ParsedMessage {
    pub fn metadata(
        &self,
        mailbox: String,
        uid_validity: u32,
        uid: u32,
        flags: Vec<String>,
        internal_date: String,
        size: u64,
    ) -> NativeMessageMetadataDto {
        let text = self.plain_text();
        NativeMessageMetadataDto {
            mailbox,
            uid_validity,
            uid,
            flags,
            internal_date,
            size,
            sender: addresses(self.message.sender()),
            from: addresses(self.message.from()),
            reply_to: addresses(self.message.reply_to()),
            to: addresses(self.message.to()),
            cc: addresses(self.message.cc()),
            bcc: addresses(self.message.bcc()),
            subject: self.message.subject().map(str::to_owned),
            sent_at: self.message.date().map(|date| date.to_rfc3339()),
            preview: preview(text.as_deref()),
            has_attachment: self.message.attachment_count() > 0,
        }
    }

    pub fn body(&self) -> NativeBodyDto {
        if self.message.content_type().is_some_and(|content_type| {
            content_type.ctype().eq_ignore_ascii_case("application")
                && content_type
                    .subtype()
                    .is_some_and(|value| value.eq_ignore_ascii_case("vnd.boxplot.e2ee+json"))
        }) {
            return NativeBodyDto::BoxplotE2ee {
                payload: self
                    .message
                    .parts
                    .first()
                    .and_then(|part| part.text_contents())
                    .unwrap_or_default()
                    .to_owned(),
            };
        }
        NativeBodyDto::Plain {
            text: self.plain_text(),
            html: self.html_text(),
        }
    }

    pub fn attachments(&self) -> Vec<NativeAttachmentDto> {
        self.message
            .attachments
            .iter()
            .filter_map(|part_id| {
                let part = self.message.part(*part_id)?;
                let content_type = part.content_type();
                let disposition = part.content_disposition();
                Some(NativeAttachmentDto {
                    part_id: part_id.to_string(),
                    name: disposition
                        .and_then(|value| value.attribute("filename"))
                        .or_else(|| content_type.and_then(|value| value.attribute("name")))
                        .map(str::to_owned),
                    media_type: content_type
                        .map(|value| match value.subtype() {
                            Some(subtype) => format!("{}/{subtype}", value.ctype()),
                            None => value.ctype().to_owned(),
                        })
                        .unwrap_or_else(|| "application/octet-stream".to_owned()),
                    size: u64::try_from(part.len()).unwrap_or(u64::MAX),
                    disposition: disposition.map(|value| value.ctype().to_owned()),
                    cid: part.content_id().map(str::to_owned),
                })
            })
            .collect()
    }

    fn plain_text(&self) -> Option<String> {
        self.message
            .text_part(0)
            .filter(|part| !part.is_text_html())
            .and_then(|part| part.text_contents())
            .map(str::to_owned)
    }

    fn html_text(&self) -> Option<String> {
        self.message
            .html_part(0)
            .filter(|part| part.is_text_html())
            .and_then(|part| part.text_contents())
            .map(str::to_owned)
    }
}

pub fn parse_message(raw: &[u8]) -> Result<ParsedMessage, NativeMailErrorDto> {
    let message = MessageParser::default()
        .parse(raw)
        .ok_or(NativeMailErrorDto {
            kind: super::errors::NativeMailErrorKind::MalformedRemoteData,
            retry: super::errors::NativeMailRetry::Never,
            session: super::errors::NativeMailSessionDisposition::Keep,
            outcome: super::errors::NativeMailOutcome::KnownNotApplied,
            code: Some("malformed_message"),
        })?
        .into_owned();
    Ok(ParsedMessage { message })
}

fn addresses(address: Option<&Address<'_>>) -> Option<Vec<NativeAddressDto>> {
    address.map(|value| {
        value
            .iter()
            .filter_map(|item| {
                Some(NativeAddressDto {
                    name: item.name().map(str::to_owned),
                    email: item.address()?.to_owned(),
                })
            })
            .collect()
    })
}

fn preview(text: Option<&str>) -> String {
    text.map(|value| {
        value
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(200)
            .collect()
    })
    .unwrap_or_default()
}

#[cfg(test)]
mod tests {
    use super::parse_message;
    use crate::net::dto::NativeBodyDto;

    #[test]
    fn parses_unicode_plain_and_html_without_sanitizing() {
        let raw = concat!(
            "From: =?UTF-8?B?QWzDrWNl?= <alice@boxplot.test>\r\n",
            "To: Bob <bob@boxplot.test>\r\n",
            "Subject: =?UTF-8?B?SG9sYSDwn5GL?=\r\n",
            "Date: Fri, 28 Aug 2026 12:00:00 +0000\r\n",
            "Content-Type: text/html; charset=utf-8\r\n\r\n",
            "<script>alert(1)</script>"
        );
        let parsed = parse_message(raw.as_bytes()).expect("valid MIME");
        assert_eq!(
            parsed.body(),
            NativeBodyDto::Plain {
                text: None,
                html: Some("<script>alert(1)</script>".to_owned())
            }
        );
    }

    #[test]
    fn extracts_attachment_metadata() {
        let raw = concat!(
            "Content-Type: multipart/mixed; boundary=x\r\n\r\n",
            "--x\r\nContent-Type: text/plain\r\n\r\nhello\r\n",
            "--x\r\nContent-Type: application/pdf; name=contract.pdf\r\n",
            "Content-Disposition: attachment; filename=contract.pdf\r\n",
            "Content-ID: logo@example\r\n\r\nPDF\r\n--x--\r\n"
        );
        let attachments = parse_message(raw.as_bytes())
            .expect("valid MIME")
            .attachments();
        assert_eq!(attachments.len(), 1);
        assert_eq!(attachments[0].name.as_deref(), Some("contract.pdf"));
        assert_eq!(attachments[0].media_type, "application/pdf");
    }
}
