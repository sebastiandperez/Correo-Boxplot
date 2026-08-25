import { describe, it, expect, vi } from 'vitest'
import { createIpcInvokeBridge, unsupportedListen } from '../ipc-bridge'
import { IPC_READ_COMMANDS, IPC_WRITE_COMMANDS } from '../../ipc/commands'
import type { IpcInvokeMessage } from '../protocol'

describe('createIpcInvokeBridge', () => {
  it('posts an IPC_INVOKE for an allowed command and resolves on a matching ok result', async () => {
    const posted: IpcInvokeMessage[] = []
    const { invoke, resolveInvoke } = createIpcInvokeBridge((m) =>
      posted.push(m),
    )

    const promise = invoke('local_read_account', {
      request: { accountKey: 'a1' },
    })

    expect(posted).toHaveLength(1)
    expect(posted[0].payload.command).toBe('local_read_account')
    expect(posted[0].payload.request).toEqual({ accountKey: 'a1' })

    resolveInvoke({
      type: 'IPC_INVOKE_RESULT',
      requestId: posted[0].requestId,
      payload: { ok: true, value: { ok: true, value: { kind: 'absent' } } },
    })

    await expect(promise).resolves.toEqual({
      ok: true,
      value: { kind: 'absent' },
    })
  })

  it('rejects with a typed error when the result is ok: false', async () => {
    const posted: IpcInvokeMessage[] = []
    const { invoke, resolveInvoke } = createIpcInvokeBridge((m) =>
      posted.push(m),
    )

    const promise = invoke('local_list_accounts')

    resolveInvoke({
      type: 'IPC_INVOKE_RESULT',
      requestId: posted[0].requestId,
      payload: {
        ok: false,
        error: { kind: 'unavailable', message: 'no window' },
      },
    })

    await expect(promise).rejects.toThrow('no window')
  })

  it('rejects immediately, without posting anything, for a command outside the allowlist', async () => {
    const post = vi.fn()
    const { invoke } = createIpcInvokeBridge(post)

    await expect(invoke('drop_table_accounts')).rejects.toThrow('allowlist')
    expect(post).not.toHaveBeenCalled()
  })

  it('every real Local Engine command is accepted (allowlist matches src/ipc/commands.ts exactly)', () => {
    const posted: IpcInvokeMessage[] = []
    const { invoke } = createIpcInvokeBridge((m) => posted.push(m))

    for (const command of [...IPC_READ_COMMANDS, ...IPC_WRITE_COMMANDS]) {
      void invoke(command)
    }

    expect(posted.map((m) => m.payload.command)).toEqual([
      ...IPC_READ_COMMANDS,
      ...IPC_WRITE_COMMANDS,
    ])
  })

  it('resolveInvoke on an unknown requestId is a harmless no-op', () => {
    const { resolveInvoke } = createIpcInvokeBridge(() => {})

    expect(() =>
      resolveInvoke({
        type: 'IPC_INVOKE_RESULT',
        requestId: 'w:does-not-exist' as never,
        payload: { ok: true, value: { ok: true, value: null } },
      }),
    ).not.toThrow()
  })

  it('assigns distinct requestIds to concurrent invocations', () => {
    const posted: IpcInvokeMessage[] = []
    const { invoke } = createIpcInvokeBridge((m) => posted.push(m))

    void invoke('local_read_account')
    void invoke('local_read_account')

    expect(posted[0].requestId).not.toBe(posted[1].requestId)
  })
})

describe('unsupportedListen', () => {
  it('always rejects — LocalChangeSource has no consumer inside the Worker', async () => {
    await expect(
      unsupportedListen('local-state-changed', () => {}),
    ).rejects.toThrow(/not supported/)
  })
})
