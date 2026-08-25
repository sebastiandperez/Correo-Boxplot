import {
  jmapIdentityIdFromString,
  scopedIdentityId,
  type AccountKey,
} from '../../domain/ids'
import { emailAddress, type EmailAddress } from '../../domain/address'
import { identity, type Identity } from '../../domain/identity'
import type { JmapIdentity } from '../../jmap/types'

function toDomainAddressList(
  raw: readonly { name: string | null; email: string }[] | null,
): readonly EmailAddress[] | null {
  if (raw === null) return null
  return raw.map((addr) => emailAddress(addr.name, addr.email))
}

/**
 * Maps a JmapIdentity into a Domain Identity. Returns null instead of
 * throwing so one malformed record cannot abort an entire sync batch —
 * see to-domain-email.ts for the same discipline.
 */
export function toDomainIdentity(
  accountKey: AccountKey,
  raw: JmapIdentity,
): Identity | null {
  try {
    return identity({
      id: scopedIdentityId(accountKey, jmapIdentityIdFromString(raw.id)),
      name: raw.name,
      email: raw.email,
      replyTo: toDomainAddressList(raw.replyTo),
      bcc: toDomainAddressList(raw.bcc),
    })
  } catch (err: unknown) {
    console.warn(
      `[mappers] Skipping identity ${raw.id}: failed Domain validation`,
      err,
    )
    return null
  }
}
