import type { ReadRepository } from '../../ports/read-repository'
import type { CollectionDataType } from '../../domain/sync-cursor'
import type {
  AccountKey,
  MutationId,
  ScopedEmailId,
  ScopedIdentityId,
  ScopedMailboxId,
} from '../../domain/ids'
import type { MailboxViewSpec } from '../../domain/mailbox-view'
import {
  cloneAccount,
  cloneAttachment,
  cloneBody,
  cloneCursor,
  cloneEmail,
  cloneIdentity,
  cloneMailbox,
  cloneMembership,
  cloneMutation,
  cloneView,
  cursorKey,
  emailKey,
  identityKey,
  mailboxKey,
  mutationKey,
  type MemoryState,
  viewKey,
} from './memory-state'

const ok = <T>(value: T) => ({ ok: true as const, value })
const absent = () => ({ kind: 'absent' as const })
const ownerAbsent = () => ({ kind: 'ownerAbsent' as const })

export class MemoryReadRepository implements ReadRepository {
  constructor(private readonly state: MemoryState) {}

  async readAccount(accountKey: AccountKey) {
    const value = this.state.accounts.get(accountKey)
    return ok(
      value === undefined
        ? absent()
        : ({ kind: 'present', value: cloneAccount(value) } as const),
    )
  }

  async listAccounts() {
    return ok([...this.state.accounts.values()].map(cloneAccount))
  }

  async readMailbox(id: ScopedMailboxId) {
    const value = this.state.mailboxes.get(mailboxKey(id))
    return ok(
      value === undefined
        ? absent()
        : ({ kind: 'present', value: cloneMailbox(value) } as const),
    )
  }

  async listMailboxes(accountKey: AccountKey) {
    if (!this.state.accounts.has(accountKey)) return ok(ownerAbsent())
    return ok({
      kind: 'present' as const,
      value: [...this.state.mailboxes.values()]
        .filter((value) => value.id.accountKey === accountKey)
        .map(cloneMailbox),
    })
  }

  async readIdentity(id: ScopedIdentityId) {
    const value = this.state.identities.get(identityKey(id))
    return ok(
      value === undefined
        ? absent()
        : ({ kind: 'present', value: cloneIdentity(value) } as const),
    )
  }

  async listIdentities(accountKey: AccountKey) {
    if (!this.state.accounts.has(accountKey)) return ok(ownerAbsent())
    return ok({
      kind: 'present' as const,
      value: [...this.state.identities.values()]
        .filter((value) => value.id.accountKey === accountKey)
        .map(cloneIdentity),
    })
  }

  async readEmail(id: ScopedEmailId) {
    const value = this.state.emails.get(emailKey(id))
    return ok(
      value === undefined
        ? absent()
        : ({ kind: 'present', value: cloneEmail(value) } as const),
    )
  }

  async readEmails(ids: readonly ScopedEmailId[]) {
    return ok(
      ids.map((id) => {
        const value = this.state.emails.get(emailKey(id))
        return value === undefined
          ? absent()
          : ({ kind: 'present', value: cloneEmail(value) } as const)
      }),
    )
  }

  async readEmailMemberships(id: ScopedEmailId) {
    if (!this.state.emails.has(emailKey(id))) return ok(ownerAbsent())
    return ok({
      kind: 'present' as const,
      value: (this.state.memberships.get(emailKey(id)) ?? []).map(
        cloneMembership,
      ),
    })
  }

  async readEmailBody(id: ScopedEmailId) {
    if (!this.state.emails.has(emailKey(id))) return ok(ownerAbsent())
    const value = this.state.bodies.get(emailKey(id))
    return ok(
      value === undefined
        ? { kind: 'notCached' as const }
        : { kind: 'cached' as const, value: cloneBody(value) },
    )
  }

  async readAttachmentRefs(id: ScopedEmailId) {
    if (!this.state.emails.has(emailKey(id))) return ok(ownerAbsent())
    const value = this.state.attachments.get(emailKey(id))
    return ok(
      value === undefined
        ? { kind: 'notCached' as const }
        : { kind: 'cached' as const, value: value.map(cloneAttachment) },
    )
  }

  async readMailboxView(spec: MailboxViewSpec) {
    if (!this.state.mailboxes.has(mailboxKey(spec.mailboxId)))
      return ok(ownerAbsent())
    const value = this.state.views.get(viewKey(spec))
    return ok(
      value === undefined
        ? { kind: 'notCached' as const }
        : { kind: 'cached' as const, value: cloneView(value) },
    )
  }

  async readCollectionSyncCursor(
    accountKey: AccountKey,
    dataType: CollectionDataType,
  ) {
    if (!this.state.accounts.has(accountKey)) return ok(ownerAbsent())
    const value = this.state.cursors.get(cursorKey(accountKey, dataType))
    return ok(
      value === undefined
        ? absent()
        : { kind: 'present' as const, value: cloneCursor(value) },
    )
  }

  async readPendingMutation(accountKey: AccountKey, mutationId: MutationId) {
    if (!this.state.accounts.has(accountKey)) return ok(ownerAbsent())
    const value = this.state.mutations.get(mutationKey(accountKey, mutationId))
    return ok(
      value === undefined
        ? absent()
        : { kind: 'present' as const, value: cloneMutation(value) },
    )
  }

  async listPendingMutations(accountKey: AccountKey) {
    if (!this.state.accounts.has(accountKey)) return ok(ownerAbsent())
    return ok({
      kind: 'present' as const,
      value: [...this.state.mutations.values()]
        .filter((value) => value.accountKey === accountKey)
        .map(cloneMutation),
    })
  }
}
