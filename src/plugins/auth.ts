import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { HttpError } from '../lib/errors.js';

export const API_KEY_HEADER = 'x-api-key';

const digest = (s: string) => createHash('sha256').update(s).digest();

/** Constant-time comparison of a presented key against the configured keys. */
export function isValidApiKey(presented: string | undefined, keys: readonly Buffer[]): boolean {
  if (!presented) return false;
  const d = digest(presented);
  let ok = false;
  for (const k of keys) ok = timingSafeEqual(d, k) || ok;
  return ok;
}

/** Returns a Fastify preHandler that requires a valid `x-api-key` header. */
export function apiKeyGuard(apiKeys: readonly string[]) {
  const hashed = apiKeys.map(digest);
  return async function requireApiKey(request: FastifyRequest, _reply: FastifyReply): Promise<void> {
    if (hashed.length === 0) {
      throw new HttpError(401, 'Write access is disabled: no API keys are configured on the server', 'UNAUTHORIZED');
    }
    const header = request.headers[API_KEY_HEADER];
    const presented = Array.isArray(header) ? header[0] : header;
    if (!isValidApiKey(presented, hashed)) {
      throw new HttpError(401, 'Missing or invalid API key', 'UNAUTHORIZED');
    }
  };
}
