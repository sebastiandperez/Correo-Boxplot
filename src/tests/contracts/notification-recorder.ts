import type {
  LocalChangeBatch,
  LocalChangeHint,
  LocalChangeListener,
} from '../../ports/local-change-source'

export interface NotificationRecorder {
  readonly listener: LocalChangeListener

  batches(): readonly LocalChangeBatch[]

  hints(): readonly LocalChangeHint[]

  clear(): void
}

function snapshotBatch(batch: LocalChangeBatch): LocalChangeBatch {
  const [firstHint, ...remainingHints] = batch.hints
  return { hints: [firstHint, ...remainingHints] }
}

export function createNotificationRecorder(): NotificationRecorder {
  const recordedBatches: LocalChangeBatch[] = []

  const listener: LocalChangeListener = (batch) => {
    recordedBatches.push(snapshotBatch(batch))
  }

  return {
    listener,
    batches: () => recordedBatches.map(snapshotBatch),
    hints: () =>
      recordedBatches.flatMap((batch) => {
        const [firstHint, ...remainingHints] = batch.hints
        return [firstHint, ...remainingHints]
      }),
    clear: () => {
      recordedBatches.length = 0
    },
  }
}
