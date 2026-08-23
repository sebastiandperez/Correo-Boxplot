type ExpiryListener = () => void

export class TokenManager {
  private currentToken: string | null = null
  private expirationTimer: ReturnType<typeof setTimeout> | null = null
  private listeners: Set<ExpiryListener> = new Set()

  /**
   * Sets the JMAP token in memory.
   * If expiresInSeconds is provided, a timer will proactively invalidate the token.
   */
  setToken(token: string, expiresInSeconds?: number): void {
    this.clearToken()
    this.currentToken = token

    if (expiresInSeconds !== undefined && expiresInSeconds > 0) {
      this.expirationTimer = setTimeout(() => {
        this.invalidate()
      }, expiresInSeconds * 1000)
    }
  }

  /**
   * Retrieves the current token.
   */
  getToken(): string | null {
    return this.currentToken
  }

  /**
   * Clears the token from memory without triggering expiration listeners.
   */
  clearToken(): void {
    this.currentToken = null
    if (this.expirationTimer) {
      clearTimeout(this.expirationTimer)
      this.expirationTimer = null
    }
  }

  /**
   * Force invalidates the token and notifies all subscribers.
   * Useful when an API call returns 401 Unauthorized.
   */
  invalidate(): void {
    this.clearToken()
    this.notifyExpired()
  }

  /**
   * Registers a callback to be invoked when the token expires or is invalidated.
   * @returns a cleanup function to unsubscribe.
   */
  onTokenExpired(callback: ExpiryListener): () => void {
    this.listeners.add(callback)
    return () => {
      this.listeners.delete(callback)
    }
  }

  private notifyExpired(): void {
    for (const listener of this.listeners) {
      try {
        listener()
      } catch (err) {
        console.error('Error in token expiry listener', err)
      }
    }
  }
}
