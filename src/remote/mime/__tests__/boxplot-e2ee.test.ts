import { describe, expect, it } from 'vitest'

import { parseBoxplotE2eeEnvelope } from '../boxplot-e2ee'

const valid = {
  version: 1,
  algorithm: 'boxplot-crypto-box-v1',
  sender: 'alice@boxplot.test',
  recipient: 'bob@boxplot.test',
  senderPublicKey: 'sender-key',
  recipientPublicKey: 'recipient-key',
  nonce: 'nonce',
  ciphertext: 'BODY_E2EE_CIPHERTEXT_CANARY_8527',
} as const

describe('Boxplot E2EE envelope parser', () => {
  it('parses the exact V1 fields without normalizing them', () => {
    expect(parseBoxplotE2eeEnvelope(JSON.stringify(valid))).toEqual(valid)
  })

  it.each(['', 'not JSON', '{"version":1'])(
    'rejects malformed JSON',
    (payload) => {
      expect(() => parseBoxplotE2eeEnvelope(payload)).toThrow(TypeError)
    },
  )

  it.each([
    null,
    [],
    {},
    { ...valid, version: 2 },
    { ...valid, algorithm: 'other' },
    ...(
      [
        'sender',
        'recipient',
        'senderPublicKey',
        'recipientPublicKey',
        'nonce',
        'ciphertext',
      ] as const
    ).flatMap((field) => {
      const missing: Record<string, unknown> = { ...valid }
      delete missing[field]
      return [missing, { ...valid, [field]: 7 }]
    }),
  ])('rejects non-object, wrong discriminator and invalid fields', (value) => {
    expect(() => parseBoxplotE2eeEnvelope(JSON.stringify(value))).toThrow(
      TypeError,
    )
  })
})
