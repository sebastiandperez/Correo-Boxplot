import { openUrl } from '@tauri-apps/plugin-opener'

export function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export async function openSafeExternalUrl(value: string): Promise<boolean> {
  if (!isAllowedExternalUrl(value)) return false
  await openUrl(value)
  return true
}
