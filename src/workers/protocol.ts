import type { AccountKey, MutationId } from '../domain/ids'

/**
 * Correlates a request sent across the Worker<->main postMessage channel
 * with its response. Two independent counters exist (one per direction:
 * worker-client.ts for JMAP session/sync/send requests, ipc-bridge.ts for
 * Local Engine IPC requests) — they never need to compare across
 * directions, only within the pending-map of whichever side generated the
 * id, so collisions between the two counters are harmless.
 */
export type WorkerRequestId = string & { readonly __brand: 'WorkerRequestId' }

export function workerRequestIdFromString(value: string): WorkerRequestId {
  if (!value) throw new TypeError('WorkerRequestId cannot be empty')
  return value as WorkerRequestId
}

export type RemoteSessionInput = Readonly<{
  sessionUrl: string
  token: string
  expiresInSeconds?: number
}>

/** Coarse remote connection lifecycle, for Persona A's runtime store (A2-02/A2-04). */
export type RemoteConnectionStatus =
  'anonymous' | 'connecting' | 'authenticated' | 'expired' | 'error'

/**
 * Mirrors src/ipc/dto/index.ts's IpcResult envelope shape without importing
 * it — the bridge relays it opaquely, it never inspects `value`/`error`.
 */
export type IpcBridgeInvokeResult = Readonly<{
  ok: boolean
  value?: unknown
  error?: Readonly<{ kind: string }>
}>

// ---------------------------------------------------------------------------
// Main -> Worker
// ---------------------------------------------------------------------------

export type InitSessionMessage = Readonly<{
  type: 'INIT_SESSION'
  requestId: WorkerRequestId
  payload: RemoteSessionInput
}>

export type TeardownSessionMessage = Readonly<{
  type: 'TEARDOWN_SESSION'
  requestId: WorkerRequestId
}>

export type SyncAccountMessage = Readonly<{
  type: 'SYNC_ACCOUNT'
  requestId: WorkerRequestId
  payload: Readonly<{
    accountKey: AccountKey
    jmapAccountId: string
  }>
}>

/**
 * mutationId, not the mutation itself: Outbox reads the durably staged
 * SendMutation itself via ReadRepository rather than trusting a
 * caller-supplied snapshot — the mutation must already be staged via
 * SyncPort.stageSendMutation before this is sent.
 */
export type SendEmailMessage = Readonly<{
  type: 'SEND_EMAIL'
  requestId: WorkerRequestId
  payload: Readonly<{
    accountKey: AccountKey
    jmapAccountId: string
    mutationId: MutationId
  }>
}>

/** Main's answer to a worker-initiated IPC_INVOKE (see ipc-bridge.ts). */
export type IpcInvokeResultMessage = Readonly<{
  type: 'IPC_INVOKE_RESULT'
  requestId: WorkerRequestId
  payload:
    | Readonly<{ ok: true; value: IpcBridgeInvokeResult }>
    | Readonly<{
        ok: false
        error: Readonly<{ kind: 'unavailable' | 'unexpected'; message: string }>
      }>
}>

export type MainToWorkerMessage =
  | InitSessionMessage
  | TeardownSessionMessage
  | SyncAccountMessage
  | SendEmailMessage
  | IpcInvokeResultMessage

// ---------------------------------------------------------------------------
// Worker -> Main
// ---------------------------------------------------------------------------

export type SessionReadyMessage = Readonly<{
  type: 'SESSION_READY'
  requestId: WorkerRequestId
  payload: Readonly<{ primaryAccounts: Record<string, string> }>
}>

export type SessionErrorMessage = Readonly<{
  type: 'SESSION_ERROR'
  requestId: WorkerRequestId
  payload: Readonly<{ error: string }>
}>

/**
 * Unsolicited: the token expired on its own internal timer, or an
 * in-flight call surfaced a 401 that invalidated it. Never fired as a
 * side effect of an explicit TEARDOWN_SESSION request — that gets
 * TeardownCompleteMessage instead, correlated by requestId.
 */
export type SessionTeardownMessage = Readonly<{
  type: 'SESSION_TEARDOWN'
  payload: Readonly<{ canary: string }>
}>

export type TeardownCompleteMessage = Readonly<{
  type: 'TEARDOWN_COMPLETE'
  requestId: WorkerRequestId
  payload: Readonly<{ canary: string }>
}>

export type SyncSuccessMessage = Readonly<{
  type: 'SYNC_SUCCESS'
  requestId: WorkerRequestId
  payload: Readonly<{ accountKey: AccountKey }>
}>

export type SyncErrorMessage = Readonly<{
  type: 'SYNC_ERROR'
  requestId: WorkerRequestId
  payload: Readonly<{ accountKey: AccountKey; error: string }>
}>

export type SendSuccessMessage = Readonly<{
  type: 'SEND_SUCCESS'
  requestId: WorkerRequestId
  payload: Readonly<{
    mutationId: string
    /**
     * 'sent': submitEmail succeeded and the mutation was confirmed+removed.
     * 'skipped': nothing to do (never staged, already handled by another
     * run, or lost a claim race) — not an error, but not a new send either.
     */
    outcome: 'sent' | 'skipped' | 'needsReconciliation'
  }>
}>

export type SendErrorMessage = Readonly<{
  type: 'SEND_ERROR'
  requestId: WorkerRequestId
  payload: Readonly<{ mutationId: string; error: string }>
}>

/** Unsolicited: JMAP push (RFC 8887 StateChange), forwarded verbatim. */
export type StateChangeMessage = Readonly<{
  type: 'STATE_CHANGE'
  payload: Readonly<{ changed: Record<string, Record<string, string>> }>
}>

/** Unsolicited: fired on every connection lifecycle transition. */
export type ConnectionStatusMessage = Readonly<{
  type: 'CONNECTION_STATUS'
  payload: Readonly<{ status: RemoteConnectionStatus }>
}>

/**
 * Worker asking main to run a Local Engine IPC command on its behalf,
 * because @tauri-apps/api's invoke() reads window.__TAURI_INTERNALS__,
 * which does not exist inside a Worker's global scope (H1).
 */
export type IpcInvokeMessage = Readonly<{
  type: 'IPC_INVOKE'
  requestId: WorkerRequestId
  payload: Readonly<{ command: string; request: object }>
}>

export type WorkerToMainMessage =
  | SessionReadyMessage
  | SessionErrorMessage
  | SessionTeardownMessage
  | TeardownCompleteMessage
  | SyncSuccessMessage
  | SyncErrorMessage
  | SendSuccessMessage
  | SendErrorMessage
  | StateChangeMessage
  | ConnectionStatusMessage
  | IpcInvokeMessage
