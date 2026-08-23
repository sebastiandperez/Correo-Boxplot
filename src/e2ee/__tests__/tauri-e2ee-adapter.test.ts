import { describe, expect, it, vi } from 'vitest'

import { TauriE2eeAdapter, type E2eeInvoke } from '../tauri-e2ee-adapter'

describe('TauriE2eeAdapter', () => {
  it('maps all five methods to the separate e2ee command namespace', async () => {
    const calls: Array<[string, unknown]> = []
    const invoke: E2eeInvoke = async <T>(
      command: string,
      args: Readonly<{ request: object }>,
    ) => {
      calls.push([command, args.request])
      const values: Record<string, unknown> = {
        e2ee_ensure_local_identity: {
          localIdentity: 'alice',
          publicKey: 'pk-a',
        },
        e2ee_trust_peer_public_key: null,
        e2ee_peer_key_status: { kind: 'trusted', publicKey: 'pk-b' },
        e2ee_encrypt: {
          version: 1,
          algorithm: 'boxplot-crypto-box-v1',
          sender: 'alice',
          recipient: 'bob',
          senderPublicKey: 'pk-a',
          recipientPublicKey: 'pk-b',
          nonce: 'nonce',
          ciphertext: 'cipher',
        },
        e2ee_decrypt: {
          version: 1,
          sender: 'alice',
          recipient: 'bob',
          subject: '',
          text: '',
          html: null,
        },
      }
      return values[command] as T
    }
    const adapter = new TauriE2eeAdapter(invoke)
    await adapter.ensureLocalIdentity('alice')
    await adapter.trustPeerPublicKey('alice', 'bob', 'pk-b')
    await adapter.peerKeyStatus('alice', 'bob')
    const encrypted = await adapter.encryptFor({
      localIdentity: 'alice',
      recipientIdentity: 'bob',
      subject: '',
      text: '',
      html: null,
    })
    if (!encrypted.ok) throw new Error('expected encrypted value')
    await adapter.decryptFrom({
      localIdentity: 'bob',
      expectedSender: 'alice',
      expectedRecipient: 'bob',
      expectedSubject: '',
      envelope: encrypted.value,
    })
    expect(calls.map(([command]) => command)).toEqual([
      'e2ee_ensure_local_identity',
      'e2ee_trust_peer_public_key',
      'e2ee_peer_key_status',
      'e2ee_encrypt',
      'e2ee_decrypt',
    ])
  })

  it('preserves semantic errors and maps malformed values and transport failures', async () => {
    const semantic = new TauriE2eeAdapter(
      vi.fn().mockRejectedValue('keyMismatch'),
    )
    expect(await semantic.trustPeerPublicKey('a', 'b', 'key')).toEqual({
      ok: false,
      error: { kind: 'keyMismatch' },
    })
    const malformed = new TauriE2eeAdapter(
      vi.fn().mockResolvedValue({ privateKey: 'forbidden' }),
    )
    expect(await malformed.ensureLocalIdentity('a')).toEqual({
      ok: false,
      error: { kind: 'unexpected' },
    })
    const unavailable = new TauriE2eeAdapter(
      vi.fn().mockRejectedValue(new Error('offline')),
    )
    expect(await unavailable.ensureLocalIdentity('a')).toEqual({
      ok: false,
      error: { kind: 'unavailable' },
    })
  })
})
