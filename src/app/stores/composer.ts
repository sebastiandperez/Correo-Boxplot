import { defineStore } from 'pinia'

export type ComposerPhase = 'idle' | 'editing' | 'queueing' | 'error'

export interface ComposerState {
  isOpen: boolean
  to: string
  cc: string
  bcc: string
  subject: string
  body: string
  phase: ComposerPhase
  error: string | null
}

export const useComposerStore = defineStore('composer', {
  state: (): ComposerState => ({
    isOpen: false,
    to: '',
    cc: '',
    bcc: '',
    subject: '',
    body: '',
    phase: 'idle',
    error: null,
  }),

  getters: {
    canSend(state): boolean {
      return state.to.trim().length > 0 && state.phase !== 'queueing'
    },
  },

  actions: {
    open(initial?: { to?: string; subject?: string; body?: string }) {
      this.isOpen = true
      this.phase = 'editing'
      this.error = null
      this.to = initial?.to ?? ''
      this.cc = ''
      this.bcc = ''
      this.subject = initial?.subject ?? ''
      this.body = initial?.body ?? ''
    },

    close() {
      this.reset()
    },

    reset() {
      this.isOpen = false
      this.to = ''
      this.cc = ''
      this.bcc = ''
      this.subject = ''
      this.body = ''
      this.phase = 'idle'
      this.error = null
    },

    setPhase(phase: ComposerPhase, error: string | null = null) {
      this.phase = phase
      this.error = error
    },
  },
})
