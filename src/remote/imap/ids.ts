import { RemoteError } from '../errors'
import {
  remoteAccountIdFromString,
  remoteBlobIdFromString,
  remoteEmailIdFromString,
  remoteIdentityIdFromString,
  remoteMailboxIdFromString,
  remoteThreadIdFromString,
  type RemoteAccountId,
  type RemoteBlobId,
  type RemoteEmailId,
  type RemoteIdentityId,
  type RemoteMailboxId,
  type RemoteThreadId,
} from '../types'

export type DecodedImapEmailId = Readonly<{
  mailbox: string
  uidValidity: number
  uid: number
}>

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

function encode(value: string): string {
  const binary = Array.from(encoder.encode(value), (byte) =>
    String.fromCharCode(byte),
  ).join('')
  return btoa(binary)
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replace(/=+$/, '')
}

function decode(value: string): string {
  try {
    const padded = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(padded + '='.repeat((4 - (padded.length % 4)) % 4))
    return decoder.decode(
      Uint8Array.from(binary, (character) => character.charCodeAt(0)),
    )
  } catch (cause: unknown) {
    throw invalidId(cause)
  }
}

function invalidId(cause?: unknown): RemoteError {
  return new RemoteError('Malformed IMAP remote identity', {
    kind: 'stateInvalid',
    retry: 'never',
    session: 'keep',
    outcome: 'knownNotApplied',
    cause,
  })
}

export function imapAccountId(username: string): RemoteAccountId {
  return remoteAccountIdFromString(`imap-account-v1:${encode(username)}`)
}
export function decodeImapAccountId(value: RemoteAccountId): string {
  const match = /^imap-account-v1:([A-Za-z0-9_-]+)$/.exec(value)
  if (match?.[1] === undefined) throw invalidId()
  return decode(match[1])
}
export function imapIdentityId(username: string): RemoteIdentityId {
  return remoteIdentityIdFromString(`imap-identity-v1:${encode(username)}`)
}
export function decodeImapIdentityId(value: RemoteIdentityId): string {
  const match = /^imap-identity-v1:([A-Za-z0-9_-]+)$/.exec(value)
  if (match?.[1] === undefined) throw invalidId()
  return decode(match[1])
}
export function imapMailboxId(mailbox: string): RemoteMailboxId {
  return remoteMailboxIdFromString(`imap-mailbox-v1:${encode(mailbox)}`)
}
export function decodeImapMailboxId(value: RemoteMailboxId): string {
  const match = /^imap-mailbox-v1:([A-Za-z0-9_-]+)$/.exec(value)
  if (match?.[1] === undefined) throw invalidId()
  return decode(match[1])
}
export function imapEmailId(value: DecodedImapEmailId): RemoteEmailId {
  assertPositiveInteger(value.uidValidity)
  assertPositiveInteger(value.uid)
  return remoteEmailIdFromString(
    `imap-email-v1:${encode(value.mailbox)}:${value.uidValidity}:${value.uid}`,
  )
}
export function decodeImapEmailId(value: RemoteEmailId): DecodedImapEmailId {
  const match = /^imap-email-v1:([A-Za-z0-9_-]+):(\d+):(\d+)$/.exec(value)
  if (
    match?.[1] === undefined ||
    match[2] === undefined ||
    match[3] === undefined
  )
    throw invalidId()
  const uidValidity = Number(match[2])
  const uid = Number(match[3])
  assertPositiveInteger(uidValidity)
  assertPositiveInteger(uid)
  return { mailbox: decode(match[1]), uidValidity, uid }
}
export function imapThreadId(emailId: RemoteEmailId): RemoteThreadId {
  return remoteThreadIdFromString(`imap-thread-v1:${encode(emailId)}`)
}
export function imapBlobId(emailId: RemoteEmailId): RemoteBlobId {
  return remoteBlobIdFromString(`imap-blob-v1:${encode(emailId)}`)
}
export function imapAttachmentBlobId(
  emailId: RemoteEmailId,
  partId: string,
): RemoteBlobId {
  return remoteBlobIdFromString(
    `imap-attachment-v1:${encode(emailId)}:${encode(partId)}`,
  )
}

function assertPositiveInteger(value: number): void {
  if (!Number.isSafeInteger(value) || value <= 0) throw invalidId()
}
