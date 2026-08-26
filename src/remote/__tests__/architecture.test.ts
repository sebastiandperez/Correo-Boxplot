import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const root = resolve(import.meta.dirname, '../..')

function source(relativePath: string): string {
  return readFileSync(resolve(root, relativePath), 'utf8')
}

describe('REMOTE-BOUNDARY architecture conformance', () => {
  it.each([
    'sync/coordinator.ts',
    'sync/outbox.ts',
    'remote/mail.ts',
    'remote/submission.ts',
    'remote/types/ids.ts',
    'remote/types/models.ts',
  ])('%s has no concrete JMAP import', (file) => {
    expect(source(file)).not.toMatch(/from ['"][^'"]*jmap[^'"]*['"]/)
  })

  it.each(['sync/coordinator.ts', 'sync/outbox.ts'])(
    '%s has no protocol-selection branch',
    (file) => {
      expect(source(file)).not.toMatch(/(?:protocol|provider)\s*===/)
      expect(source(file)).not.toMatch(/['"](?:imap|jmap)['"]/)
    },
  )
})
