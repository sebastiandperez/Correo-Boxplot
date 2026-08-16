import { describe, expect, it } from 'vitest'

import type {
  LocalChangeBatch,
  LocalChangeHint,
} from '../../../ports/local-change-source'
import { createTestFixtures } from '../fixtures'
import { createNotificationRecorder } from '../notification-recorder'

describe('TEST-01 NotificationRecorder', () => {
  it('records one batch synchronously', () => {
    const recorder = createNotificationRecorder()
    const hint: LocalChangeHint = { kind: 'accounts' }

    recorder.listener({ hints: [hint] })

    expect(recorder.batches()).toEqual([{ hints: [hint] }])
    expect(recorder.hints()).toEqual([hint])
  })

  it('flattens multiple batches in diagnostic arrival order', () => {
    const { accountA, emailA1 } = createTestFixtures()
    const firstHint: LocalChangeHint = {
      kind: 'emails',
      accountKey: accountA.key,
    }
    const secondHint: LocalChangeHint = {
      kind: 'emailBody',
      emailId: emailA1.id,
    }
    const recorder = createNotificationRecorder()

    recorder.listener({ hints: [firstHint] })
    recorder.listener({ hints: [secondHint, firstHint] })

    expect(recorder.batches()).toHaveLength(2)
    expect(recorder.hints()).toEqual([firstHint, secondHint, firstHint])
  })

  it('snapshots received batches and never exposes internal arrays', () => {
    const recorder = createNotificationRecorder()
    const sourceHints: [LocalChangeHint, ...LocalChangeHint[]] = [
      { kind: 'accounts' },
    ]
    const sourceBatch: LocalChangeBatch = { hints: sourceHints }

    recorder.listener(sourceBatch)
    sourceHints.push({ kind: 'accounts' })

    const firstBatchSnapshot = recorder.batches()
    const secondBatchSnapshot = recorder.batches()
    const firstHintSnapshot = recorder.hints()
    const secondHintSnapshot = recorder.hints()

    expect(firstBatchSnapshot).toEqual([{ hints: [{ kind: 'accounts' }] }])
    expect(firstBatchSnapshot).not.toBe(secondBatchSnapshot)
    expect(firstBatchSnapshot[0].hints).not.toBe(secondBatchSnapshot[0].hints)
    expect(firstHintSnapshot).not.toBe(secondHintSnapshot)
  })

  it('clears observations without changing the listener', () => {
    const recorder = createNotificationRecorder()
    const listener = recorder.listener

    recorder.listener({ hints: [{ kind: 'accounts' }] })
    recorder.clear()

    expect(recorder.batches()).toEqual([])
    expect(recorder.hints()).toEqual([])
    expect(recorder.listener).toBe(listener)
  })
})
