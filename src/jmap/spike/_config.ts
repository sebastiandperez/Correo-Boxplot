/**
 * Shared configuration for JMAP spike scripts.
 *
 * Reads credentials and server URL from environment variables:
 *   JMAP_SESSION_URL  — Required. The /.well-known/jmap endpoint.
 *   JMAP_BEARER_TOKEN — Required. Bearer token for authentication.
 *   JMAP_TEST_RECIPIENT — Optional. Email address for submission tests.
 *
 * SECURITY NOTE: This module MUST NOT mutate globalThis.fetch.
 * Auth injection is handled via jmap-jam's constructor or an isolated
 * fetch wrapper passed to each client instance. Overriding the global
 * fetch risks leaking tokens across accounts or to unintended URLs.
 *
 * Usage:
 *   import { createClient, requireEnv, optionalEnv, report } from './_config.ts';
 */

import JamClient from 'jmap-jam'

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function requireEnv(name: string): string {
  const value = process.env[name]
  if (!value) {
    console.error(`Missing required environment variable: ${name}`)
    process.exit(1)
  }
  return value
}

export function optionalEnv(
  name: string,
  fallback?: string,
): string | undefined {
  return process.env[name] ?? fallback
}

// ---------------------------------------------------------------------------
// Client factory — NO globalThis.fetch mutation
// ---------------------------------------------------------------------------

export function createClient(): JamClient {
  const sessionUrl = requireEnv('JMAP_SESSION_URL')
  const basicAuth = optionalEnv('JMAP_BASIC_AUTH')
  const bearerToken = optionalEnv('JMAP_BEARER_TOKEN')

  if (!basicAuth && !bearerToken) {
    console.error(
      'Missing auth: Provide JMAP_BASIC_AUTH (user:pass) or JMAP_BEARER_TOKEN',
    )
    process.exit(1)
  }

  if (basicAuth) {
    // For Basic auth spikes, encode and pass as bearer token to jmap-jam.
    // jmap-jam sets Authorization: Bearer <token>, so we encode the Basic
    // header value and let the server accept it. This avoids mutating globalThis.fetch.
    const encoded = Buffer.from(basicAuth).toString('base64')

    return new JamClient({
      sessionUrl,
      bearerToken: encoded,
      // jmap-jam injects Authorization: Bearer <encoded> which won't work
      // with all servers expecting "Basic <encoded>". For spike scripts only,
      // the fetch override is acceptable IN A CONTROLLED SPIKE CONTEXT but
      // MUST NEVER be used in production adapter code.
      fetch: async (url: string | Request | URL, init?: RequestInit) => {
        let requestUrl = url.toString()

        // Rewrite configured hostnames to localhost for docker dev
        if (requestUrl.includes('boxplot.local')) {
          requestUrl = requestUrl.replace(
            /https?:\/\/[^\/]+/,
            'http://localhost:8080',
          )
        }

        const headers = new Headers(init?.headers)
        headers.set('Authorization', `Basic ${encoded}`)

        return fetch(requestUrl, {
          ...init,
          headers,
        })
      },
    })
  }

  return new JamClient({ sessionUrl, bearerToken: bearerToken! })
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type SpikeResult = 'PASS' | 'FAIL' | 'BLOCKED'

export function report(
  vector: string,
  result: SpikeResult,
  details: string,
): void {
  const icon =
    result === 'PASS' ? 'PASS' : result === 'FAIL' ? 'FAIL' : 'BLOCKED'
  console.log(`\n${'='.repeat(60)}`)
  console.log(`${icon}  [${vector}] ${result}`)
  console.log(`${'-'.repeat(60)}`)
  console.log(details)
  console.log(`${'='.repeat(60)}\n`)

  if (result === 'FAIL') {
    process.exit(1)
  }
}
