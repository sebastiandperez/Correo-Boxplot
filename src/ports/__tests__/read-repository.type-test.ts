import { describe, expect, it } from 'vitest'

import type { Account } from '../../domain/account'
import type { AttachmentRef } from '../../domain/attachment-ref'
import type { EmailBody } from '../../domain/email-body'
import type { Email } from '../../domain/email'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  mutationIdFromString,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  type AccountKey,
  type MutationId,
} from '../../domain/ids'
import type { Identity } from '../../domain/identity'
import type { EmailMailbox, Mailbox } from '../../domain/mailbox'
import {
  mailboxViewFilterAll,
  mailboxViewSort,
  mailboxViewSpec,
  type MailboxView,
} from '../../domain/mailbox-view'
import type { PendingMutation } from '../../domain/pending-mutation'
import type { CollectionSyncCursor } from '../../domain/sync-cursor'
import type { PortResult } from '../port-result'
import type {
  LocalEntityRead,
  LocalReadError,
  OwnedCacheRead,
  OwnedOptionalRead,
  OwnedSnapshotRead,
  ReadRepository,
  ReadResult,
} from '../read-repository'

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function ok<T>(value: T): ReadResult<T> {
  return { ok: true, value }
}

const accountKey = accountKeyFromString('account')
const mailboxId = scopedMailboxId(
  accountKey,
  jmapMailboxIdFromString('mailbox'),
)
const emailId = scopedEmailId(accountKey, jmapEmailIdFromString('email'))
const identityId = scopedIdentityId(
  accountKey,
  jmapIdentityIdFromString('identity'),
)
const mutationId = mutationIdFromString('mutation')
const viewSpec = mailboxViewSpec(
  mailboxId,
  mailboxViewFilterAll(),
  mailboxViewSort('descending'),
)

const repository = {
  async readAccount(key) {
    void key
    return ok<LocalEntityRead<Account>>({ kind: 'absent' })
  },
  async listAccounts() {
    return ok<readonly Account[]>([])
  },
  async readMailbox(id) {
    void id
    return ok<LocalEntityRead<Mailbox>>({ kind: 'absent' })
  },
  async listMailboxes(key) {
    void key
    return ok<OwnedSnapshotRead<readonly Mailbox[]>>({
      kind: 'present',
      value: [],
    })
  },
  async readIdentity(id) {
    void id
    return ok<LocalEntityRead<Identity>>({ kind: 'absent' })
  },
  async listIdentities(key) {
    void key
    return ok<OwnedSnapshotRead<readonly Identity[]>>({
      kind: 'present',
      value: [],
    })
  },
  async readEmail(id) {
    void id
    return ok<LocalEntityRead<Email>>({ kind: 'absent' })
  },
  async readEmails(ids) {
    return ok<readonly LocalEntityRead<Email>[]>(
      ids.map(() => ({ kind: 'absent' })),
    )
  },
  async readEmailMemberships(id) {
    void id
    return ok<OwnedSnapshotRead<readonly EmailMailbox[]>>({
      kind: 'present',
      value: [],
    })
  },
  async readEmailBody(id) {
    void id
    return ok<OwnedCacheRead<EmailBody>>({ kind: 'notCached' })
  },
  async readAttachmentRefs(id) {
    void id
    return ok<OwnedCacheRead<readonly AttachmentRef[]>>({ kind: 'notCached' })
  },
  async readMailboxView(spec) {
    void spec
    return ok<OwnedCacheRead<MailboxView>>({ kind: 'notCached' })
  },
  async readCollectionSyncCursor(key, dataType) {
    void key
    void dataType
    return ok<OwnedOptionalRead<CollectionSyncCursor>>({ kind: 'absent' })
  },
  async readPendingMutation(key, id) {
    void key
    void id
    return ok<OwnedOptionalRead<PendingMutation>>({ kind: 'absent' })
  },
  async listPendingMutations(key) {
    void key
    return ok<OwnedSnapshotRead<readonly PendingMutation[]>>({
      kind: 'present',
      value: [],
    })
  },
} satisfies ReadRepository

describe('P-01 result and read-state compile-time invariants', () => {
  it('narrows PortResult by ok', () => {
    function inspect(result: PortResult<number, LocalReadError>): number {
      if (result.ok) {
        // @ts-expect-error Successful PortResult has no error field.
        void result.error
        return result.value
      }

      // @ts-expect-error Failed PortResult has no value field.
      void result.value
      return result.error.kind.length
    }

    const success: PortResult<number, LocalReadError> = { ok: true, value: 1 }
    const failure: PortResult<number, LocalReadError> = {
      ok: false,
      error: { kind: 'unavailable' },
    }

    if (false) {
      // @ts-expect-error PortResult branches are readonly.
      success.value = 2
      // @ts-expect-error Failed PortResult payload is readonly.
      failure.error = { kind: 'unexpected', message: 'details' }
    }

    expect([inspect(success), inspect(failure)]).toHaveLength(2)
  })

  it('closes LocalReadError to three payload-free branches', () => {
    const unavailable: LocalReadError = { kind: 'unavailable' }
    const corruptState: LocalReadError = { kind: 'corruptState' }
    const unexpected: LocalReadError = { kind: 'unexpected' }

    // @ts-expect-error Entity absence is not a LocalReadError.
    const notFound: LocalReadError = { kind: 'not_found' }
    // @ts-expect-error Conflict is not a local read failure category.
    const conflict: LocalReadError = { kind: 'conflict' }
    const diagnosticPayload: LocalReadError = {
      kind: 'unexpected',
      // @ts-expect-error LocalReadError exposes no diagnostic payload.
      message: 'details',
    }

    expect([
      unavailable,
      corruptState,
      unexpected,
      notFound,
      conflict,
      diagnosticPayload,
    ]).toHaveLength(6)
  })

  it('keeps LocalEntityRead branches exact', () => {
    const absent: LocalEntityRead<number> = { kind: 'absent' }
    const present: LocalEntityRead<number> = { kind: 'present', value: 1 }

    const absentWithValue: LocalEntityRead<number> = {
      kind: 'absent',
      // @ts-expect-error Absent local entities have no value.
      value: 1,
    }
    // @ts-expect-error Present local entities require value.
    const presentWithoutValue: LocalEntityRead<number> = { kind: 'present' }
    const presentUndefined: LocalEntityRead<number> = {
      kind: 'present',
      // @ts-expect-error Undefined is not a substitute for semantic absence.
      value: undefined,
    }

    expect([
      absent,
      present,
      absentWithValue,
      presentWithoutValue,
      presentUndefined,
    ]).toHaveLength(5)
  })

  it('keeps owned snapshot and optional branches exact', () => {
    const ownerAbsent: OwnedSnapshotRead<readonly number[]> = {
      kind: 'ownerAbsent',
    }
    const emptySnapshot: OwnedSnapshotRead<readonly number[]> = {
      kind: 'present',
      value: [],
    }
    const ownerAbsentWithValue: OwnedSnapshotRead<readonly number[]> = {
      kind: 'ownerAbsent',
      // @ts-expect-error ownerAbsent does not carry a snapshot value.
      value: [],
    }
    // @ts-expect-error Present snapshots require value.
    const presentWithoutValue: OwnedSnapshotRead<readonly number[]> = {
      kind: 'present',
    }

    const optionalOwnerAbsent: OwnedOptionalRead<number> = {
      kind: 'ownerAbsent',
    }
    const optionalAbsent: OwnedOptionalRead<number> = { kind: 'absent' }
    const optionalPresent: OwnedOptionalRead<number> = {
      kind: 'present',
      value: 1,
    }
    const optionalAbsentWithValue: OwnedOptionalRead<number> = {
      kind: 'absent',
      // @ts-expect-error Only present OwnedOptionalRead carries value.
      value: 1,
    }

    expect([
      ownerAbsent,
      emptySnapshot,
      ownerAbsentWithValue,
      presentWithoutValue,
      optionalOwnerAbsent,
      optionalAbsent,
      optionalPresent,
      optionalAbsentWithValue,
    ]).toHaveLength(8)
  })

  it('distinguishes an uncached owned projection from a cached empty one', () => {
    const ownerAbsent: OwnedCacheRead<readonly AttachmentRef[]> = {
      kind: 'ownerAbsent',
    }
    const notCached: OwnedCacheRead<readonly AttachmentRef[]> = {
      kind: 'notCached',
    }
    const cachedEmpty: OwnedCacheRead<readonly AttachmentRef[]> = {
      kind: 'cached',
      value: [],
    }

    const notCachedWithValue: OwnedCacheRead<readonly AttachmentRef[]> = {
      kind: 'notCached',
      // @ts-expect-error notCached does not carry a cached value.
      value: [],
    }
    // @ts-expect-error cached requires a complete value.
    const cachedWithoutValue: OwnedCacheRead<readonly AttachmentRef[]> = {
      kind: 'cached',
    }

    expect([
      ownerAbsent,
      notCached,
      cachedEmpty,
      notCachedWithValue,
      cachedWithoutValue,
    ]).toHaveLength(5)
  })
})

describe('P-01 ReadRepository compile-time contract', () => {
  it('contains exactly the fifteen frozen capabilities', () => {
    type ExpectedCapability =
      | 'readAccount'
      | 'listAccounts'
      | 'readMailbox'
      | 'listMailboxes'
      | 'readIdentity'
      | 'listIdentities'
      | 'readEmail'
      | 'readEmails'
      | 'readEmailMemberships'
      | 'readEmailBody'
      | 'readAttachmentRefs'
      | 'readMailboxView'
      | 'readCollectionSyncCursor'
      | 'readPendingMutation'
      | 'listPendingMutations'

    type MissingCapability = Exclude<ExpectedCapability, keyof ReadRepository>
    type ExtraCapability = Exclude<keyof ReadRepository, ExpectedCapability>
    type NonPromiseCapability = {
      [Key in keyof ReadRepository]: ReturnType<
        ReadRepository[Key]
      > extends Promise<infer Result>
        ? Result extends ReadResult<infer Value>
          ? Value extends never
            ? Key
            : never
          : Key
        : Key
    }[keyof ReadRepository]

    expectNever<MissingCapability>()
    expectNever<ExtraCapability>()
    expectNever<NonPromiseCapability>()
    expect(Object.keys(repository)).toHaveLength(15)
  })

  it('uses the exact scoped ID categories at the API boundary', () => {
    void repository.readAccount(accountKey)
    void repository.readMailbox(mailboxId)
    void repository.readIdentity(identityId)
    void repository.readEmail(emailId)
    void repository.readPendingMutation(accountKey, mutationId)
    void repository.readMailboxView(viewSpec)

    // @ts-expect-error Raw strings are not AccountKey values.
    void repository.readAccount('account')
    // @ts-expect-error ScopedEmailId is not ScopedMailboxId.
    void repository.readMailbox(emailId)
    // @ts-expect-error ScopedMailboxId is not ScopedIdentityId.
    void repository.readIdentity(mailboxId)
    // @ts-expect-error Raw strings are not MutationId values.
    void repository.readPendingMutation(accountKey, 'mutation')

    // @ts-expect-error AccountKey construction requires its factory.
    const rawAccountKey: AccountKey = 'account'
    // @ts-expect-error MutationId construction requires its factory.
    const rawMutationId: MutationId = 'mutation'

    expect([rawAccountKey, rawMutationId]).toHaveLength(2)
  })

  it('keeps every returned collection readonly', () => {
    function inspectAccounts(result: ReadResult<readonly Account[]>): void {
      if (result.ok) {
        // @ts-expect-error Account collections are readonly.
        result.value.push(result.value[0])
      }
    }

    function inspectMailboxes(
      result: ReadResult<OwnedSnapshotRead<readonly Mailbox[]>>,
    ): void {
      if (result.ok && result.value.kind === 'present') {
        // @ts-expect-error Mailbox snapshots are readonly.
        result.value.value.push(result.value.value[0])
      }
    }

    function inspectIdentities(
      result: ReadResult<OwnedSnapshotRead<readonly Identity[]>>,
    ): void {
      if (result.ok && result.value.kind === 'present') {
        // @ts-expect-error Identity snapshots are readonly.
        result.value.value.push(result.value.value[0])
      }
    }

    function inspectEmails(
      result: ReadResult<readonly LocalEntityRead<Email>[]>,
    ): void {
      if (result.ok) {
        // @ts-expect-error Bulk Email results are readonly.
        result.value.push({ kind: 'absent' })
      }
    }

    function inspectMemberships(
      result: ReadResult<OwnedSnapshotRead<readonly EmailMailbox[]>>,
    ): void {
      if (result.ok && result.value.kind === 'present') {
        // @ts-expect-error Membership snapshots are readonly.
        result.value.value.push(result.value.value[0])
      }
    }

    function inspectAttachments(
      result: ReadResult<OwnedCacheRead<readonly AttachmentRef[]>>,
    ): void {
      if (result.ok && result.value.kind === 'cached') {
        // @ts-expect-error Cached AttachmentRef snapshots are readonly.
        result.value.value.push(result.value.value[0])
      }
    }

    function inspectPending(
      result: ReadResult<OwnedSnapshotRead<readonly PendingMutation[]>>,
    ): void {
      if (result.ok && result.value.kind === 'present') {
        // @ts-expect-error PendingMutation snapshots are readonly.
        result.value.value.push(result.value.value[0])
      }
    }

    expect([
      inspectAccounts,
      inspectMailboxes,
      inspectIdentities,
      inspectEmails,
      inspectMemberships,
      inspectAttachments,
      inspectPending,
    ]).toHaveLength(7)
  })

  it('exposes none of the forbidden capabilities', () => {
    type ForbiddenCapability =
      | 'save'
      | 'update'
      | 'delete'
      | 'insert'
      | 'ensure'
      | 'enqueue'
      | 'apply'
      | 'claim'
      | 'subscribe'
      | 'onChange'
      | 'listen'
      | 'watch'
      | 'querySql'
      | 'execute'
      | 'invoke'
      | 'fetch'

    expectNever<Extract<keyof ReadRepository, ForbiddenCapability>>()
    expect(repository).toBeDefined()
  })
})
