import { accountKeyFromString } from '../../domain/ids'
import type {
  RemoteMembershipReconciliationRequest,
  RemoteMutationEvidence,
  RemoteSendReconciliationRequest,
} from '../reconciliation'
import {
  remoteAccountIdFromString,
  remoteEmailIdFromString,
  remoteMailboxIdFromString,
} from '../types'

const remoteAccountId = remoteAccountIdFromString('account')
const localAccountKey = accountKeyFromString('account')
const emailId = remoteEmailIdFromString('email')
const mailboxId = remoteMailboxIdFromString('mailbox')

const applied: RemoteMutationEvidence = { kind: 'applied', emailId }
const inconclusive: RemoteMutationEvidence = { kind: 'inconclusive' }

// @ts-expect-error notApplied is deliberately absent because lookup absence is not proof
const speculativeNotApplied: RemoteMutationEvidence = { kind: 'notApplied' }
// @ts-expect-error applied evidence always carries the concrete remote Email ID
const appliedWithoutId: RemoteMutationEvidence = { kind: 'applied' }
const inconclusiveWithId: RemoteMutationEvidence = {
  kind: 'inconclusive',
  // @ts-expect-error inconclusive evidence cannot smuggle a fabricated Email ID
  emailId,
}
const appliedRawId: RemoteMutationEvidence = {
  kind: 'applied',
  // @ts-expect-error raw strings are not RemoteEmailId evidence
  emailId: 'email',
}

const sendRequest: RemoteSendReconciliationRequest = {
  remoteAccountId,
  idempotencyKey: 'mutation-id',
}
const sendWithReceipt: RemoteSendReconciliationRequest = {
  remoteAccountId,
  idempotencyKey: 'mutation-id',
  // @ts-expect-error receiptId is not durable reconciliation input
  receiptId: 'receipt',
}
const sendWithSubject: RemoteSendReconciliationRequest = {
  remoteAccountId,
  idempotencyKey: 'mutation-id',
  // @ts-expect-error subject heuristics are outside reconciliation evidence
  subject: 'guess',
}
// @ts-expect-error remoteAccountId is required to isolate account evidence
const sendWithoutAccount: RemoteSendReconciliationRequest = {
  idempotencyKey: 'mutation-id',
}

const membershipRequest: RemoteMembershipReconciliationRequest = {
  remoteAccountId,
  idempotencyKey: 'mutation-id',
  emailId,
  change: { add: [mailboxId], remove: [] },
}
const membershipWrongAccount: RemoteMembershipReconciliationRequest = {
  // @ts-expect-error local AccountKey cannot replace the remote account identity
  remoteAccountId: localAccountKey,
  idempotencyKey: 'mutation-id',
  emailId,
  change: { add: [mailboxId], remove: [] },
}

void applied
void inconclusive
void speculativeNotApplied
void appliedWithoutId
void inconclusiveWithId
void appliedRawId
void sendRequest
void sendWithReceipt
void sendWithSubject
void sendWithoutAccount
void membershipRequest
void membershipWrongAccount
