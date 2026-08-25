import type {
  MainToWorkerMessage,
  WorkerToMainMessage,
} from '../workers/protocol'
import type { AccountKey } from '../domain/ids'
import type { SendMutation } from '../domain/pending-mutation'

export class JmapWorkerClient {
  private worker: Worker

  constructor() {
    this.worker = new Worker(
      new URL('../workers/jmap-worker.ts', import.meta.url),
      { type: 'module' },
    )

    this.worker.onmessage = (event: MessageEvent<WorkerToMainMessage>) => {
      const data = event.data
      console.log('[WorkerClient] Received:', data)
      // En el futuro, esto se puede expandir para emitir eventos locales o resolver promesas
    }

    this.worker.onerror = (err) => {
      console.error('[WorkerClient] Error en el Web Worker:', err)
    }
  }

  syncAccount(
    accountKey: AccountKey,
    jmapAccountId: string,
    sinceState: string,
  ) {
    const msg: MainToWorkerMessage = {
      type: 'SYNC_ACCOUNT',
      payload: { accountKey, jmapAccountId, sinceState },
    }
    this.worker.postMessage(msg)
  }

  sendEmail(
    accountKey: AccountKey,
    jmapAccountId: string,
    mutation: SendMutation,
  ) {
    const msg: MainToWorkerMessage = {
      type: 'SEND_EMAIL',
      payload: { accountKey, jmapAccountId, mutation },
    }
    this.worker.postMessage(msg)
  }
}
