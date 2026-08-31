import type { AccountKey } from '../../domain/ids'
import {
  RemoteBodySourceError,
  type RemoteBodyFetch,
  type RemoteBodySource,
} from '../../remote/body-source'
import { RemoteError } from '../../remote/errors'
import type { RemoteMail } from '../../remote/mail'
import type {
  RemoteKeywordChange,
  RemoteMembershipChange,
} from '../../remote/mail'
import {
  RemoteMutationSourceError,
  type RemoteSubmissionDraft,
  type RemoteMutationSource,
} from '../../remote/mutation-source'
import type { Submission } from '../../remote/submission'
import type { RemoteEmailId } from '../../remote/types'

export type ActiveBodyCapability = Readonly<{
  accountKey: AccountKey
  remoteAccountId: import('../../remote/types').RemoteAccountId
  mail: RemoteMail
  submission: Submission
  generation: number
}>

export class RemoteBodyCapabilityStore
  implements RemoteBodySource, RemoteMutationSource
{
  private readonly active = new Map<AccountKey, ActiveBodyCapability>()
  private readonly generations = new Map<AccountKey, number>()
  private statusAuthority: ((accountKey: AccountKey) => boolean) | null = null
  private disposed = false

  setStatusAuthority(authority: (accountKey: AccountKey) => boolean): void {
    this.statusAuthority = authority
  }

  generation(accountKey: AccountKey): number {
    return this.generations.get(accountKey) ?? 0
  }

  activate(
    capability: Omit<ActiveBodyCapability, 'generation'>,
    expectedGeneration: number,
  ): void {
    if (
      this.disposed ||
      this.generation(capability.accountKey) !== expectedGeneration ||
      this.statusAuthority?.(capability.accountKey) !== true
    ) {
      return
    }
    this.active.set(capability.accountKey, {
      ...capability,
      generation: expectedGeneration,
    })
  }

  invalidate(accountKey: AccountKey): void {
    this.active.delete(accountKey)
    this.generations.set(accountKey, this.generation(accountKey) + 1)
  }

  dispose(): void {
    this.disposed = true
    for (const accountKey of this.active.keys()) this.invalidate(accountKey)
    this.active.clear()
  }

  isConnected(accountKey: AccountKey): boolean {
    const capability = this.active.get(accountKey)
    return capability !== undefined && this.isCurrent(capability)
  }

  async submit(
    accountKey: AccountKey,
    message: RemoteSubmissionDraft,
    idempotencyKey: string,
  ) {
    const capability = this.mutationCapability(accountKey)
    try {
      const result = await capability.submission.submit(
        { ...message, remoteAccountId: capability.remoteAccountId },
        idempotencyKey,
      )
      this.assertMutationCurrent(capability)
      return result
    } catch (error: unknown) {
      this.handleMutationFailure(capability, error)
    }
  }

  async applyKeywordChange(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
    change: RemoteKeywordChange,
  ): Promise<void> {
    const capability = this.mutationCapability(accountKey)
    try {
      await capability.mail.applyKeywordChange(
        capability.remoteAccountId,
        emailId,
        change,
      )
      this.assertMutationCurrent(capability)
    } catch (error: unknown) {
      this.handleMutationFailure(capability, error)
    }
  }

  async applyMembershipChange(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
    change: RemoteMembershipChange,
  ): Promise<void> {
    const capability = this.mutationCapability(accountKey)
    try {
      await capability.mail.applyMembershipChange(
        capability.remoteAccountId,
        emailId,
        change,
      )
      this.assertMutationCurrent(capability)
    } catch (error: unknown) {
      this.handleMutationFailure(capability, error)
    }
  }

  async fetchBody(
    accountKey: AccountKey,
    emailId: RemoteEmailId,
  ): Promise<RemoteBodyFetch> {
    const capability = this.active.get(accountKey)
    if (
      this.disposed ||
      capability === undefined ||
      this.statusAuthority?.(accountKey) !== true
    ) {
      throw new RemoteBodySourceError('notConnected')
    }

    try {
      const body = await capability.mail.fetchBody(
        capability.remoteAccountId,
        emailId,
      )
      this.assertCurrent(capability)
      return {
        body,
        assertCurrent: () => this.assertCurrent(capability),
      }
    } catch (error: unknown) {
      if (error instanceof RemoteBodySourceError) throw error
      this.assertCurrent(capability)
      if (error instanceof RemoteError) {
        if (error.session === 'expire') this.invalidate(accountKey)
        throw new RemoteBodySourceError('remote')
      }
      throw new RemoteBodySourceError('unexpected')
    }
  }

  private assertCurrent(capability: ActiveBodyCapability): void {
    if (!this.isCurrent(capability)) {
      throw new RemoteBodySourceError('cancelled')
    }
  }

  private isCurrent(capability: ActiveBodyCapability): boolean {
    return (
      !this.disposed &&
      this.active.get(capability.accountKey) === capability &&
      this.generation(capability.accountKey) === capability.generation &&
      this.statusAuthority?.(capability.accountKey) === true
    )
  }

  private mutationCapability(accountKey: AccountKey): ActiveBodyCapability {
    const capability = this.active.get(accountKey)
    if (capability === undefined || !this.isCurrent(capability)) {
      throw new RemoteMutationSourceError({ kind: 'notConnected' })
    }
    return capability
  }

  private assertMutationCurrent(capability: ActiveBodyCapability): void {
    if (!this.isCurrent(capability)) {
      throw new RemoteMutationSourceError({ kind: 'cancelled' })
    }
  }

  private handleMutationFailure(
    capability: ActiveBodyCapability,
    error: unknown,
  ): never {
    if (!this.isCurrent(capability)) {
      throw new RemoteMutationSourceError({ kind: 'cancelled' })
    }
    if (error instanceof RemoteError) {
      if (error.session === 'expire') this.invalidate(capability.accountKey)
      throw new RemoteMutationSourceError({ kind: 'remote', error })
    }
    throw new RemoteMutationSourceError({ kind: 'unexpected' })
  }
}
