import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const sourceRoot = resolve(import.meta.dirname, '../../..')

function source(relativePath: string): string {
  return readFileSync(resolve(sourceRoot, relativePath), 'utf8')
}

const coreFiles = [
  'app/remote/types.ts',
  'app/remote/errors.ts',
  'app/remote/session-registry.ts',
  'app/remote/remote-application.ts',
]

describe('REMOTE-APPLICATION architecture gates', () => {
  it.each(coreFiles)(
    '%s has no concrete protocol, UI, or transport import',
    (file) => {
      const content = source(file)
      expect(content).not.toMatch(
        /from ['"][^'"]*(?:remote\/(?:jmap|imap|smtp|native)|jmap)[^'"]*['"]/,
      )
      expect(content).not.toMatch(/from ['"](?:vue|pinia|@tauri-apps\/api)['"]/)
      expect(content).not.toContain('JmapWorkerClient')
      expect(content).not.toContain('TauriNativeMailIpc')
      expect(content).not.toContain('ImapSmtpRemoteConnection')
      expect(content).not.toContain('invoke(')
      expect(content).not.toContain('fetch(')
      expect(content).not.toContain('WebSocket')
    },
  )

  it('keeps provider selection outside the protocol-neutral core', () => {
    const core = source('app/remote/remote-application.ts')
    expect(core).not.toMatch(/\.provider\b/)
    expect(core).not.toMatch(/['"](?:jmap|imapSmtp)['"]/)

    const composition = source('app/remote/tauri-remote-composition.ts')
    expect(composition).toContain('createRemoteConnection')
    expect(composition).toContain('ImapSmtpRemoteConnection')
    expect(composition).toContain('TauriNativeMailIpc')
  })

  it('does not add send, body, outbox, or reconnect to the public API', () => {
    const api = source('app/remote/types.ts')
    expect(api).not.toMatch(
      /\b(?:send|materializeBody|runOutbox|reconnect)\s*\(/,
    )
    expect(api).toContain('connect(request: RemoteConnectRequest)')
    expect(api).toContain('refreshAccount(accountKey: AccountKey)')
  })

  it('does not retain credential configuration in registry state', () => {
    const registry = source('app/remote/session-registry.ts')
    expect(registry).not.toMatch(
      /password|token|RemoteConnectionConfig|host|username/,
    )
    expect(registry).toContain('remoteAccountId: RemoteAccountId')
    expect(registry).toContain('session: RemoteSession')
    expect(registry).toContain('coordinator: Coordinator')
    expect(registry).toContain('generation: number')
  })

  it('keeps the core production directory deliberately small', () => {
    const productionFiles = readdirSync(
      resolve(sourceRoot, 'app/remote'),
    ).filter((file) => file.endsWith('.ts'))
    expect(productionFiles.sort()).toEqual([
      'errors.ts',
      'index.ts',
      'remote-application.ts',
      'session-registry.ts',
      'tauri-remote-composition.ts',
      'types.ts',
    ])
  })
})
