import type { JmapQueryChanges } from '../types'
import type { AuthConfig } from '../transport/http'
import { fetchJmapRaw } from '../transport/http'
import { JmapMethodError } from '../errors'

export async function getEmailQueryChanges(
  apiUrl: string,
  auth: AuthConfig,
  accountId: string,
  mailboxId: string,
  sinceQueryState: string,
): Promise<JmapQueryChanges> {
  let methodResponses
  try {
    methodResponses = await fetchJmapRaw(apiUrl, auth, [
      [
        'Email/queryChanges',
        {
          accountId,
          filter: { inMailbox: mailboxId },
          sinceQueryState,
        },
        'qc1',
      ],
    ])
  } catch (err: unknown) {
    throw new JmapMethodError(
      'Email/queryChanges',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const response = methodResponses.find((r) => r[2] === 'qc1')
  if (!response) {
    throw new JmapMethodError(
      'Email/queryChanges',
      'invalidResponse',
      'No response for Email/queryChanges',
    )
  }

  const result = response[1] as Record<string, unknown>

  if (result['type'] === 'cannotCalculateChanges') {
    throw new JmapMethodError(
      'Email/queryChanges',
      'cannotCalculateChanges',
      'Server cannot calculate query changes from this state.',
    )
  }

  return {
    accountId,
    oldQueryState: (result['oldQueryState'] as string) || sinceQueryState,
    newQueryState: (result['newQueryState'] as string) || '',
    added: ((result['added'] as Array<{ id: string; index: number }>) || []).map(
      (a) => Object.freeze({ id: a.id, index: a.index }),
    ),
    removed: ((result['removed'] as string[]) || []),
    total: (result['total'] as number) ?? 0,
  }
}
