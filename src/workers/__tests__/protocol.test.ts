import { describe, it, expect } from 'vitest'
import { workerRequestIdFromString } from '../protocol'

describe('workerRequestIdFromString', () => {
  it('accepts a non-empty string', () => {
    expect(workerRequestIdFromString('m:1')).toBe('m:1')
  })

  it('throws on an empty string', () => {
    expect(() => workerRequestIdFromString('')).toThrow(TypeError)
  })
})
