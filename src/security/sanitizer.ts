import DOMPurify from 'dompurify'

/**
 * Strict DOMPurify configuration per ADR-005 and docs/architecture/security.md.
 * Disallows scripts, forms, on* handlers, iframes, objects, embeds, SVG/MathML,
 * <style> tags, style attributes, javascript: URLs, and remote images/media.
 */
export const SANITIZER_CONFIG = {
  ALLOWED_TAGS: [
    'a',
    'b',
    'blockquote',
    'br',
    'code',
    'div',
    'em',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'hr',
    'i',
    'li',
    'ol',
    'p',
    'pre',
    'span',
    'strong',
    'table',
    'tbody',
    'td',
    'tfoot',
    'th',
    'thead',
    'tr',
    'u',
    'ul',
  ],
  ALLOWED_ATTR: ['href', 'target', 'rel', 'title', 'class'],
  ALLOW_DATA_ATTR: false,
  FORBID_TAGS: [
    'script',
    'style',
    'iframe',
    'object',
    'embed',
    'form',
    'input',
    'button',
    'svg',
    'math',
    'img',
    'audio',
    'video',
    'source',
  ],
  FORBID_ATTR: [
    'style',
    'onerror',
    'onload',
    'onclick',
    'onmouseover',
    'onfocus',
    'onblur',
  ],
  ALLOW_ARIA_ATTR: false,
}

/**
 * Sanitizes untrusted raw email HTML using defense-in-depth allowlist.
 */
export function sanitizeEmailHtml(rawHtml: string): string {
  if (!rawHtml || typeof rawHtml !== 'string') {
    return ''
  }

  // If DOMPurify is loaded in an environment with a DOM (browser/happy-dom/jsdom)
  if (
    typeof DOMPurify !== 'undefined' &&
    typeof DOMPurify.sanitize === 'function'
  ) {
    try {
      const sanitized = DOMPurify.sanitize(rawHtml, SANITIZER_CONFIG) as string
      // Extra defense: remove forbidden tags/attributes if DOMPurify was mocked or in node
      return forceSafeLinks(fallbackSanitize(sanitized))
    } catch {
      return forceSafeLinks(fallbackSanitize(rawHtml))
    }
  }

  return forceSafeLinks(fallbackSanitize(rawHtml))
}

/**
 * Ensures all hyperlinks inside the email body open securely in an external context
 * and strips any javascript: or data: protocols.
 */
export function forceSafeLinks(html: string): string {
  return html.replace(/<a\s+([^>]*?)>/gi, (_match, attrs) => {
    let safeAttrs = attrs
    // Check href
    const hrefMatch = safeAttrs.match(/href=["'](.*?)["']/i)
    if (hrefMatch) {
      const href = hrefMatch[1].trim()
      if (!isSafeUrl(href)) {
        safeAttrs = safeAttrs.replace(/href=["'].*?["']/i, 'href="#"')
      }
    }

    // Force target="_blank" and rel="noopener noreferrer"
    if (!/target=/i.test(safeAttrs)) {
      safeAttrs += ' target="_blank"'
    } else {
      safeAttrs = safeAttrs.replace(/target=["'].*?["']/i, 'target="_blank"')
    }

    if (!/rel=/i.test(safeAttrs)) {
      safeAttrs += ' rel="noopener noreferrer"'
    } else {
      safeAttrs = safeAttrs.replace(
        /rel=["'].*?["']/i,
        'rel="noopener noreferrer"',
      )
    }

    return `<a ${safeAttrs}>`
  })
}

/**
 * Validates that a URL is safe to be referenced (http/https/mailto only).
 */
export function isSafeUrl(url: string): boolean {
  if (!url) return false
  const trimmed = url.trim().toLowerCase()
  if (
    trimmed.startsWith('javascript:') ||
    trimmed.startsWith('data:') ||
    trimmed.startsWith('vbscript:') ||
    trimmed.startsWith('file:')
  ) {
    return false
  }
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('mailto:') ||
    trimmed.startsWith('#')
  )
}

/**
 * Generates an isolated srcdoc HTML document with strict Content-Security-Policy
 * for injection into an iframe sandbox.
 */
export function createSandboxedIframeSrcDoc(sanitizedHtml: string): string {
  const csp =
    "default-src 'none'; style-src 'unsafe-inline'; script-src 'none'; img-src 'none'; connect-src 'none'; frame-src 'none';"

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
      margin: 0;
      padding: 16px;
      word-break: break-word;
      background-color: transparent;
    }
    a {
      color: #2563eb;
      text-decoration: underline;
    }
    p {
      margin: 0 0 1em 0;
    }
    p:last-child {
      margin-bottom: 0;
    }
    blockquote {
      border-left: 3px solid #cbd5e1;
      margin: 0.5em 0;
      padding-left: 12px;
      color: #64748b;
    }
    pre, code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
      background-color: #f1f5f9;
      padding: 2px 4px;
      border-radius: 4px;
      font-size: 13px;
    }
    table {
      border-collapse: collapse;
      width: 100%;
      margin: 1em 0;
    }
    th, td {
      border: 1px solid #e2e8f0;
      padding: 6px 10px;
      text-align: left;
    }
  </style>
</head>
<body>
  ${sanitizedHtml}
</body>
</html>`
}

function fallbackSanitize(html: string): string {
  return html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
    .replace(/<iframe\b[^<]*(?:(?!<\/iframe>)<[^<]*)*<\/iframe>/gi, '')
    .replace(/<form\b[^<]*(?:(?!<\/form>)<[^<]*)*<\/form>/gi, '')
    .replace(/<img\b[^>]*>/gi, '')
    .replace(/\s+style=["'][^"']*["']/gi, '')
    .replace(/\s+on\w+=["'][^"']*["']/gi, '')
    .replace(/\s+on\w+=\S+/gi, '')
    .replace(/href=["']javascript:[^"']*["']/gi, 'href="#"')
}
