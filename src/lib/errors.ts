export class HttpError extends Error {
  constructor(
    readonly statusCode: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const notFound = (what: string) => new HttpError(404, `${what} not found`, 'NOT_FOUND');

/** Maps PostgreSQL error codes to HTTP errors so constraint violations surface as 4xx, not 500. */
export function fromPgError(err: unknown): HttpError | undefined {
  const e = err as { code?: string; constraint?: string; detail?: string };
  switch (e?.code) {
    case '23505':
      return new HttpError(409, 'Resource already exists', 'CONFLICT');
    case '23503':
      return new HttpError(400, 'Referenced resource does not exist', 'INVALID_REFERENCE');
    case '23514':
      return new HttpError(400, 'Value violates a constraint', 'CONSTRAINT_VIOLATION');
    case '22P02':
    case '22023':
      return new HttpError(400, 'Invalid input', 'INVALID_INPUT');
    default:
      return undefined;
  }
}
