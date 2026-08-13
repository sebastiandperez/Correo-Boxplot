import { defineStore } from 'pinia'

export type LocalState = 'opening' | 'ready' | 'error'
export type AuthState =
  'anonymous' | 'authenticating' | 'authenticated' | 'expired'
export type ConnectivityState = 'online' | 'offline'

export const useRuntimeStore = defineStore('runtime', {
  state: () => ({
    local: 'opening' as LocalState,
    auth: 'anonymous' as AuthState,
    connectivity: 'offline' as ConnectivityState,
  }),
})
