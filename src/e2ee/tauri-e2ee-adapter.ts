import { invoke as tauriInvoke } from '@tauri-apps/api/core'

import type { E2eePort } from './port'
import type {
  BoxplotE2eeEnvelope,
  E2eeErrorKind,
  E2eePlaintext,
  E2eePublicIdentity,
  E2eeResult,
  PeerKeyStatus,
} from './types'

export type E2eeInvoke = <T>(
  command: string,
  args: Readonly<{ request: object }>,
) => Promise<T>

const ERROR_KINDS: readonly E2eeErrorKind[] = [
  'multipleRecipientsUnsupported',
  'keyUnavailable',
  'peerKeyUnavailable',
  'keyMismatch',
  'invalidPublicKey',
  'invalidEnvelope',
  'metadataMismatch',
  'authenticationFailed',
  'unavailable',
  'unexpected',
]

export class TauriE2eeAdapter implements E2eePort {
  constructor(private readonly invoke: E2eeInvoke = tauriInvoke) {}

  ensureLocalIdentity(localIdentity: string) {
    return this.call(
      'e2ee_ensure_local_identity',
      { localIdentity },
      decodePublicIdentity,
    )
  }

  trustPeerPublicKey(
    localIdentity: string,
    peerIdentity: string,
    publicKey: string,
  ) {
    return this.call(
      'e2ee_trust_peer_public_key',
      { localIdentity, peerIdentity, publicKey },
      (value) => {
        if (value !== null) throw new TypeError('Malformed E2EE unit response')
        return null
      },
    )
  }

  peerKeyStatus(localIdentity: string, peerIdentity: string) {
    return this.call(
      'e2ee_peer_key_status',
      { localIdentity, peerIdentity },
      decodePeerStatus,
    )
  }

  encryptFor(input: Parameters<E2eePort['encryptFor']>[0]) {
    return this.call('e2ee_encrypt', input, decodeEnvelope)
  }

  decryptFrom(input: Parameters<E2eePort['decryptFrom']>[0]) {
    return this.call('e2ee_decrypt', input, decodePlaintext)
  }

  private async call<T>(
    command: string,
    request: object,
    decode: (value: unknown) => T,
  ): Promise<E2eeResult<T>> {
    try {
      return {
        ok: true,
        value: decode(await this.invoke<unknown>(command, { request })),
      }
    } catch (cause) {
      return { ok: false, error: { kind: decodeError(cause) } }
    }
  }
}

function record(value: unknown): object {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new TypeError('Malformed E2EE IPC value')
  return value
}

function stringField(value: object, key: string): string {
  const field = Reflect.get(value, key)
  if (typeof field !== 'string') throw new TypeError(`Malformed E2EE ${key}`)
  return field
}

function decodePublicIdentity(value: unknown): E2eePublicIdentity {
  const item = record(value)
  return {
    localIdentity: stringField(item, 'localIdentity'),
    publicKey: stringField(item, 'publicKey'),
  }
}

function decodePeerStatus(value: unknown): PeerKeyStatus {
  const item = record(value)
  if (Reflect.get(item, 'kind') === 'missing') return { kind: 'missing' }
  if (Reflect.get(item, 'kind') === 'trusted')
    return { kind: 'trusted', publicKey: stringField(item, 'publicKey') }
  throw new TypeError('Malformed E2EE peer status')
}

function decodeEnvelope(value: unknown): BoxplotE2eeEnvelope {
  const item = record(value)
  if (
    Reflect.get(item, 'version') !== 1 ||
    Reflect.get(item, 'algorithm') !== 'boxplot-crypto-box-v1'
  )
    throw new TypeError('Malformed E2EE envelope discriminator')
  return {
    version: 1,
    algorithm: 'boxplot-crypto-box-v1',
    sender: stringField(item, 'sender'),
    recipient: stringField(item, 'recipient'),
    senderPublicKey: stringField(item, 'senderPublicKey'),
    recipientPublicKey: stringField(item, 'recipientPublicKey'),
    nonce: stringField(item, 'nonce'),
    ciphertext: stringField(item, 'ciphertext'),
  }
}

function decodePlaintext(value: unknown): E2eePlaintext {
  const item = record(value)
  if (
    Reflect.get(item, 'version') !== 1 ||
    (Reflect.get(item, 'html') !== null &&
      typeof Reflect.get(item, 'html') !== 'string')
  )
    throw new TypeError('Malformed E2EE plaintext')
  return {
    version: 1,
    sender: stringField(item, 'sender'),
    recipient: stringField(item, 'recipient'),
    subject: stringField(item, 'subject'),
    text: stringField(item, 'text'),
    html: Reflect.get(item, 'html'),
  }
}

function decodeError(value: unknown): E2eeErrorKind {
  if (typeof value === 'string' && ERROR_KINDS.includes(value as E2eeErrorKind))
    return value as E2eeErrorKind
  return value instanceof TypeError ? 'unexpected' : 'unavailable'
}
