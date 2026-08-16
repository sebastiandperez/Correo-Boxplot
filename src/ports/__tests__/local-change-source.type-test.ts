import { describe, expect, it } from 'vitest'

import type {
  AccountKey,
  ScopedEmailId,
  ScopedMailboxId,
} from '../../domain/ids'
import type { MailboxViewSpec } from '../../domain/mailbox-view'
import type { CollectionDataType } from '../../domain/sync-cursor'
import type {
  AccountsChangedHint,
  AttachmentRefsChangedHint,
  EmailBodyChangedHint,
  EmailMembershipsChangedHint,
  EmailsChangedHint,
  IdentitiesChangedHint,
  LocalChangeBatch,
  LocalChangeHint,
  LocalChangeListener,
  LocalChangeSource,
  LocalChangeSourceError,
  LocalChangeSourceResult,
  LocalChangeSubscription,
  MailboxesChangedHint,
  MailboxViewChangedHint,
  PendingMutationsChangedHint,
  SyncCursorChangedHint,
} from '../local-change-source'

function expectNever<Value extends never>(value?: Value): void {
  void value
}

function subscriptionSuccess(): LocalChangeSourceResult<LocalChangeSubscription> {
  return {
    ok: true,
    value: {
      unsubscribe() {},
    },
  }
}

const source = {
  async subscribe(listener) {
    void listener
    return subscriptionSuccess()
  },
} satisfies LocalChangeSource

describe('P-03 errors and hint union', () => {
  it('closes LocalChangeSourceError to two payload-free categories', () => {
    const unavailable: LocalChangeSourceError = { kind: 'unavailable' }
    const unexpected: LocalChangeSourceError = { kind: 'unexpected' }

    // @ts-expect-error corruptState is not a change-source error category.
    const corruptState: LocalChangeSourceError = { kind: 'corruptState' }
    // @ts-expect-error conflict is not a change-source error category.
    const conflict: LocalChangeSourceError = { kind: 'conflict' }
    // @ts-expect-error notFound is not a change-source error category.
    const notFound: LocalChangeSourceError = { kind: 'notFound' }
    const payload: LocalChangeSourceError = {
      kind: 'unexpected',
      // @ts-expect-error Change-source errors expose no diagnostic payload.
      message: 'details',
    }

    expect([
      unavailable,
      unexpected,
      corruptState,
      conflict,
      notFound,
      payload,
    ]).toHaveLength(6)
  })

  it('contains exactly ten variants and narrows exhaustively', () => {
    type ExpectedKind =
      | 'accounts'
      | 'mailboxes'
      | 'identities'
      | 'emails'
      | 'emailMemberships'
      | 'emailBody'
      | 'attachmentRefs'
      | 'mailboxView'
      | 'syncCursor'
      | 'pendingMutations'
    type ActualKind = LocalChangeHint['kind']

    expectNever<Exclude<ExpectedKind, ActualKind>>()
    expectNever<Exclude<ActualKind, ExpectedKind>>()

    function inspect(hint: LocalChangeHint): string {
      switch (hint.kind) {
        case 'accounts':
          return hint.kind
        case 'mailboxes':
        case 'identities':
        case 'emails':
        case 'emailMemberships':
        case 'pendingMutations':
          return hint.accountKey
        case 'emailBody':
        case 'attachmentRefs':
          return hint.emailId.jmapId
        case 'mailboxView':
          return hint.spec.mailboxId.jmapId
        case 'syncCursor':
          return `${hint.accountKey}:${hint.dataType}`
      }
    }

    expect(inspect).toBeDefined()
  })
})

describe('P-03 hint keys and payload boundary', () => {
  it('requires the exact semantic Domain key for each hint family', () => {
    function inspect(
      accountKey: AccountKey,
      emailId: ScopedEmailId,
      mailboxId: ScopedMailboxId,
      spec: MailboxViewSpec,
      dataType: CollectionDataType,
    ): void {
      const accounts: AccountsChangedHint = { kind: 'accounts' }
      const mailboxes: MailboxesChangedHint = { kind: 'mailboxes', accountKey }
      const identities: IdentitiesChangedHint = {
        kind: 'identities',
        accountKey,
      }
      const emails: EmailsChangedHint = { kind: 'emails', accountKey }
      const memberships: EmailMembershipsChangedHint = {
        kind: 'emailMemberships',
        accountKey,
      }
      const body: EmailBodyChangedHint = { kind: 'emailBody', emailId }
      const refs: AttachmentRefsChangedHint = {
        kind: 'attachmentRefs',
        emailId,
      }
      const view: MailboxViewChangedHint = { kind: 'mailboxView', spec }
      const cursor: SyncCursorChangedHint = {
        kind: 'syncCursor',
        accountKey,
        dataType,
      }
      const pending: PendingMutationsChangedHint = {
        kind: 'pendingMutations',
        accountKey,
      }

      const rawAccount: EmailsChangedHint = {
        kind: 'emails',
        // @ts-expect-error Raw strings are not AccountKey values.
        accountKey: 'account',
      }
      const wrongOwner: EmailBodyChangedHint = {
        kind: 'emailBody',
        // @ts-expect-error ScopedMailboxId is not ScopedEmailId.
        emailId: mailboxId,
      }

      expect([
        accounts,
        mailboxes,
        identities,
        emails,
        memberships,
        body,
        refs,
        view,
        cursor,
        pending,
        rawAccount,
        wrongOwner,
      ]).toHaveLength(12)
    }

    expect(inspect).toBeDefined()
  })

  it('rejects state, causality, timing and revision payloads', () => {
    function inspect(accountKey: AccountKey, emailId: ScopedEmailId): void {
      const emailPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints do not transport Email state.
        email: {},
      }
      const mailboxPayload: MailboxesChangedHint = {
        kind: 'mailboxes',
        accountKey,
        // @ts-expect-error Hints do not transport Mailbox state.
        mailbox: {},
      }
      const bodyPayload: EmailBodyChangedHint = {
        kind: 'emailBody',
        emailId,
        // @ts-expect-error Hints do not transport body state.
        body: {},
      }
      const refsPayload: AttachmentRefsChangedHint = {
        kind: 'attachmentRefs',
        emailId,
        // @ts-expect-error Hints do not transport AttachmentRef snapshots.
        refs: [],
      }
      const mutationPayload: PendingMutationsChangedHint = {
        kind: 'pendingMutations',
        accountKey,
        // @ts-expect-error Hints do not transport PendingMutation state.
        mutation: {},
      }
      const genericPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no generic value payload.
        value: {},
      }
      const historyPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no oldValue/newValue history.
        oldValue: {},
        newValue: {},
      }
      const causalityPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no origin metadata.
        origin: 'remote',
      }
      const timingPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no timestamp.
        timestamp: 'now',
      }
      const revisionPayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no durable revision.
        revision: 1,
      }
      const sequencePayload: EmailsChangedHint = {
        kind: 'emails',
        accountKey,
        // @ts-expect-error Hints expose no delivery sequence.
        sequence: 1,
      }

      expect([
        emailPayload,
        mailboxPayload,
        bodyPayload,
        refsPayload,
        mutationPayload,
        genericPayload,
        historyPayload,
        causalityPayload,
        timingPayload,
        revisionPayload,
        sequencePayload,
      ]).toHaveLength(11)
    }

    expect(inspect).toBeDefined()
  })
})

describe('P-03 batch, listener and subscription contract', () => {
  it('requires a non-empty readonly batch', () => {
    function inspect(accountKey: AccountKey): void {
      const accountHint: AccountsChangedHint = { kind: 'accounts' }
      const emailHint: EmailsChangedHint = { kind: 'emails', accountKey }
      const one: LocalChangeBatch = { hints: [accountHint] }
      const several: LocalChangeBatch = { hints: [accountHint, emailHint] }
      // @ts-expect-error LocalChangeBatch must contain at least one hint.
      const empty: LocalChangeBatch = { hints: [] }

      // @ts-expect-error Batch hint tuples are readonly.
      one.hints.push(emailHint)
      // @ts-expect-error Hint fields are readonly.
      emailHint.accountKey = accountKey

      function inspectScopedReadonly(
        bodyHint: EmailBodyChangedHint,
        viewHint: MailboxViewChangedHint,
        spec: MailboxViewSpec,
      ): void {
        // @ts-expect-error Scoped hint keys are readonly.
        bodyHint.emailId = bodyHint.emailId
        // @ts-expect-error Semantic View specs are readonly hint keys.
        viewHint.spec = spec
      }

      expect([one, several, empty, inspectScopedReadonly]).toHaveLength(4)
    }

    expect(inspect).toBeDefined()
  })

  it('defines a synchronous void listener', () => {
    type ListenerResult = ReturnType<LocalChangeListener>
    type NotExactlyVoid = [ListenerResult] extends [void]
      ? [void] extends [ListenerResult]
        ? never
        : 'not-void'
      : 'not-void'

    expectNever<NotExactlyVoid>()

    const listener: LocalChangeListener = (batch) => {
      void batch
    }

    expect(listener).toBeDefined()
  })

  it('keeps the subscription shape exact and readonly', () => {
    type MissingCapability = Exclude<
      'unsubscribe',
      keyof LocalChangeSubscription
    >
    type ExtraCapability = Exclude<keyof LocalChangeSubscription, 'unsubscribe'>

    expectNever<MissingCapability>()
    expectNever<ExtraCapability>()

    const subscription: LocalChangeSubscription = { unsubscribe() {} }
    // @ts-expect-error Subscription capabilities are readonly.
    subscription.unsubscribe = () => {}
    const extraCapability: LocalChangeSubscription = {
      unsubscribe() {},
      // @ts-expect-error Subscription has no pause capability.
      pause() {},
    }

    expect([subscription, extraCapability]).toHaveLength(2)
  })
})

describe('P-03 LocalChangeSource compile-time contract', () => {
  it('contains exactly one asynchronous subscribe capability', () => {
    type MissingCapability = Exclude<'subscribe', keyof LocalChangeSource>
    type ExtraCapability = Exclude<keyof LocalChangeSource, 'subscribe'>
    type SubscribeResult = ReturnType<LocalChangeSource['subscribe']>
    type WrongResult =
      SubscribeResult extends Promise<
        LocalChangeSourceResult<LocalChangeSubscription>
      >
        ? never
        : 'wrong-result'

    expectNever<MissingCapability>()
    expectNever<ExtraCapability>()
    expectNever<WrongResult>()
    expect(Object.keys(source)).toEqual(['subscribe'])
  })

  it('exposes no publishing, replay, reading or filtered subscriptions', () => {
    type ForbiddenCapability =
      | 'emit'
      | 'publish'
      | 'replay'
      | 'acknowledge'
      | 'read'
      | 'getSnapshot'
      | 'subscribeToAccount'
      | 'subscribeToEmail'
      | 'onChange'
      | 'listen'
      | 'watch'

    expectNever<Extract<keyof LocalChangeSource, ForbiddenCapability>>()
    expect(source).toBeDefined()
  })
})
