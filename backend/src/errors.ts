export class LabError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'LabError'
  }
}

export function errorResponse(error: unknown) {
  if (error instanceof LabError) {
    return {
      statusCode: error.statusCode,
      body: {
        error: {
          code: error.code,
          message: error.message,
          retryable: error.retryable,
          ...(error.details ? { details: error.details } : {}),
        },
      },
    }
  }

  return {
    statusCode: 500,
    body: { error: { code: 'internal_error', message: 'Lab 服务发生未知错误', retryable: true } },
  }
}
