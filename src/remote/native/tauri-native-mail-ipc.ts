import { invoke } from '@tauri-apps/api/core'

import { NativeMailIpcClient } from './native-mail-ipc-client'

export class TauriNativeMailIpc extends NativeMailIpcClient {
  constructor() {
    super(invoke)
  }
}
