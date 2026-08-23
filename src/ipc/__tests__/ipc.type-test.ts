import { expectTypeOf } from 'vitest'

import type {
  IpcCollectionSyncCommit,
  IpcEmailUpdateLifecycle,
  IpcLocalChangeBatch,
  IpcOwnedCacheRead,
  IpcReadResult,
  IpcScopedEmailId,
  IpcScopedMailboxId,
  IpcSendMutationLifecycle,
  IpcWriteResult,
} from '../dto'

expectTypeOf<{
  accountKey: string
  jmapEmailId: string
}>().toMatchTypeOf<IpcScopedEmailId>()

const emailId: IpcScopedEmailId = { accountKey: 'a', jmapEmailId: 'e' }
// @ts-expect-error Scoped wire IDs retain their category-specific field names.
const wrongScopedId: IpcScopedMailboxId = emailId

const bodyNotCached: IpcOwnedCacheRead<string> = { kind: 'notCached' }
const bodyCachedEmpty: IpcOwnedCacheRead<readonly string[]> = {
  kind: 'cached',
  value: [],
}
expectTypeOf(bodyNotCached).toMatchTypeOf<IpcOwnedCacheRead<string>>()
expectTypeOf(bodyCachedEmpty).toMatchTypeOf<
  IpcOwnedCacheRead<readonly string[]>
>()

const sendConfirmed: IpcSendMutationLifecycle = {
  status: 'confirmed',
  attemptCount: 1,
  confirmation: { emailId },
}
const updateConfirmed: IpcEmailUpdateLifecycle = {
  status: 'confirmed',
  attemptCount: 1,
}
expectTypeOf(sendConfirmed).toMatchTypeOf<IpcSendMutationLifecycle>()
expectTypeOf(updateConfirmed).toMatchTypeOf<IpcEmailUpdateLifecycle>()
// @ts-expect-error Confirmed Send lifecycle requires its confirmation snapshot.
const invalidSendConfirmed: IpcSendMutationLifecycle = {
  status: 'confirmed',
  attemptCount: 1,
}
const invalidUpdateConfirmed: IpcEmailUpdateLifecycle = {
  status: 'confirmed',
  attemptCount: 1,
  // @ts-expect-error Email-update confirmation cannot carry Send confirmation.
  confirmation: { emailId },
}

const delta: IpcCollectionSyncCommit = {
  kind: 'email',
  mode: 'delta',
  expectedCursor: {
    kind: 'matches',
    cursor: { accountKey: 'a', dataType: 'email', state: '' },
  },
  nextCursor: { accountKey: 'a', dataType: 'email', state: 'next' },
  changed: [],
  destroyed: [],
}
expectTypeOf(delta).toMatchTypeOf<IpcCollectionSyncCommit>()

const readError: IpcReadResult<never> = {
  ok: false,
  error: { kind: 'corruptState' },
}
const writeSuccess: IpcWriteResult = { ok: true, value: null }
expectTypeOf(readError).toMatchTypeOf<IpcReadResult<never>>()
expectTypeOf(writeSuccess).toMatchTypeOf<IpcWriteResult>()

const batch: IpcLocalChangeBatch = { hints: [{ kind: 'accounts' }] }
expectTypeOf(batch).toMatchTypeOf<IpcLocalChangeBatch>()
// @ts-expect-error Local change batches are non-empty by contract.
const emptyBatch: IpcLocalChangeBatch = { hints: [] }

void wrongScopedId
void invalidSendConfirmed
void invalidUpdateConfirmed
void emptyBatch
