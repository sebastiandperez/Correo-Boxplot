/**
 * Shared configuration for JMAP spike scripts.
 *
 * Reads credentials and server URL from environment variables:
 *   JMAP_SESSION_URL  — Required. The /.well-known/jmap endpoint.
 *   JMAP_BEARER_TOKEN — Required. Bearer token for authentication.
 *   JMAP_TEST_RECIPIENT — Optional. Email address for submission tests.
 *
 * Usage:
 *   import { createClient, requireEnv, optionalEnv, report } from './_config.ts';
 */

import JamClient from 'jmap-jam';

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`❌ Missing required environment variable: ${name}`);
    process.exit(1);
  }
  return value;
}

export function optionalEnv(name: string, fallback?: string): string | undefined {
  return process.env[name] ?? fallback;
}

// ---------------------------------------------------------------------------
// Client factory
// ---------------------------------------------------------------------------

export function createClient(): JamClient {
  const sessionUrl = requireEnv('JMAP_SESSION_URL');
  const basicAuth = optionalEnv('JMAP_BASIC_AUTH');
  const bearerToken = optionalEnv('JMAP_BEARER_TOKEN');

  if (!basicAuth && !bearerToken) {
    console.error('❌ Missing auth: Provide JMAP_BASIC_AUTH (user:pass) or JMAP_BEARER_TOKEN');
    process.exit(1);
  }

  if (basicAuth) {
    const authHeader = `Basic ${Buffer.from(basicAuth).toString('base64')}`;
    
    // Override global fetch to intercept jmap-jam calls
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (url: string | Request | URL, init?: RequestInit) => {
      let requestUrl = url.toString();
      
      // Rewrite configured hostnames to localhost for docker dev
      if (requestUrl.includes('boxplot.local')) {
        requestUrl = requestUrl.replace(/https?:\/\/[^\/]+/, 'http://localhost:8080');
      }

      const headers = new Headers(init?.headers);
      headers.set('Authorization', authHeader);

      return originalFetch(requestUrl, {
        ...init,
        headers,
      });
    };

    return new JamClient({
      sessionUrl,
      bearerToken: 'dummy-token', // Ignored because we override auth header
    });
  }

  return new JamClient({ sessionUrl, bearerToken: bearerToken! });
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type SpikeResult = 'PASS' | 'FAIL' | 'BLOCKED';

export function report(
  vector: string,
  result: SpikeResult,
  details: string,
): void {
  const icon = result === 'PASS' ? '✅' : result === 'FAIL' ? '❌' : '⏸️';
  console.log(`\n${'═'.repeat(60)}`);
  console.log(`${icon}  [${vector}] ${result}`);
  console.log(`${'─'.repeat(60)}`);
  console.log(details);
  console.log(`${'═'.repeat(60)}\n`);

  if (result === 'FAIL') {
    process.exit(1);
  }
}
