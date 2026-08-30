import { emailBody } from '../domain/email-body'
import type { Email } from '../domain/email'
import type { ScopedEmailId } from '../domain/ids'
import type { E2eePort } from '../e2ee/port'
import type { ReadRepository } from '../ports/read-repository'
import type { SyncPort } from '../ports/sync-port'
import {
  RemoteBodySourceError,
  type RemoteBodyFetch,
  type RemoteBodySource,
} from '../remote/body-source'
import { remoteEmailId } from '../remote/compat/domain-ids'
import { parseBoxplotE2eeEnvelope } from '../remote/mime/boxplot-e2ee'
import { BodyMaterializationError } from './body-materialization-errors'

export type BodyMaterializationResult = 'alreadyCached' | 'materialized'

export interface BodyMaterializer {
  materialize(emailId: ScopedEmailId): Promise<BodyMaterializationResult>
}

export type BodyMaterializerDependencies = Readonly<{
  readRepository: ReadRepository
  syncPort: SyncPort
  remoteBodySource: RemoteBodySource
  e2eePort: E2eePort
}>

type ExpectedE2eeMetadata = Readonly<{
  localIdentity: string
  expectedSender: string
  expectedRecipient: string
  expectedSubject: string
}>

export class DefaultBodyMaterializer implements BodyMaterializer {
  private readonly inFlight = new Map<
    string,
    Promise<BodyMaterializationResult>
  >()

  constructor(private readonly dependencies: BodyMaterializerDependencies) {}

  materialize(emailId: ScopedEmailId): Promise<BodyMaterializationResult> {
    const key = `${emailId.accountKey}\u0000${emailId.jmapId}`
    const current = this.inFlight.get(key)
    if (current !== undefined) return current

    const operation = this.materializeOnce(emailId).finally(() => {
      if (this.inFlight.get(key) === operation) this.inFlight.delete(key)
    })
    this.inFlight.set(key, operation)
    return operation
  }

  private async materializeOnce(
    emailId: ScopedEmailId,
  ): Promise<BodyMaterializationResult> {
    try {
      const cached =
        await this.dependencies.readRepository.readEmailBody(emailId)
      if (!cached.ok) throw new BodyMaterializationError('local')
      if (cached.value.kind === 'ownerAbsent') {
        throw new BodyMaterializationError('emailAbsent')
      }
      if (cached.value.kind === 'cached') return 'alreadyCached'

      const fetched = await this.dependencies.remoteBodySource.fetchBody(
        emailId.accountKey,
        remoteEmailId(emailId),
      )
      const body =
        fetched.body.kind === 'plain'
          ? emailBody({
              emailId,
              text: fetched.body.text,
              html: fetched.body.html,
            })
          : await this.decryptBody(emailId, fetched)

      fetched.assertCurrent()
      const written = await this.dependencies.syncPort.cacheEmailBody(body)
      if (!written.ok) {
        throw new BodyMaterializationError(
          written.error.kind === 'conflict' ? 'emailAbsent' : 'local',
        )
      }
      return 'materialized'
    } catch (error: unknown) {
      if (error instanceof BodyMaterializationError) throw error
      if (error instanceof RemoteBodySourceError) {
        throw new BodyMaterializationError(error.kind)
      }
      throw new BodyMaterializationError('unexpected')
    }
  }

  private async decryptBody(emailId: ScopedEmailId, fetched: RemoteBodyFetch) {
    const metadata = await this.resolveExpectedMetadata(emailId)
    let envelope
    try {
      if (fetched.body.kind !== 'boxplotE2ee') {
        throw new TypeError('Expected encrypted body')
      }
      envelope = parseBoxplotE2eeEnvelope(fetched.body.payload)
    } catch {
      throw new BodyMaterializationError('invalidEnvelope')
    }

    const decrypted = await this.dependencies.e2eePort.decryptFrom({
      ...metadata,
      envelope,
    })
    if (!decrypted.ok) {
      throw new BodyMaterializationError('e2ee', decrypted.error.kind)
    }
    return emailBody({
      emailId,
      text: decrypted.value.text,
      html: decrypted.value.html,
    })
  }

  private async resolveExpectedMetadata(
    emailId: ScopedEmailId,
  ): Promise<ExpectedE2eeMetadata> {
    const emailResult =
      await this.dependencies.readRepository.readEmail(emailId)
    if (!emailResult.ok) throw new BodyMaterializationError('local')
    if (emailResult.value.kind === 'absent') {
      throw new BodyMaterializationError('emailAbsent')
    }

    const email = emailResult.value.value
    const expectedSender = singleAddress(email.from)
    const expectedRecipient = singleAddress(email.to)
    if (
      expectedSender === null ||
      expectedRecipient === null ||
      !isEmptyAddressList(email.cc) ||
      !isEmptyAddressList(email.bcc) ||
      email.subject === null
    ) {
      throw new BodyMaterializationError('metadataUnavailable')
    }

    return this.resolveLocalIdentity(email, expectedSender, expectedRecipient)
  }

  private async resolveLocalIdentity(
    email: Email,
    expectedSender: string,
    expectedRecipient: string,
  ): Promise<ExpectedE2eeMetadata> {
    const identities = await this.dependencies.readRepository.listIdentities(
      email.id.accountKey,
    )
    if (!identities.ok) throw new BodyMaterializationError('local')
    if (identities.value.kind === 'ownerAbsent') {
      throw new BodyMaterializationError('metadataUnavailable')
    }
    const matchingEmails = new Set(
      identities.value.value
        .map((value) => value.email)
        .filter((value) => value === expectedRecipient),
    )
    if (matchingEmails.size !== 1) {
      throw new BodyMaterializationError('metadataUnavailable')
    }
    return {
      localIdentity: expectedRecipient,
      expectedSender,
      expectedRecipient,
      expectedSubject: email.subject ?? failMetadata(),
    }
  }
}

function singleAddress(value: Email['from'] | Email['to']): string | null {
  return value !== null && value.length === 1 ? value[0].email : null
}

function isEmptyAddressList(value: Email['cc'] | Email['bcc']): boolean {
  return value === null || value.length === 0
}

function failMetadata(): never {
  throw new BodyMaterializationError('metadataUnavailable')
}

export { BodyMaterializationError } from './body-materialization-errors'
