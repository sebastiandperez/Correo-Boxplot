import { defineStore } from 'pinia'

export type AccountSetupProfile = 'boxplotLocalImap'
export type AccountSetupPhase = 'idle' | 'validating'

export type AccountSetupRequest = Readonly<{
  profile: 'boxplotLocalImap'
  username: string
  password: string
  host: string
  imapPort: number
  smtpPort: number
}>

export type AccountSetupBuildResult =
  | Readonly<{ ok: true; value: AccountSetupRequest }>
  | Readonly<{ ok: false; error: string }>

export interface AccountSetupState {
  profile: AccountSetupProfile
  username: string
  password: string
  host: string
  port: string
  phase: AccountSetupPhase
  error: string | null
}

export const BOXPLOT_LOCAL_IMAP_HOST = '127.0.0.1'
export const BOXPLOT_LOCAL_IMAP_PORT = '1143'
export const BOXPLOT_LOCAL_SMTP_PORT = 1587

function initialState(): AccountSetupState {
  return {
    profile: 'boxplotLocalImap',
    username: '',
    password: '',
    host: BOXPLOT_LOCAL_IMAP_HOST,
    port: BOXPLOT_LOCAL_IMAP_PORT,
    phase: 'idle',
    error: null,
  }
}

function parseImapPort(value: string): number | null {
  if (!/^\d+$/.test(value)) return null
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 65_535) {
    return null
  }
  return parsed
}

export const useAccountSetupStore = defineStore('accountSetup', {
  state: initialState,

  getters: {
    smtpPort: (): number => BOXPLOT_LOCAL_SMTP_PORT,
    smtpEndpoint: (state): string => `${state.host}:${BOXPLOT_LOCAL_SMTP_PORT}`,
  },

  actions: {
    setProfile(profile: AccountSetupProfile) {
      this.profile = profile
      this.host = BOXPLOT_LOCAL_IMAP_HOST
      this.port = BOXPLOT_LOCAL_IMAP_PORT
      this.error = null
    },

    setUsername(value: string) {
      this.username = value
      this.error = null
    },

    setPassword(value: string) {
      this.password = value
      this.error = null
    },

    setHost(value: string) {
      this.host = value
      this.error = null
    },

    setPort(value: string) {
      this.port = value
      this.error = null
    },

    validate(): boolean {
      this.phase = 'validating'
      this.error = null

      if (this.username.length === 0) {
        this.error = 'El usuario es obligatorio.'
      } else if (this.password.length === 0) {
        this.error = 'La contraseña es obligatoria.'
      } else if (this.host.length === 0) {
        this.error = 'El servidor es obligatorio.'
      } else if (this.port.length === 0) {
        this.error = 'El puerto IMAP es obligatorio.'
      } else if (parseImapPort(this.port) === null) {
        this.error = 'El puerto IMAP debe ser un entero entre 1 y 65535.'
      }

      this.phase = 'idle'
      return this.error === null
    },

    buildRequest(): AccountSetupBuildResult {
      if (!this.validate()) {
        return { ok: false, error: this.error ?? 'Configuración inválida.' }
      }

      const imapPort = parseImapPort(this.port)
      if (imapPort === null) {
        return { ok: false, error: 'Configuración inválida.' }
      }

      return {
        ok: true,
        value: {
          profile: this.profile,
          username: this.username,
          password: this.password,
          host: this.host,
          imapPort,
          smtpPort: BOXPLOT_LOCAL_SMTP_PORT,
        },
      }
    },

    clearSensitive() {
      this.password = ''
    },

    reset() {
      Object.assign(this, initialState())
    },
  },
})
