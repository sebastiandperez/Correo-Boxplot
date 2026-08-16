import { emailAddress, type EmailAddress } from './address'
import { isWildcardIdentity, type Identity } from './identity'
import type { ScopedIdentityId } from './ids'

export type SendBody = Readonly<{
  text: string
  html: string | null
}>

export type SendIntent = Readonly<{
  identityId: ScopedIdentityId
  from: EmailAddress
  replyTo: readonly EmailAddress[]
  to: readonly EmailAddress[]
  cc: readonly EmailAddress[]
  bcc: readonly EmailAddress[]
  subject: string
  body: SendBody
}>

type SendIntentInput = Readonly<{
  identity: Identity
  to: readonly EmailAddress[]
  cc: readonly EmailAddress[]
  bcc: readonly EmailAddress[]
  subject: string
  body: SendBody
}>

function containsUnsafeHeaderCharacter(value: string): boolean {
  return value.includes('\r') || value.includes('\n') || value.includes('\0')
}

function assertUsableOutboundAddress(address: EmailAddress): void {
  const atIndex = address.email.indexOf('@')

  if (
    address.email.length === 0 ||
    containsUnsafeHeaderCharacter(address.email) ||
    atIndex <= 0 ||
    atIndex === address.email.length - 1
  ) {
    throw new TypeError('Outbound email address is not usable')
  }

  if (address.name !== null && containsUnsafeHeaderCharacter(address.name)) {
    throw new TypeError('Outbound display name contains an unsafe character')
  }
}

function mergeBcc(
  userBcc: readonly EmailAddress[],
  defaultBcc: readonly EmailAddress[] | null,
): EmailAddress[] {
  const result: EmailAddress[] = []
  const seenEmails = new Set<string>()

  for (const address of [...userBcc, ...(defaultBcc ?? [])]) {
    if (!seenEmails.has(address.email)) {
      seenEmails.add(address.email)
      result.push(address)
    }
  }

  return result
}

export function sendIntent(input: SendIntentInput): SendIntent {
  if (isWildcardIdentity(input.identity)) {
    throw new TypeError('Wildcard Identity cannot be used for Send in the MVP')
  }

  const from = emailAddress(input.identity.name, input.identity.email)
  const replyTo =
    input.identity.replyTo === null ? [] : [...input.identity.replyTo]
  const to = [...input.to]
  const cc = [...input.cc]
  const bcc = mergeBcc(input.bcc, input.identity.bcc)

  if (to.length + cc.length + bcc.length === 0) {
    throw new TypeError('SendIntent requires an effective recipient')
  }

  for (const address of [from, ...replyTo, ...to, ...cc, ...bcc]) {
    assertUsableOutboundAddress(address)
  }

  return {
    identityId: input.identity.id,
    from,
    replyTo,
    to,
    cc,
    bcc,
    subject: input.subject,
    body: {
      text: input.body.text,
      html: input.body.html,
    },
  }
}
