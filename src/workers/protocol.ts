import type { AccountKey } from '../domain/ids'
import type { SendMutation } from '../domain/pending-mutation'

export type MainToWorkerMessage =
  | { type: 'INIT_SESSION'; payload: { sessionUrl: string; token: string; expiresInSeconds?: number } }
  | { type: 'TEARDOWN_SESSION'; payload?: undefined }
  | { type: 'SYNC_ACCOUNT'; payload: { accountKey: AccountKey; jmapAccountId: string; sinceState: string } }
  | { type: 'SEND_EMAIL'; payload: { accountKey: AccountKey; jmapAccountId: string; mutation: SendMutation } }

export type WorkerToMainMessage =
  | { type: 'SESSION_READY'; payload: { primaryAccounts: Record<string, string> } }
  | { type: 'SESSION_ERROR'; payload: { error: string } }
  | { type: 'SESSION_TEARDOWN'; payload: { canary: string } }
  | { type: 'TEARDOWN_COMPLETE'; payload: { canary: string } }
  | { type: 'SYNC_SUCCESS'; payload: { accountKey: AccountKey } }
  | { type: 'SYNC_ERROR'; payload: { accountKey: AccountKey; error: string } }
  | { type: 'SEND_SUCCESS'; payload: { mutationId: string } }
  | { type: 'SEND_ERROR'; payload: { mutationId: string; error: string } }