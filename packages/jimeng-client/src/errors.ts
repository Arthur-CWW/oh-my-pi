export type JimengErrorCategory =
  | "auth"
  | "risk_control"
  | "rate_limit"
  | "validation"
  | "transport"
  | "upstream"
  | "timeout"

export interface JimengErrorDetails {
  [key: string]: unknown
}

export class JimengError extends Error {
  readonly category: JimengErrorCategory
  readonly code: string
  readonly retryable: boolean
  readonly details?: JimengErrorDetails

  constructor(input: {
    category: JimengErrorCategory
    code: string
    message: string
    retryable: boolean
    details?: JimengErrorDetails
  }) {
    super(input.message)
    this.name = "JimengError"
    this.category = input.category
    this.code = input.code
    this.retryable = input.retryable
    this.details = input.details
  }

  toJSON() {
    return {
      category: this.category,
      code: this.code,
      message: this.message,
      retryable: this.retryable,
      ...(this.details ? { details: this.details } : {}),
    }
  }
}

export function jimengError(input: ConstructorParameters<typeof JimengError>[0]): JimengError {
  return new JimengError(input)
}
