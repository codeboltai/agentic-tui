export class AgenticTuiError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'AgenticTuiError';
  }
}

export function errorCode(error: unknown): string {
  return error instanceof AgenticTuiError ? error.code : 'INTERNAL_ERROR';
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
