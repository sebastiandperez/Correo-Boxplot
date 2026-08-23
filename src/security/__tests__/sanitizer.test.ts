import { describe, expect, it } from 'vitest'
import {
  createSandboxedIframeSrcDoc,
  forceSafeLinks,
  isSafeUrl,
  sanitizeEmailHtml,
} from '../sanitizer'

describe('Security: HTML Sanitizer and Isolation (A-05)', () => {
  it('strips <script> tags and malicious payloads', () => {
    const malicious =
      '<div>Hello<script>alert("XSS Attack!");</script> World</div>'
    const result = sanitizeEmailHtml(malicious)
    expect(result).not.toContain('<script>')
    expect(result).not.toContain('alert("XSS Attack!")')
    expect(result).toContain('Hello')
    expect(result).toContain('World')
  })

  it('strips inline event handlers (onerror, onclick, onload, etc.)', () => {
    const malicious =
      '<div onclick="doEvil()" onmouseover="stealTokens()">Click me</div>'
    const result = sanitizeEmailHtml(malicious)
    expect(result).not.toContain('onclick')
    expect(result).not.toContain('doEvil')
    expect(result).not.toContain('onmouseover')
    expect(result).toContain('Click me')
  })

  it('strips <style> blocks and style attributes to prevent UI redress / CSS injection', () => {
    const payload =
      '<style>body { display: none; }</style><p style="position:fixed; top:0; left:0; width:100%; height:100%;">Overlay</p>'
    const result = sanitizeEmailHtml(payload)
    expect(result).not.toContain('<style>')
    expect(result).not.toContain('display: none')
    expect(result).not.toContain('position:fixed')
    expect(result).toContain('Overlay')
  })

  it('blocks and removes <form>, <input>, and <button> to prevent phishing attacks', () => {
    const phishing =
      '<form action="https://phishing.example.com/steal" method="POST"><input type="password" name="pass"><button type="submit">Login</button></form>'
    const result = sanitizeEmailHtml(phishing)
    expect(result).not.toContain('<form')
    expect(result).not.toContain('type="password"')
    expect(result).not.toContain('<button')
  })

  it('blocks remote images to prevent email tracking pixels', () => {
    const emailWithTracker =
      '<p>Welcome!</p><img src="https://tracker.com/pixel.gif?uid=123" alt="tracker">'
    const result = sanitizeEmailHtml(emailWithTracker)
    expect(result).not.toContain('<img')
    expect(result).not.toContain('https://tracker.com/pixel.gif')
    expect(result).toContain('Welcome!')
  })

  it('neutralizes javascript:, data:, and vbscript: URLs in hyperlinks', () => {
    const maliciousLinks =
      '<a href="javascript:alert(document.cookie)">Malicious link</a>'
    const result = sanitizeEmailHtml(maliciousLinks)
    expect(result).not.toContain('javascript:')
    expect(result).toContain('Malicious link')
  })

  it('enforces target="_blank" and rel="noopener noreferrer" on safe external links', () => {
    const link = '<a href="https://example.com">Read Documentation</a>'
    const result = forceSafeLinks(link)
    expect(result).toContain('href="https://example.com"')
    expect(result).toContain('target="_blank"')
    expect(result).toContain('rel="noopener noreferrer"')
  })

  it('validates safe URLs strictly', () => {
    expect(isSafeUrl('https://example.com')).toBe(true)
    expect(isSafeUrl('http://example.com')).toBe(true)
    expect(isSafeUrl('mailto:user@example.com')).toBe(false)
    expect(isSafeUrl('#section')).toBe(false)

    expect(isSafeUrl('javascript:alert(1)')).toBe(false)
    expect(isSafeUrl('data:text/html,<script>alert(1)</script>')).toBe(false)
    expect(isSafeUrl('vbscript:msgbox(1)')).toBe(false)
    expect(isSafeUrl('file:///etc/passwd')).toBe(false)
    expect(isSafeUrl('')).toBe(false)
  })

  it('escapes plain text before it enters the iframe HTML document', async () => {
    const { escapeEmailText } = await import('../sanitizer')
    expect(escapeEmailText('<script>"unsafe" & data</script>')).toBe(
      '&lt;script&gt;&quot;unsafe&quot; &amp; data&lt;/script&gt;',
    )
  })

  it('generates an isolated iframe srcdoc with strict Content-Security-Policy', () => {
    const html = '<p>Safe message body</p>'
    const srcDoc = createSandboxedIframeSrcDoc(html)
    expect(srcDoc).toContain('Content-Security-Policy')
    expect(srcDoc).toContain("default-src 'none'")
    expect(srcDoc).toContain("script-src 'none'")
    expect(srcDoc).toContain("img-src 'none'")
    expect(srcDoc).toContain('Safe message body')
  })
})
