import type { EmailAddressList } from './address'
import type { ScopedIdentityId } from './ids'

export type Identity = Readonly<{
  id: ScopedIdentityId
  name: string
  email: string
  replyTo: EmailAddressList
  bcc: EmailAddressList
}>

function snapshotAddressList(value: EmailAddressList): EmailAddressList {
  return value === null ? null : [...value]
}

export function identity(input: Identity): Identity {
  if (input.email.length === 0) {
    throw new TypeError('Identity email must not be empty')
  }

  return {
    id: input.id,
    name: input.name,
    email: input.email,
    replyTo: snapshotAddressList(input.replyTo),
    bcc: snapshotAddressList(input.bcc),
  }
}

export function isWildcardIdentity(value: Identity): boolean {
  return value.email.startsWith('*@')
}
