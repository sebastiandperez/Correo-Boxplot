import { describe, it, expect } from 'vitest'
import * as fs from 'fs'
import * as path from 'path'

describe('V1 — Architecture Isolation', () => {
  const rootDir = path.resolve(__dirname, '../../../')

  function readFileContent(relativePath: string): string {
    const fullPath = path.join(rootDir, relativePath)
    return fs.readFileSync(fullPath, 'utf-8')
  }

  it('V1-01 / C02: Coordinator has zero JMAP imports and mentions no JMAP concrete symbols', () => {
    const content = readFileContent('src/sync/coordinator.ts')

    // Must not import from src/jmap/ or ../jmap/
    expect(content).not.toMatch(/from\s+['"].*\/jmap\/.*['"]/)
    expect(content).not.toMatch(/from\s+['"].*\/jmap['"]/)

    // Must not mention JMAP concrete symbols
    expect(content).not.toContain('JmapClient')
    expect(content).not.toContain('JmapMethodError')
    expect(content).not.toContain('JmapEmail')
    expect(content).not.toContain('JmapQueryResult')
  })

  it('V1-02 / C03: Outbox has zero concrete JMAP imports', () => {
    const content = readFileContent('src/sync/outbox.ts')

    // Must not import from src/jmap/ or ../jmap/
    expect(content).not.toMatch(/from\s+['"].*\/jmap\/.*['"]/)
    expect(content).not.toMatch(/from\s+['"].*\/jmap['"]/)

    // Must not mention JMAP concrete symbols
    expect(content).not.toContain('JmapClient')
    expect(content).not.toContain('JmapEmailDraft')
  })

  it('V1-03: Core protocol-neutral remote contracts must not import src/jmap', () => {
    const filesToTest = [
      'src/remote/mail.ts',
      'src/remote/submission.ts',
      'src/remote/body.ts',
      'src/remote/submission-message.ts',
      'src/remote/types/ids.ts',
      'src/remote/types/models.ts',
    ]

    for (const relPath of filesToTest) {
      const content = readFileContent(relPath)
      expect(content, `${relPath} should not import jmap`).not.toMatch(
        /from\s+['"].*\/jmap.*['"]/,
      )
    }
  })

  it('V1-04: Core C does not select behavior by protocol === or provider === in Coordinator/Outbox/Remote Mail/Submission', () => {
    const filesToTest = [
      'src/sync/coordinator.ts',
      'src/sync/outbox.ts',
      'src/remote/mail.ts',
      'src/remote/submission.ts',
    ]

    for (const relPath of filesToTest) {
      const content = readFileContent(relPath)
      expect(content).not.toMatch(/protocol\s*===/)
      expect(content).not.toMatch(/provider\s*===/)
      expect(content).not.toMatch(/switch\s*\(\s*protocol\s*\)/)
      expect(content).not.toMatch(/switch\s*\(\s*provider\s*\)/)
    }
  })

  it('V1-05: Core remote contracts must not depend on @tauri-apps/api, Rust IPC, native network APIs', () => {
    const filesToTest = [
      'src/remote/mail.ts',
      'src/remote/submission.ts',
      'src/remote/body.ts',
      'src/remote/submission-message.ts',
      'src/remote/connection.ts',
      'src/remote/session.ts',
    ]

    for (const relPath of filesToTest) {
      const content = readFileContent(relPath)
      expect(content).not.toContain('@tauri-apps/api')
      expect(content).not.toContain('invoke(')
      expect(content).not.toContain('net.')
    }
  })

  it('V1-07: Remote* -> frozen local Jmap* conversion is centralized in src/remote/compat/', () => {
    const coordContent = readFileContent('src/sync/coordinator.ts')
    const outboxContent = readFileContent('src/sync/outbox.ts')

    // Coordinator & Outbox should not call jmapEmailIdFromString or jmapMailboxIdFromString directly
    expect(coordContent).not.toContain('jmapEmailIdFromString(')
    expect(coordContent).not.toContain('jmapMailboxIdFromString(')

    expect(outboxContent).not.toContain('jmapEmailIdFromString(')
    expect(outboxContent).not.toContain('jmapMailboxIdFromString(')
  })
})
