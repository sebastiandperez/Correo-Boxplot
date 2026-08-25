import { describe, it, expect } from 'vitest'
import {
  JmapAuthError,
  JmapNetworkError,
  JmapMethodError,
  isRetryable,
} from '../errors'

describe('JMAP error retryability', () => {
  it('JmapNetworkError is retryable', () => {
    const err = new JmapNetworkError('boom')
    expect(err.retryability).toBe('retryable')
    expect(isRetryable(err)).toBe(true)
  })

  it('JmapAuthError is terminal — needs re-auth, not a blind retry', () => {
    const err = new JmapAuthError()
    expect(err.retryability).toBe('terminal')
    expect(isRetryable(err)).toBe(false)
  })

  it.each([
    'serverFail',
    'serverPartialFail',
    'serverUnavailable',
    'rateLimited',
    'networkOrServerFail',
  ])('JmapMethodError with type %s is retryable', (type) => {
    const err = new JmapMethodError('Email/set', type)
    expect(err.retryability).toBe('retryable')
    expect(isRetryable(err)).toBe(true)
  })

  it.each([
    'notFound',
    'invalidArguments',
    'tooLarge',
    'stateMismatch',
    'forbidden',
    'invalidSession',
    'missingCapability',
    'cannotCalculateChanges',
    'unknown',
  ])('JmapMethodError with type %s is terminal', (type) => {
    const err = new JmapMethodError('Email/set', type)
    expect(err.retryability).toBe('terminal')
    expect(isRetryable(err)).toBe(false)
  })

  it('isRetryable is false for non-JMAP errors', () => {
    expect(isRetryable(new Error('plain'))).toBe(false)
    expect(isRetryable('not even an error')).toBe(false)
    expect(isRetryable(null)).toBe(false)
    expect(isRetryable(undefined)).toBe(false)
  })
})
