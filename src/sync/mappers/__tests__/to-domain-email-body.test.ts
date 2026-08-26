import { describe, it, expect } from 'vitest'
import { toDomainEmailBody } from '../to-domain-email-body'
import {
  accountKeyFromString,
  jmapEmailIdFromString,
  scopedEmailId,
} from '../../../domain/ids'

const emailId = scopedEmailId(
  accountKeyFromString('acc-1'),
  jmapEmailIdFromString('email-1'),
)

describe('toDomainEmailBody', () => {
  it('maps text+html content through', () => {
    const body = toDomainEmailBody(emailId, {
      kind: 'plain',
      text: 'hello',
      html: '<p>hello</p>',
    })

    expect(body).toEqual({ emailId, text: 'hello', html: '<p>hello</p>' })
  })

  it('preserves valid null/null as a complete cached body', () => {
    const body = toDomainEmailBody(emailId, {
      kind: 'plain',
      text: null,
      html: null,
    })

    expect(body).toEqual({ emailId, text: null, html: null })
  })
})
