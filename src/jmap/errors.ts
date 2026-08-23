export class JmapError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JmapError'
  }
}

export class JmapAuthError extends JmapError {
  constructor(message = 'Authentication failed or token expired') {
    super(message)
    this.name = 'JmapAuthError'
  }
}

export class JmapMethodError extends JmapError {
  constructor(
    public readonly method: string,
    public readonly type: string, // e.g. 'serverFail', 'unknownMethod', 'invalidArguments'
    message: string = `JMAP Method ${method} failed: ${type}`,
  ) {
    super(message)
    this.name = 'JmapMethodError'
  }
}

export class JmapStateError extends JmapError {
  constructor(
    message = 'State mismatch or cannot calculate changes',
  ) {
    super(message)
    this.name = 'JmapStateError'
  }
}

export class JmapNetworkError extends JmapError {
  constructor(message: string, public readonly originalError?: unknown) {
    super(message)
    this.name = 'JmapNetworkError'
  }
}

export class JmapSubmissionError extends JmapError {
  constructor(
    public readonly type: string, // e.g. 'tooLarge', 'rejected', 'forbidden'
    message: string = `Email submission failed: ${type}`,
  ) {
    super(message)
    this.name = 'JmapSubmissionError'
  }
}
