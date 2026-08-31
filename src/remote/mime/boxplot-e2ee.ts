import type { BoxplotE2eeEnvelope } from '../../e2ee/types'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function requiredString(
  value: Record<string, unknown>,
  field: keyof BoxplotE2eeEnvelope,
): string {
  const result = value[field]
  if (typeof result !== 'string') {
    throw new TypeError('Invalid Boxplot E2EE envelope')
  }
  return result
}

export function parseBoxplotE2eeEnvelope(payload: string): BoxplotE2eeEnvelope {
  let parsed: unknown
  try {
    parsed = JSON.parse(payload)
  } catch {
    throw new TypeError('Invalid Boxplot E2EE envelope')
  }

  if (
    !isRecord(parsed) ||
    parsed.version !== 1 ||
    parsed.algorithm !== 'boxplot-crypto-box-v1'
  ) {
    throw new TypeError('Invalid Boxplot E2EE envelope')
  }

  return {
    version: 1,
    algorithm: 'boxplot-crypto-box-v1',
    sender: requiredString(parsed, 'sender'),
    recipient: requiredString(parsed, 'recipient'),
    senderPublicKey: requiredString(parsed, 'senderPublicKey'),
    recipientPublicKey: requiredString(parsed, 'recipientPublicKey'),
    nonce: requiredString(parsed, 'nonce'),
    ciphertext: requiredString(parsed, 'ciphertext'),
  }
}

export function serializeBoxplotE2eeEnvelope(
  envelope: BoxplotE2eeEnvelope,
): string {
  return JSON.stringify({
    version: envelope.version,
    algorithm: envelope.algorithm,
    sender: envelope.sender,
    recipient: envelope.recipient,
    senderPublicKey: envelope.senderPublicKey,
    recipientPublicKey: envelope.recipientPublicKey,
    nonce: envelope.nonce,
    ciphertext: envelope.ciphertext,
  })
}
