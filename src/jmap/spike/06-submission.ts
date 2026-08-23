/**
 * 06-submission.ts — Email submission (Vector JM-05)
 *
 * Objective: Create a draft with Email/set and send it with EmailSubmission/set.
 * Validation: Confirm receipt of valid submissionId and emailId.
 *
 * Requires: JMAP_TEST_RECIPIENT environment variable.
 *
 * Run: JMAP_TEST_RECIPIENT=test@example.com pnpm spike:jmap src/jmap/spike/06-submission.ts
 */

import { createClient, requireEnv, report } from './_config.ts';

async function main(): Promise<void> {
  const jam = createClient();
  const accountId = await jam.getPrimaryAccount();
  const testRecipient = requireEnv('JMAP_TEST_RECIPIENT');

  // 1. Find Drafts mailbox
  const [mailboxes] = await jam.api.Mailbox.get({ accountId });
  const drafts = mailboxes.list.find(
    (mb) => mb.role?.toLowerCase() === 'drafts',
  );

  if (!drafts) {
    report('JM-05', 'FAIL', 'Drafts mailbox not found.');
    return;
  }

  // 2. Find sender Identity
  const [identities] = await jam.api.Identity.get({ accountId });
  const senderIdentity = identities.list[0];

  if (!senderIdentity) {
    report('JM-05', 'FAIL', 'No Identity found for the account.');
    return;
  }

  console.log(`Sender identity: ${senderIdentity.email}`);
  console.log(`Test recipient: ${testRecipient}`);

  // 3. Create draft + submit in a single batched request
  //    We use request() / requestMany() with raw method calls to avoid
  //    jmap-jam's strict Email/set typing that requires fields we don't
  //    need for draft creation (size, isEncodingProblem, isTruncated).
  const timestamp = new Date().toISOString();

  const [emailSetResult] = await jam.api.Email.set({
    accountId,
    create: {
      draft1: {
        mailboxIds: { [drafts.id]: true },
        from: [{ email: senderIdentity.email, name: senderIdentity.name }],
        to: [{ email: testRecipient }],
        subject: `[SPIKE TEST] jmap-jam submission — ${timestamp}`,
        textBody: [{ partId: 'body', type: 'text/plain' } as never],
        bodyValues: {
          body: {
            value: `This is an automated test email from the jmap-jam spike.\nTimestamp: ${timestamp}\n\nThis email can be safely deleted.`,
            isEncodingProblem: false,
            isTruncated: false,
          },
        },
      },
    },
  });

  const emailSetAny = emailSetResult as unknown as {
    created?: Record<string, { id: string }>;
    notCreated?: unknown;
  };
  const createdEmail = emailSetAny.created?.draft1;

  if (!createdEmail) {
    report('JM-05', 'FAIL', `Email/set failed.\nErrors: ${JSON.stringify(emailSetAny.notCreated, null, 2)}`);
    return;
  }

  // EmailSubmission/set — submit the draft sequentially using the real ID
  const [submissionResult] = await jam.api.EmailSubmission.set({
    accountId,
    create: {
      sub1: {
        emailId: createdEmail.id as never,
        identityId: senderIdentity.id,
      },
    },
  });

  console.log(`\nCreated email ID: ${createdEmail.id}`);

  // 5. Validate EmailSubmission/set response
  const submissionAny = submissionResult as unknown as {
    created?: Record<string, { id: string }>;
    notCreated?: unknown;
  };
  const createdSubmission = submissionAny.created?.sub1;

  if (!createdSubmission) {
    const errors = submissionAny.notCreated;
    report(
      'JM-05',
      'FAIL',
      `EmailSubmission/set failed.\nEmail was created (${createdEmail.id}) but submission failed.\nErrors: ${JSON.stringify(errors, null, 2)}`,
    );
    return;
  }

  console.log(`Submission ID: ${createdSubmission.id}`);

  report(
    'JM-05',
    'PASS',
    [
      `emailId: ${createdEmail.id}`,
      `submissionId: ${createdSubmission.id}`,
      `identityId: ${senderIdentity.id}`,
      `recipient: ${testRecipient}`,
      `subject: [SPIKE TEST] jmap-jam submission — ${timestamp}`,
    ].join('\n'),
  );
}

main().catch((err: unknown) => {
  console.error('Unhandled error:', err);
  process.exit(1);
});
