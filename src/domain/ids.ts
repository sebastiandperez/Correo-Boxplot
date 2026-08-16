declare const opaqueIdBrand: unique symbol

type OpaqueId<Tag extends string> = string & {
  readonly [opaqueIdBrand]: Tag
}

export type AccountKey = OpaqueId<'AccountKey'>
export type ServiceKey = OpaqueId<'ServiceKey'>
export type MutationId = OpaqueId<'MutationId'>

export type JmapAccountId = OpaqueId<'JmapAccountId'>
export type JmapMailboxId = OpaqueId<'JmapMailboxId'>
export type JmapEmailId = OpaqueId<'JmapEmailId'>
export type JmapIdentityId = OpaqueId<'JmapIdentityId'>
export type JmapThreadId = OpaqueId<'JmapThreadId'>
export type JmapBlobId = OpaqueId<'JmapBlobId'>

type ScopedId<JmapId extends string> = Readonly<{
  accountKey: AccountKey
  jmapId: JmapId
}>

export type ScopedMailboxId = ScopedId<JmapMailboxId>
export type ScopedEmailId = ScopedId<JmapEmailId>
export type ScopedIdentityId = ScopedId<JmapIdentityId>
export type ScopedThreadId = ScopedId<JmapThreadId>
export type ScopedBlobId = ScopedId<JmapBlobId>

function opaqueIdFromString<Tag extends string>(
  value: string,
  typeName: string,
): OpaqueId<Tag> {
  if (value.length === 0) {
    throw new TypeError(`${typeName} must not be empty`)
  }

  return value as OpaqueId<Tag>
}

export function accountKeyFromString(value: string): AccountKey {
  return opaqueIdFromString<'AccountKey'>(value, 'AccountKey')
}

export function serviceKeyFromString(value: string): ServiceKey {
  return opaqueIdFromString<'ServiceKey'>(value, 'ServiceKey')
}

export function mutationIdFromString(value: string): MutationId {
  return opaqueIdFromString<'MutationId'>(value, 'MutationId')
}

export function jmapAccountIdFromString(value: string): JmapAccountId {
  return opaqueIdFromString<'JmapAccountId'>(value, 'JmapAccountId')
}

export function jmapMailboxIdFromString(value: string): JmapMailboxId {
  return opaqueIdFromString<'JmapMailboxId'>(value, 'JmapMailboxId')
}

export function jmapEmailIdFromString(value: string): JmapEmailId {
  return opaqueIdFromString<'JmapEmailId'>(value, 'JmapEmailId')
}

export function jmapIdentityIdFromString(value: string): JmapIdentityId {
  return opaqueIdFromString<'JmapIdentityId'>(value, 'JmapIdentityId')
}

export function jmapThreadIdFromString(value: string): JmapThreadId {
  return opaqueIdFromString<'JmapThreadId'>(value, 'JmapThreadId')
}

export function jmapBlobIdFromString(value: string): JmapBlobId {
  return opaqueIdFromString<'JmapBlobId'>(value, 'JmapBlobId')
}

export function scopedMailboxId(
  accountKey: AccountKey,
  jmapId: JmapMailboxId,
): ScopedMailboxId {
  return { accountKey, jmapId }
}

export function scopedEmailId(
  accountKey: AccountKey,
  jmapId: JmapEmailId,
): ScopedEmailId {
  return { accountKey, jmapId }
}

export function scopedIdentityId(
  accountKey: AccountKey,
  jmapId: JmapIdentityId,
): ScopedIdentityId {
  return { accountKey, jmapId }
}

export function scopedThreadId(
  accountKey: AccountKey,
  jmapId: JmapThreadId,
): ScopedThreadId {
  return { accountKey, jmapId }
}

export function scopedBlobId(
  accountKey: AccountKey,
  jmapId: JmapBlobId,
): ScopedBlobId {
  return { accountKey, jmapId }
}

function sameScopedId<JmapId extends string>(
  left: ScopedId<JmapId>,
  right: ScopedId<JmapId>,
): boolean {
  return left.accountKey === right.accountKey && left.jmapId === right.jmapId
}

export function sameScopedMailboxId(
  left: ScopedMailboxId,
  right: ScopedMailboxId,
): boolean {
  return sameScopedId(left, right)
}

export function sameScopedEmailId(
  left: ScopedEmailId,
  right: ScopedEmailId,
): boolean {
  return sameScopedId(left, right)
}

export function sameScopedIdentityId(
  left: ScopedIdentityId,
  right: ScopedIdentityId,
): boolean {
  return sameScopedId(left, right)
}

export function sameScopedThreadId(
  left: ScopedThreadId,
  right: ScopedThreadId,
): boolean {
  return sameScopedId(left, right)
}

export function sameScopedBlobId(
  left: ScopedBlobId,
  right: ScopedBlobId,
): boolean {
  return sameScopedId(left, right)
}
