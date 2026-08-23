import type { JamClient } from 'jmap-jam'
import type { JmapIdentity, JmapEmailAddress } from '../types'
import { JmapMethodError } from '../errors'

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
): Promise<JmapIdentity[]> {
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
    throw new JmapMethodError(
      'Identity/get',
      'networkOrServerFail',
      err instanceof Error ? err.message : String(err),
    )
  }

  const list = (response.list || []) as unknown as RawJmapIdentity[]

  return list.map((raw) => {
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
}
