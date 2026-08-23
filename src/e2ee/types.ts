export type E2eeErrorKind =
  | 'multipleRecipientsUnsupported'
  | 'keyUnavailable'
  | 'peerKeyUnavailable'
  | 'keyMismatch'
  | 'invalidPublicKey'
  | 'invalidEnvelope'
  | 'metadataMismatch'
  | 'authenticationFailed'
  | 'unavailable'
  | 'unexpected'

export type E2eeResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{ ok: false; error: Readonly<{ kind: E2eeErrorKind }> }>

export type E2eePublicIdentity = Readonly<{
  localIdentity: string
  publicKey: string
}>

export type PeerKeyStatus =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'trusted'; publicKey: string }>

export type BoxplotE2eeEnvelope = Readonly<{
  version: 1
  algorithm: 'boxplot-crypto-box-v1'
  sender: string
  recipient: string
  senderPublicKey: string
  recipientPublicKey: string
  nonce: string
  ciphertext: string
}>

export type E2eePlaintext = Readonly<{
  version: 1
  sender: string
  recipient: string
  subject: string
  text: string
  html: string | null
}>

export type EncryptForInput = Readonly<{
  localIdentity: string
  recipientIdentity: string
  subject: string
  text: string
  html: string | null
}>

export type DecryptFromInput = Readonly<{
  localIdentity: string
  expectedSender: string
  expectedRecipient: string
  expectedSubject: string
  envelope: BoxplotE2eeEnvelope
}>
