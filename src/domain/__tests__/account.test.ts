import { describe, expect, it } from 'vitest'

import { account, remoteAccountRef, sameRemoteAccountRef } from '../account'
import {
  accountKeyFromString,
  jmapAccountIdFromString,
  serviceKeyFromString,
} from '../ids'

describe('RemoteAccountRef', () => {
  const serviceOne = serviceKeyFromString('service-1')
  const serviceTwo = serviceKeyFromString('service-2')
  const accountA = jmapAccountIdFromString('account-a')
  const accountB = jmapAccountIdFromString('account-b')

  it('compares both ServiceKey and JmapAccountId', () => {
    expect(
      sameRemoteAccountRef(
        remoteAccountRef(serviceOne, accountA),
        remoteAccountRef(serviceOne, accountA),
      ),
    ).toBe(true)
    expect(
      sameRemoteAccountRef(
        remoteAccountRef(serviceOne, accountA),
        remoteAccountRef(serviceOne, accountB),
      ),
    ).toBe(false)
    expect(
      sameRemoteAccountRef(
        remoteAccountRef(serviceOne, accountA),
        remoteAccountRef(serviceTwo, accountA),
      ),
    ).toBe(false)
  })
})

describe('Account', () => {
  it('contains only its local key and required remote binding', () => {
    const key = accountKeyFromString('local-account')
    const remoteRef = remoteAccountRef(
      serviceKeyFromString('service'),
      jmapAccountIdFromString('remote-account'),
    )

    expect(account(key, remoteRef)).toEqual({ key, remoteRef })
  })
})
