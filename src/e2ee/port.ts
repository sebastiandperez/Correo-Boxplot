import type {
  BoxplotE2eeEnvelope,
  DecryptFromInput,
  E2eePlaintext,
  E2eePublicIdentity,
  E2eeResult,
  EncryptForInput,
  PeerKeyStatus,
} from './types'

export interface E2eePort {
  ensureLocalIdentity(
    localIdentity: string,
  ): Promise<E2eeResult<E2eePublicIdentity>>
  trustPeerPublicKey(
    localIdentity: string,
    peerIdentity: string,
    publicKey: string,
  ): Promise<E2eeResult<null>>
  peerKeyStatus(
    localIdentity: string,
    peerIdentity: string,
  ): Promise<E2eeResult<PeerKeyStatus>>
  encryptFor(input: EncryptForInput): Promise<E2eeResult<BoxplotE2eeEnvelope>>
  decryptFrom(input: DecryptFromInput): Promise<E2eeResult<E2eePlaintext>>
}
