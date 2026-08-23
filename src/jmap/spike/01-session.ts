/**
 * 01-session.ts — Session Discovery (Vector JM-01)
 *
 * Objective: Query /.well-known/jmap using test credentials.
 * Validation: Verify that `capabilities` contains `urn:ietf:params:jmap:mail`
 *             and that the primary accountId is obtainable.
 *
 * Run: pnpm spike:jmap src/jmap/spike/01-session.ts
 */

import { createClient, report } from './_config.ts';

const MAIL_CAPABILITY = 'urn:ietf:params:jmap:mail';

async function main(): Promise<void> {
  const jam = createClient();

  // 1. Obtain session
  const session = await jam.session;
  
  if (!session || !session.capabilities) {
    report('JM-01', 'FAIL', 'Session object is invalid or missing capabilities. See raw session output above.');
    return;
  }
  
  const capabilities = Object.keys(session.capabilities);

  console.log('Session obtained.');
  console.log('Capabilities:', capabilities);
  console.log('Accounts:', JSON.stringify(session.accounts, null, 2));
  console.log('API URL:', session.apiUrl);
  console.log('Download URL:', session.downloadUrl);
  console.log('Upload URL:', session.uploadUrl);

  if ('eventSourceUrl' in session) {
    console.log(
      'Event Source URL:',
      (session as Record<string, unknown>).eventSourceUrl,
    );
  }

  // 2. Verify Mail capability
  const hasMailCapability = capabilities.includes(MAIL_CAPABILITY);

  if (!hasMailCapability) {
    report(
      'JM-01',
      'FAIL',
      `Mail capability not found.\nAvailable: ${capabilities.join(', ')}`,
    );
    return;
  }

  // 3. Obtain primary account
  const accountId = await jam.getPrimaryAccount();

  if (!accountId) {
    report('JM-01', 'FAIL', 'Could not obtain primary accountId.');
    return;
  }

  console.log('Primary account ID:', accountId);

  report(
    'JM-01',
    'PASS',
    [
      `Mail capability: present`,
      `Primary accountId: ${accountId}`,
      `Total capabilities: ${capabilities.length}`,
      `Capabilities: ${capabilities.join(', ')}`,
    ].join('\n'),
  );
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
