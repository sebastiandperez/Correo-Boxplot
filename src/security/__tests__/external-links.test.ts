import { beforeEach, describe, expect, it, vi } from 'vitest'

const { openUrl } = vi.hoisted(() => ({ openUrl: vi.fn() }))

vi.mock('@tauri-apps/plugin-opener', () => ({ openUrl }))

import { isAllowedExternalUrl, openSafeExternalUrl } from '../external-links'

describe('controlled external links', () => {
  beforeEach(() => openUrl.mockReset())

  it.each(['https://example.test/path', 'http://example.test/path'])(
    'opens an allowed URL only through the official opener: %s',
    async (url) => {
      await expect(openSafeExternalUrl(url)).resolves.toBe(true)
      expect(openUrl).toHaveBeenCalledWith(url)
    },
  )

  it.each([
    'javascript:alert(1)',
    'data:text/html,unsafe',
    'file:///tmp/message',
    'mailto:user@example.test',
    'custom:thing',
    'not a url',
  ])('rejects unsupported schemes without invoking opener: %s', async (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false)
    await expect(openSafeExternalUrl(url)).resolves.toBe(false)
    expect(openUrl).not.toHaveBeenCalled()
  })
})
