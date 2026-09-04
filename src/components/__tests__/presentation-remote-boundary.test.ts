import { readdirSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

function vueSources(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name)
    if (entry.isDirectory()) return vueSources(path)
    return entry.name.endsWith('.vue') ? [path] : []
  })
}

describe('Presentation remote boundary', () => {
  it('does not import remote lifecycle, body-source, or native adapter types', () => {
    const sources = [
      resolve(process.cwd(), 'src/App.vue'),
      ...vueSources(resolve(process.cwd(), 'src/components')),
    ]
    const forbidden =
      /RemoteApplication|RemoteSession|RemoteMail|RemoteBodySource|BodyMaterializer|MutationRunner|DefaultMutationRunner|RemoteMutationSource|Submission|E2eePort|ImapAdapter|SmtpSubmission|NativeMailIpcPort/

    for (const source of sources) {
      expect(readFileSync(source, 'utf8'), source).not.toMatch(forbidden)
    }
  })
})
