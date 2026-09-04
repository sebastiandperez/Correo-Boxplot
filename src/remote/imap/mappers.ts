import type {
  NativeAddressDto,
  NativeAttachmentDto,
  NativeMailboxDto,
  NativeMessageMetadataDto,
} from '../native/ipc'
import type {
  RemoteAddressList,
  RemoteAttachment,
  RemoteEmail,
  RemoteMailbox,
} from '../types'
import {
  imapAttachmentBlobId,
  imapBlobId,
  imapEmailId,
  imapMailboxId,
  imapThreadId,
} from './ids'

export function mapNativeMailbox(
  value: NativeMailboxDto,
  index: number,
): RemoteMailbox {
  const role = roleFor(value.specialUse, value.name)
  return {
    id: imapMailboxId(value.name),
    name: value.name,
    parent: null,
    role,
    sortOrder:
      role === 'inbox'
        ? 0
        : role === 'sent'
          ? 1
          : role === 'trash'
            ? 2
            : index + 3,
    totalEmails: value.messages,
    unreadEmails: value.unseen,
    rights: {
      mayReadItems: true,
      mayAddItems: false,
      mayRemoveItems: true,
      maySetSeen: true,
      maySetKeywords: true,
      maySubmit: true,
    },
  }
}

export function mapNativeEmail(value: NativeMessageMetadataDto): RemoteEmail {
  const id = imapEmailId(value)
  return {
    id,
    blobId: imapBlobId(id),
    threadId: imapThreadId(id),
    sender: addresses(value.sender),
    from: addresses(value.from),
    replyTo: addresses(value.replyTo),
    to: addresses(value.to),
    cc: addresses(value.cc),
    bcc: addresses(value.bcc),
    subject: value.subject,
    sentAt: value.sentAt,
    receivedAt: value.internalDate,
    size: value.size,
    preview: value.preview,
    hasAttachment: value.hasAttachment,
    keywords: new Set(
      value.flags.flatMap((flag) =>
        flag.toLowerCase() === '\\seen'
          ? ['$seen']
          : flag.toLowerCase() === '\\flagged'
            ? ['$flagged']
            : [],
      ),
    ),
    mailboxIds: [imapMailboxId(value.mailbox)],
  }
}

export function mapNativeAttachment(
  emailId: ReturnType<typeof imapEmailId>,
  value: NativeAttachmentDto,
): RemoteAttachment {
  return {
    blobId: imapAttachmentBlobId(emailId, value.partId),
    partId: value.partId,
    name: value.name,
    mediaType: value.mediaType,
    size: value.size,
    disposition: value.disposition,
    cid: value.cid,
  }
}

function addresses(
  values: readonly NativeAddressDto[] | null,
): RemoteAddressList {
  return (
    values?.map((value) => ({ name: value.name, email: value.email })) ?? null
  )
}

export function roleFor(
  specialUse: string | null | undefined,
  name: string,
): string | null {
  switch (specialUse?.toLowerCase()) {
    case '\\inbox':
      return 'inbox'
    case '\\sent':
      return 'sent'
    case '\\trash':
      return 'trash'
  }
  switch (name.toLowerCase()) {
    case 'inbox':
      return 'inbox'
    case 'sent':
      return 'sent'
    case 'trash':
      return 'trash'
    default:
      return null
  }
}
