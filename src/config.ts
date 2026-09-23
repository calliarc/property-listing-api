export interface Config {
  host: string;
  port: number;
  databaseUrl: string;
  dbPoolMax: number;
  apiKeys: string[];
  corsOrigin: boolean | string[];
  rateLimitMax: number;
  rateLimitWindow: string;
  logLevel: string;
  docsEnabled: boolean;
  trustProxy: boolean;
}

function int(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === '') return fallback;
  const n = Number.parseInt(value, 10);
  if (!Number.isFinite(n)) throw new Error(`Expected an integer, got "${value}"`);
  return n;
}

function list(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Parses CORS_ORIGIN: empty -> disabled, "*" -> any origin, otherwise a comma-separated allow list. */
export function parseCorsOrigin(value: string | undefined): boolean | string[] {
  const origins = list(value);
  if (origins.length === 0) return false;
  if (origins.includes('*')) return true;
  // Always an array so non-matching origins get no Access-Control-Allow-Origin header.
  return origins;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    host: env.HOST ?? '0.0.0.0',
    port: int(env.PORT, 3000),
    databaseUrl: env.DATABASE_URL ?? 'postgres://postgres:postgres@localhost:5432/property_listing',
    dbPoolMax: int(env.DB_POOL_MAX, 10),
    apiKeys: list(env.API_KEYS),
    corsOrigin: parseCorsOrigin(env.CORS_ORIGIN),
    rateLimitMax: int(env.RATE_LIMIT_MAX, 100),
    rateLimitWindow: env.RATE_LIMIT_WINDOW ?? '1 minute',
    logLevel: env.LOG_LEVEL ?? 'info',
    docsEnabled: (env.DOCS_ENABLED ?? 'true').toLowerCase() !== 'false',
    // Only enable behind a trusted reverse proxy; otherwise clients could spoof X-Forwarded-For to dodge rate limits.
    trustProxy: (env.TRUST_PROXY ?? 'false').toLowerCase() === 'true',
  };
}
