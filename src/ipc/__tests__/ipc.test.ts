import { describe, expect, it, vi } from 'vitest'

import canonical from '../../../tests/fixtures/ipc-v1.json'
import {
  IPC_READ_COMMANDS,
  IPC_WRITE_COMMANDS,
  LOCAL_STATE_CHANGED_EVENT,
} from '../commands'
import type {
  IpcAccount,
  IpcCollectionSyncCursor,
  IpcEmail,
  IpcEmailBody,
  IpcKeywordMutation,
  IpcLocalChangeBatch,
  IpcMailboxMembershipMutation,
  IpcMailboxView,
  IpcReadResult,
  IpcSendMutation,
  IpcWriteResult,
} from '../dto'
import { IPC_PROTOCOL_VERSION } from '../dto'
import {
  LocalEngineIpcClient,
  type IpcInvoke,
  type IpcListen,
} from '../local-engine-ipc-client'

type IpcV1Fixture = Readonly<{
  protocolVersion: 1
  account: IpcAccount
  email: IpcEmail
  emailBody: IpcEmailBody
  mailboxView: IpcMailboxView
  cursor: IpcCollectionSyncCursor
  sendMutation: IpcSendMutation
  keywordMutation: IpcKeywordMutation
  membershipMutation: IpcMailboxMembershipMutation
  readError: IpcReadResult<never>
  writeConflict: IpcWriteResult
  changeBatch: IpcLocalChangeBatch
}>

function assertIpcV1Fixture(
  value: typeof canonical,
): asserts value is typeof canonical & IpcV1Fixture {
  if (
    value.protocolVersion !== 1 ||
    value.mailboxView.spec.filter.kind !== 'all' ||
    value.mailboxView.spec.sort.property !== 'receivedAt' ||
    !['ascending', 'descending'].includes(
      value.mailboxView.spec.sort.direction,
    ) ||
    !['email', 'mailbox', 'identity'].includes(value.cursor.dataType) ||
    value.sendMutation.kind !== 'send' ||
    value.keywordMutation.kind !== 'keyword' ||
    value.membershipMutation.kind !== 'mailboxMembership' ||
    value.readError.ok !== false ||
    value.readError.error.kind !== 'corruptState' ||
    value.writeConflict.ok !== false ||
    value.writeConflict.error.kind !== 'conflict' ||
    value.changeBatch.hints.length === 0
  ) {
    throw new TypeError(
      'Canonical IPC v1 fixture does not match its DTO contract',
    )
  }
}

describe('IPC v1 contract', () => {
  it('freezes a unique 15/10 command inventory and one event', () => {
    expect(IPC_PROTOCOL_VERSION).toBe(1)
    expect(IPC_READ_COMMANDS).toHaveLength(15)
    expect(IPC_WRITE_COMMANDS).toHaveLength(10)
    expect(new Set([...IPC_READ_COMMANDS, ...IPC_WRITE_COMMANDS]).size).toBe(25)
    expect(LOCAL_STATE_CHANGED_EVENT).toBe('local-state-changed')
  })

  it('keeps canonical cross-language fixtures wire-compatible', () => {
    assertIpcV1Fixture(canonical)
    const account: IpcAccount = canonical.account
    const email: IpcEmail = canonical.email
    const body: IpcEmailBody = canonical.emailBody
    const view: IpcMailboxView = canonical.mailboxView
    const cursor: IpcCollectionSyncCursor = canonical.cursor
    const send: IpcSendMutation = canonical.sendMutation
    const keyword: IpcKeywordMutation = canonical.keywordMutation
    const membership: IpcMailboxMembershipMutation =
      canonical.membershipMutation

    expect({
      account,
      email,
      body,
      view,
      cursor,
      send,
      keyword,
      membership,
    }).toEqual({
      account: canonical.account,
      email: canonical.email,
      body: canonical.emailBody,
      view: canonical.mailboxView,
      cursor: canonical.cursor,
      send: canonical.sendMutation,
      keyword: canonical.keywordMutation,
      membership: canonical.membershipMutation,
    })
    expect(canonical.emailBody).toMatchObject({ text: null, html: '' })
    expect(canonical.email.from).toEqual([])
    expect(canonical.email.sender).toBeNull()
    expect(canonical.cursor.state).toBe('')
  })
})

describe('LocalEngineIpcClient', () => {
  const unusedListen: IpcListen = async () => () => undefined

  it('centralizes the exact command name and named request payload', async () => {
    let response: unknown = {
      ok: true,
      value: { kind: 'absent' },
    }
    const invokeSpy = vi.fn()
    const invoke: IpcInvoke = async <T>(
      command: string,
      args?: Readonly<{ request: object }>,
    ) => {
      invokeSpy(command, args)
      return response as T
    }
    const client = new LocalEngineIpcClient(invoke, unusedListen)
    const request = { emailId: { accountKey: 'a', jmapEmailId: 'e' } }

    await client.readEmail(request)
    expect(invokeSpy).toHaveBeenCalledWith('local_read_email', { request })

    response = { ok: true, value: [] }
    await client.listAccounts()
    expect(invokeSpy).toHaveBeenLastCalledWith('local_list_accounts', {
      request: {},
    })
  })

  it('uses transport failure only for rejected or malformed IPC', async () => {
    const rejectInvoke: IpcInvoke = async () => {
      throw new Error('bridge unavailable')
    }
    const rejected = new LocalEngineIpcClient(rejectInvoke, unusedListen)
    await expect(rejected.listAccounts()).rejects.toMatchObject({
      kind: 'transportFailure',
    })

    const malformedInvoke: IpcInvoke = async <T>() => ({ value: null }) as T
    const malformed = new LocalEngineIpcClient(malformedInvoke, unusedListen)
    await expect(malformed.listAccounts()).rejects.toMatchObject({
      kind: 'transportFailure',
      cause: expect.any(TypeError),
    })
  })

  it('centralizes the typed local-state-changed subscription', async () => {
    let deliver: ((event: { payload: IpcLocalChangeBatch }) => void) | undefined
    const unlisten = vi.fn()
    const listen: IpcListen = vi.fn(async (_event, handler) => {
      deliver = handler
      return unlisten
    })
    const receiver = vi.fn()
    const unusedInvoke: IpcInvoke = async () => {
      throw new Error('invoke is not used by this test')
    }
    const client = new LocalEngineIpcClient(unusedInvoke, listen)

    await expect(client.listenLocalStateChanged(receiver)).resolves.toBe(
      unlisten,
    )
    expect(listen).toHaveBeenCalledWith(
      LOCAL_STATE_CHANGED_EVENT,
      expect.any(Function),
    )
    const batch = { hints: [{ kind: 'accounts' }] } as const
    deliver?.({ payload: batch })
    expect(receiver).toHaveBeenCalledWith(batch)
  })
})
