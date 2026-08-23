import { account, remoteAccountRef } from '../../src/domain/account'
import { emailAddress } from '../../src/domain/address'
import { emailBody } from '../../src/domain/email-body'
import { email, keywordSet } from '../../src/domain/email'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  jmapBlobIdFromString,
  jmapEmailIdFromString,
  jmapIdentityIdFromString,
  jmapMailboxIdFromString,
  jmapThreadIdFromString,
  scopedBlobId,
  scopedEmailId,
  scopedIdentityId,
  scopedMailboxId,
  scopedThreadId,
  serviceKeyFromString,
} from '../../src/domain/ids'
import { identity } from '../../src/domain/identity'
import { emailMailbox, mailbox, mailboxRights } from '../../src/domain/mailbox'
import {
  mailboxView,
  mailboxViewCoverageRange,
  mailboxViewFilterAll,
  mailboxViewItem,
  mailboxViewQueryStateFromString,
  mailboxViewSort,
  mailboxViewSpec,
} from '../../src/domain/mailbox-view'
import {
  collectionSyncCursor,
  collectionSyncStateFromString,
} from '../../src/domain/sync-cursor'
import { createTauriLocalEngineAdapters } from '../../src/adapters/tauri'
import { LocalEngineIpcClient } from '../../src/ipc/local-engine-ipc-client'

declare const __A08_RUN_TOKEN__: string

type A08Result = Readonly<{
  phase: 'initial' | 'reopen'
  accountKey: string
  visibleSubject: string
  visibleBody: string
  invalidationVisible: boolean
  pendingMutationPersisted: boolean
  composerClearedAfterCommit: boolean
  fakeSentEmailCreated: boolean
  localStorageMailKeyPresent: boolean
}>

declare global {
  interface Window {
    __A08_RESULT__?: A08Result | Readonly<{ fatal: string }>
  }
}

const token = __A08_RUN_TOKEN__
const reverseTimestamp = String(
  Number.MAX_SAFE_INTEGER - Number(token),
).padStart(16, '0')
const accountKey = accountKeyFromString(
  `00000000-${reverseTimestamp}-a08-${token}`,
)
const localAccount = account(
  accountKey,
  remoteAccountRef(
    serviceKeyFromString(`a08-service-${token}`),
    jmapAccountIdFromString(`a08-account-${token}`),
  ),
)
const inbox = mailbox({
  id: scopedMailboxId(
    accountKey,
    jmapMailboxIdFromString(`a08-inbox-${token}`),
  ),
  name: `A08 SQLCipher Inbox ${token}`,
  parent: null,
  role: 'inbox',
  sortOrder: 0,
  totalEmails: 2,
  unreadEmails: 1,
  rights: mailboxRights({
    mayReadItems: true,
    mayAddItems: true,
    mayRemoveItems: true,
    maySetSeen: true,
    maySetKeywords: true,
    maySubmit: true,
  }),
})
const sent = mailbox({
  ...inbox,
  id: scopedMailboxId(accountKey, jmapMailboxIdFromString(`a08-sent-${token}`)),
  name: `A08 SQLCipher Sent ${token}`,
  role: 'sent',
  sortOrder: 1,
  totalEmails: 0,
  unreadEmails: 0,
})
const sendingIdentity = identity({
  id: scopedIdentityId(
    accountKey,
    jmapIdentityIdFromString(`a08-identity-${token}`),
  ),
  name: 'A08 Sender',
  email: 'a08-sender@example.test',
  replyTo: null,
  bcc: null,
})

function createEmail(sequence: number) {
  const sender = emailAddress('SQLCipher Sender', 'sqlcipher@example.test')
  return email({
    id: scopedEmailId(
      accountKey,
      jmapEmailIdFromString(`a08-email-${sequence}-${token}`),
    ),
    blobId: scopedBlobId(
      accountKey,
      jmapBlobIdFromString(`a08-blob-${sequence}-${token}`),
    ),
    threadId: scopedThreadId(
      accountKey,
      jmapThreadIdFromString(`a08-thread-${sequence}-${token}`),
    ),
    sender: [sender],
    from: [sender],
    replyTo: null,
    to: [emailAddress(null, 'a08-reader@example.test')],
    cc: [],
    bcc: null,
    subject: `A08 SQLCipher subject ${sequence} ${token}`,
    sentAt: '2026-08-23T12:00:00.000Z',
    receivedAt: `2026-08-23T12:0${sequence}:00.000Z`,
    size: 100 + sequence,
    preview: `A08 preview ${sequence} ${token}`,
    hasAttachment: false,
    keywords: keywordSet(sequence === 1 ? ['$seen'] : []),
  })
}

const firstEmail = createEmail(1)
const secondEmail = createEmail(2)
const firstBodyText = `A08 SQLCipher body ${token}`
const inboxSpec = mailboxViewSpec(
  inbox.id,
  mailboxViewFilterAll(),
  mailboxViewSort('descending'),
)
const sentSpec = mailboxViewSpec(
  sent.id,
  mailboxViewFilterAll(),
  mailboxViewSort('descending'),
)

const adapters = createTauriLocalEngineAdapters(new LocalEngineIpcClient())

function cursor(dataType: 'mailbox' | 'identity' | 'email') {
  return collectionSyncCursor({
    accountKey,
    dataType,
    state: collectionSyncStateFromString(`a08-${dataType}-${token}`),
  })
}

async function requireWrite(
  operation: Promise<
    Readonly<{ ok: boolean; error?: Readonly<{ kind: string }> }>
  >,
  name: string,
): Promise<void> {
  const result = await operation
  if (!result.ok) throw new Error(`${name} failed: ${result.error?.kind}`)
}

async function seedDevelopmentSqlCipher(): Promise<boolean> {
  const existing = await adapters.readRepository.readAccount(accountKey)
  if (!existing.ok)
    throw new Error(`readAccount failed: ${existing.error.kind}`)
  if (existing.value.kind === 'present') return false

  await requireWrite(adapters.syncPort.registerAccount(localAccount), 'account')
  await requireWrite(
    adapters.syncPort.applyCollectionSync({
      kind: 'mailbox',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: cursor('mailbox'),
      snapshot: [inbox, sent],
    }),
    'mailboxes',
  )
  await requireWrite(
    adapters.syncPort.applyCollectionSync({
      kind: 'identity',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: cursor('identity'),
      snapshot: [sendingIdentity],
    }),
    'identities',
  )
  await requireWrite(
    adapters.syncPort.applyCollectionSync({
      kind: 'email',
      mode: 'replace',
      expectedCursor: { kind: 'absent' },
      nextCursor: cursor('email'),
      snapshot: [firstEmail, secondEmail].map((value) => ({
        email: value,
        memberships: [emailMailbox(value.id, inbox.id)],
      })),
    }),
    'emails',
  )
  await requireWrite(
    adapters.syncPort.cacheEmailBody(
      emailBody({ emailId: firstEmail.id, text: firstBodyText, html: null }),
    ),
    'body',
  )
  await requireWrite(
    adapters.syncPort.replaceMailboxView(
      mailboxView({
        spec: inboxSpec,
        queryState: mailboxViewQueryStateFromString(
          `a08-view-initial-${token}`,
        ),
        total: 2,
        coverage: [mailboxViewCoverageRange(0, 1)],
        items: [mailboxViewItem(0, firstEmail.id)],
      }),
    ),
    'inbox view',
  )
  await requireWrite(
    adapters.syncPort.replaceMailboxView(
      mailboxView({
        spec: sentSpec,
        queryState: mailboxViewQueryStateFromString(`a08-sent-empty-${token}`),
        total: 0,
        coverage: [],
        items: [],
      }),
    ),
    'sent view',
  )
  return true
}

function waitForDom(
  predicate: () => boolean,
  description: string,
): Promise<void> {
  if (predicate()) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const observer = new MutationObserver(() => {
      if (!predicate()) return
      observer.disconnect()
      clearTimeout(timeout)
      resolve()
    })
    const timeout = window.setTimeout(() => {
      observer.disconnect()
      reject(new Error(`Timed out waiting for ${description}`))
    }, 20_000)
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
    })
  })
}

function input(selector: string, value: string): void {
  const element = document.querySelector<
    HTMLInputElement | HTMLTextAreaElement
  >(selector)
  if (element === null) throw new Error(`Missing input ${selector}`)
  element.value = value
  element.dispatchEvent(new Event('input', { bubbles: true }))
}

async function pendingSendExists(): Promise<boolean> {
  const result = await adapters.readRepository.listPendingMutations(accountKey)
  if (!result.ok || result.value.kind !== 'present') return false
  return result.value.value.some(
    (value) =>
      value.kind === 'send' && value.intent.subject === `A08 queued ${token}`,
  )
}

async function run(): Promise<void> {
  const created = await seedDevelopmentSqlCipher()
  await import('../../src/main')
  await waitForDom(
    () =>
      document.body.textContent?.includes(firstEmail.subject ?? '') === true,
    'SQLCipher subject in Vue',
  )
  await waitForDom(() => {
    const frame = document.querySelector<HTMLIFrameElement>(
      '.message-viewer__iframe',
    )
    return frame?.srcdoc.includes(firstBodyText) === true
  }, 'SQLCipher body in viewer')

  if (!created && (await pendingSendExists())) {
    const result: A08Result = {
      phase: 'reopen',
      accountKey,
      visibleSubject: firstEmail.subject ?? '',
      visibleBody: firstBodyText,
      invalidationVisible:
        document.body.textContent?.includes(secondEmail.subject ?? '') === true,
      pendingMutationPersisted: true,
      composerClearedAfterCommit: true,
      fakeSentEmailCreated: false,
      localStorageMailKeyPresent:
        localStorage.getItem('boxplot_mail_dev_data_v1') !== null,
    }
    window.__A08_RESULT__ = result
    window.dispatchEvent(new Event('persona-a-integration-complete'))
    return
  }

  await requireWrite(
    adapters.syncPort.replaceMailboxView(
      mailboxView({
        spec: inboxSpec,
        queryState: mailboxViewQueryStateFromString(
          `a08-view-updated-${token}`,
        ),
        total: 2,
        coverage: [mailboxViewCoverageRange(0, 2)],
        items: [
          mailboxViewItem(0, firstEmail.id),
          mailboxViewItem(1, secondEmail.id),
        ],
      }),
    ),
    'P-03 view update',
  )
  await waitForDom(
    () =>
      document.body.textContent?.includes(secondEmail.subject ?? '') === true,
    'P-03 reread in Vue',
  )

  document
    .querySelector<HTMLButtonElement>('.mailbox-sidebar__compose')
    ?.click()
  await waitForDom(
    () => document.querySelector('.composer') !== null,
    'composer open',
  )
  input('#composer-to', 'recipient@example.test')
  input('#composer-subject', `A08 queued ${token}`)
  input('#composer-body', `A08 queued body ${token}`)
  await waitForDom(
    () =>
      document.querySelector<HTMLButtonElement>('.composer__send-btn')
        ?.disabled === false,
    'enabled send action',
  )
  document.querySelector<HTMLButtonElement>('.composer__send-btn')?.click()
  await waitForDom(
    () => document.querySelector('.composer') === null,
    'composer clear after commit',
  )

  const sentView = await adapters.readRepository.readMailboxView(sentSpec)
  const fakeSentEmailCreated =
    !sentView.ok ||
    sentView.value.kind !== 'cached' ||
    sentView.value.value.items.length !== 0
  const result: A08Result = {
    phase: 'initial',
    accountKey,
    visibleSubject: firstEmail.subject ?? '',
    visibleBody: firstBodyText,
    invalidationVisible: true,
    pendingMutationPersisted: await pendingSendExists(),
    composerClearedAfterCommit: document.querySelector('.composer') === null,
    fakeSentEmailCreated,
    localStorageMailKeyPresent:
      localStorage.getItem('boxplot_mail_dev_data_v1') !== null,
  }
  window.__A08_RESULT__ = result
  window.dispatchEvent(new Event('persona-a-integration-complete'))
}

void run().catch((error: unknown) => {
  window.__A08_RESULT__ = {
    fatal:
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error),
  }
  window.dispatchEvent(new Event('persona-a-integration-complete'))
})
