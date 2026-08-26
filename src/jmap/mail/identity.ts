import type { JamClient } from 'jmap-jam'
import type { JmapIdentitiesResult, JmapEmailAddress } from '../types'
import { throwJmapRequestError } from '../errors'

interface RawJmapIdentity {
  id: string
  name: string
  email: string
  replyTo: JmapEmailAddress[] | null
  bcc: JmapEmailAddress[] | null
  textSignature: string
  htmlSignature: string
}

export async function getIdentities(
  jam: JamClient,
  accountId: string,
): Promise<JmapIdentitiesResult> {
  let response
  try {
    const [result] = await jam.request([
      'Identity/get',
      {
        accountId,
      },
    ])
    response = result
  } catch (err: unknown) {
    throwJmapRequestError('Identity/get', err)
  }

  const list = (response.list || []) as unknown as RawJmapIdentity[]

  const identities = list.map((raw) => {
    const mapAddresses = (
      rawAddrs: readonly JmapEmailAddress[] | null | undefined,
    ) => {
      if (!rawAddrs || rawAddrs.length === 0) return null
      return Object.freeze(
        rawAddrs.map((addr) =>
          Object.freeze({ name: addr.name, email: addr.email }),
        ),
      )
    }

    return Object.freeze({
      id: raw.id,
      name: raw.name || '',
      email: raw.email || '',
      replyTo: mapAddresses(raw.replyTo),
      bcc: mapAddresses(raw.bcc),
      textSignature: raw.textSignature || '',
      htmlSignature: raw.htmlSignature || '',
    })
  })

  return {
    identities,
    state: (response.state as string | undefined) ?? '',
  }
}
