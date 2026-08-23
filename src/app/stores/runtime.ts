import { defineStore } from 'pinia'

export type LocalState = 'opening' | 'ready' | 'error'
export type AuthState =
  'anonymous' | 'authenticating' | 'authenticated' | 'expired'
export type ConnectivityState = 'online' | 'offline'

export interface RuntimeState {
  local: LocalState
  auth: AuthState
  connectivity: ConnectivityState
}

export const useRuntimeStore = defineStore('runtime', {
  state: (): RuntimeState => ({
    local: 'opening',
    auth: 'anonymous',
    connectivity: 'offline',
  }),

  getters: {
    isLocalReady: (state): boolean => state.local === 'ready',
    isOnline: (state): boolean => state.connectivity === 'online',
    isAuthenticated: (state): boolean => state.auth === 'authenticated',
    /**
     * LocalReady + RemoteAnonymous is explicitly valid per Architecture Gate 0-C.
     * The app can run offline reading cached local SQLite database without active remote session.
     */
    isLocalReadyAndAnonymous: (state): boolean =>
      state.local === 'ready' && state.auth === 'anonymous',
  },

  actions: {
    setLocal(status: LocalState) {
      this.local = status
    },
    setAuth(status: AuthState) {
      this.auth = status
    },
    setConnectivity(status: ConnectivityState) {
      this.connectivity = status
    },
    reset() {
      this.local = 'opening'
      this.auth = 'anonymous'
      this.connectivity = 'offline'
    },
  },
})
