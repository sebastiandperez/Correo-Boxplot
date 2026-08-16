export type EmailAddress = Readonly<{
  name: string | null
  email: string
}>

export type EmailAddressList = readonly EmailAddress[] | null

export function emailAddress(name: string | null, email: string): EmailAddress {
  return { name, email }
}
