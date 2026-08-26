import {
  remoteAccountIdFromString,
  remoteEmailIdFromString,
  remoteMailboxIdFromString,
  type RemoteAccountId,
  type RemoteEmailId,
  type RemoteMailboxId,
} from '../types'

const account = remoteAccountIdFromString('account')
const email = remoteEmailIdFromString('email')
const mailbox = remoteMailboxIdFromString('mailbox')

// @ts-expect-error raw strings must not become RemoteEmailId implicitly
const rawEmail: RemoteEmailId = 'email'
// @ts-expect-error remote entity ID categories are nominally distinct
const wrongEmail: RemoteEmailId = mailbox
// @ts-expect-error RemoteEmailId is not RemoteMailboxId
const wrongMailbox: RemoteMailboxId = email
// @ts-expect-error RemoteAccountId is distinct from child IDs
const wrongAccount: RemoteAccountId = email

void account
void rawEmail
void wrongEmail
void wrongMailbox
void wrongAccount
