import { describe, expect, expectTypeOf, it } from 'vitest'

import type { LocalChangeListener } from '../../../ports/local-change-source'
import type {
  LocalEngineContractHarness,
  LocalEngineContractRuntime,
} from '../harness'
import { createNotificationRecorder } from '../notification-recorder'

describe('TEST-01 compile-time infrastructure invariants', () => {
  it('keeps the harness surfaces exact', () => {
    expectTypeOf<keyof LocalEngineContractHarness>().toEqualTypeOf<
      'name' | 'create'
    >()
    expectTypeOf<keyof LocalEngineContractRuntime>().toEqualTypeOf<
      'readRepository' | 'syncPort' | 'localChangeSource' | 'settle' | 'dispose'
    >()
    expectTypeOf<LocalEngineContractHarness['name']>().toEqualTypeOf<string>()
    expectTypeOf<LocalEngineContractHarness['create']>().returns.toEqualTypeOf<
      Promise<LocalEngineContractRuntime>
    >()

    expect(true).toBe(true)
  })

  it('exposes readonly recorder snapshots and listener identity', () => {
    const recorder = createNotificationRecorder()

    expectTypeOf(recorder.listener).toEqualTypeOf<LocalChangeListener>()

    if (false) {
      // @ts-expect-error Recorder listener is readonly.
      recorder.listener = () => undefined
      // @ts-expect-error Batch snapshots are readonly arrays.
      recorder.batches().push({ hints: [{ kind: 'accounts' }] })
      // @ts-expect-error Flattened hint snapshots are readonly arrays.
      recorder.hints().push({ kind: 'accounts' })
    }

    expect(recorder).toBeDefined()
  })
})
