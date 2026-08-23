import { describe, expect, it, vi } from 'vitest'

import { emailAddress } from '../../domain/address'
import {
  accountKeyFromString,
  jmapIdentityIdFromString,
  scopedIdentityId,
} from '../../domain/ids'
import { identity } from '../../domain/identity'
import { sendIntent } from '../../domain/send-intent'
import type { E2eePort } from '../port'
import { encryptSendIntent } from '../send-intent'

const from = identity({
  id: scopedIdentityId(
    accountKeyFromString('a'),
    jmapIdentityIdFromString('i'),
  ),
  name: 'Alice',
  email: 'alice@boxplot.test',
  replyTo: null,
  bcc: null,
})
const recipient = emailAddress(null, 'bob@boxplot.test')

function portWith(encryptFor: E2eePort['encryptFor']): E2eePort {
  const unavailable = async () => ({
    ok: false as const,
    error: { kind: 'unavailable' as const },
  })
  return {
    encryptFor,
    ensureLocalIdentity: unavailable,
    trustPeerPublicKey: unavailable,
    peerKeyStatus: unavailable,
    decryptFrom: unavailable,
  }
}

describe('encryptSendIntent', () => {
  it('maps the exact one-recipient subset without changing SendIntent', async () => {
    const encryptFor: E2eePort['encryptFor'] = vi.fn().mockResolvedValue({
      ok: true,
      value: {
        version: 1,
        algorithm: 'boxplot-crypto-box-v1',
        sender: 'alice@boxplot.test',
        recipient: 'bob@boxplot.test',
        senderPublicKey: 'a',
        recipientPublicKey: 'b',
        nonce: 'n',
        ciphertext: 'c',
      },
    })
    const intent = sendIntent({
      identity: from,
      to: [recipient],
      cc: [],
      bcc: [],
      subject: 'Subject',
      body: { text: 'text', html: null },
    })
    await encryptSendIntent(portWith(encryptFor), intent)
    expect(encryptFor).toHaveBeenCalledWith({
      localIdentity: 'alice@boxplot.test',
      recipientIdentity: 'bob@boxplot.test',
      subject: 'Subject',
      text: 'text',
      html: null,
    })
  })

  it('rejects multiple effective recipients before native crypto', async () => {
    const encryptFor: E2eePort['encryptFor'] = vi.fn()
    const unsupported = sendIntent({
      identity: from,
      to: [recipient],
      cc: [emailAddress(null, 'cc@boxplot.test')],
      bcc: [],
      subject: '',
      body: { text: '', html: null },
    })
    expect(await encryptSendIntent(portWith(encryptFor), unsupported)).toEqual({
      ok: false,
      error: { kind: 'multipleRecipientsUnsupported' },
    })
    expect(encryptFor).not.toHaveBeenCalled()
  })
})
