import type {
  JmapAttachment,
  JmapEmail,
  JmapEmailAddressList,
  JmapIdentity,
  JmapMailbox,
  JmapQueryResult,
} from '../../jmap/types'
import {
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteSyncStateFromString,
  remoteThreadIdFromString,
  type RemoteAddressList,
  type RemoteAttachment,
  type RemoteEmail,
  type RemoteIdentity,
  type RemoteMailbox,
} from '../types'
import type { RemoteMailboxQuery } from '../mail'

function addressList(value: JmapEmailAddressList): RemoteAddressList {
  return value === null
    ? null
    : value.map((address) => ({ name: address.name, email: address.email }))
}

export function mapJmapIdentity(value: JmapIdentity): RemoteIdentity {
  return {
    id: remoteIdentityIdFromString(value.id),
    name: value.name,
    email: value.email,
    replyTo: addressList(value.replyTo),
    bcc: addressList(value.bcc),
  }
}

export function mapJmapMailbox(value: JmapMailbox): RemoteMailbox {
  return {
    id: remoteMailboxIdFromString(value.id),
    name: value.name,
    parent:
      value.parent === null ? null : remoteMailboxIdFromString(value.parent),
    role: value.role,
    sortOrder: value.sortOrder,
    totalEmails: value.totalEmails,
    unreadEmails: value.unreadEmails,
    rights: { ...value.rights },
  }
}

export function mapJmapEmail(value: JmapEmail): RemoteEmail {
  return {
    id: remoteEmailIdFromString(value.id),
    blobId: remoteBlobIdFromString(value.blobId),
    threadId: remoteThreadIdFromString(value.threadId),
    sender: addressList(value.sender),
    from: addressList(value.from),
    replyTo: addressList(value.replyTo),
    to: addressList(value.to),
    cc: addressList(value.cc),
    bcc: addressList(value.bcc),
    subject: value.subject,
    sentAt: value.sentAt,
    receivedAt: value.receivedAt,
    size: value.size,
    preview: value.preview,
    hasAttachment: value.hasAttachment,
    keywords: new Set(
      Object.keys(value.keywords).filter((key) => value.keywords[key] === true),
    ),
    mailboxIds: value.mailboxIds.map(remoteMailboxIdFromString),
  }
}

export function mapJmapQuery(value: JmapQueryResult): RemoteMailboxQuery {
  return {
    ids: value.ids.map(remoteEmailIdFromString),
    queryState: remoteSyncStateFromString(value.queryState),
    total: value.total,
    position: value.position,
    canCalculateChanges: value.canCalculateChanges,
  }
}

export function mapJmapAttachment(value: JmapAttachment): RemoteAttachment {
  return {
    blobId: remoteBlobIdFromString(value.blobId),
    partId: value.partId,
    name: value.name,
    mediaType: value.mediaType,
    size: value.size,
    disposition: value.disposition,
    cid: value.cid,
  }
}
