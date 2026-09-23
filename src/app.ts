import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import type { TypeBoxTypeProvider } from '@fastify/type-provider-typebox';
import Fastify, { type FastifyError, type FastifyInstance, type preHandlerHookHandler } from 'fastify';
import type { Config } from './config.js';
import type { Db } from './db/pool.js';
import { fromPgError, HttpError } from './lib/errors.js';
import { apiKeyGuard } from './plugins/auth.js';
import { AgentRepository } from './repositories/agents.js';
import { ListingRepository } from './repositories/listings.js';
import { MediaRepository } from './repositories/media.js';
import { agentRoutes } from './routes/agents.js';
import { healthRoutes } from './routes/health.js';
import { listingRoutes } from './routes/listings.js';
import { mediaRoutes } from './routes/media.js';
import { ErrorResponse } from './schemas/common.js';
import { VERSION } from './version.js';

declare module 'fastify' {
  interface FastifyInstance {
    db: Db;
    repos: { listings: ListingRepository; agents: AgentRepository; media: MediaRepository };
    requireApiKey: preHandlerHookHandler;
  }
}

export type App = FastifyInstance;

export interface BuildAppOptions {
  config: Config;
  db: Db;
  logger?: boolean | object;
}

export async function buildApp({ config, db, logger }: BuildAppOptions) {
  const app = Fastify({
    logger: logger ?? { level: config.logLevel },
    ajv: { customOptions: { allErrors: false } },
    trustProxy: config.trustProxy,
  }).withTypeProvider<TypeBoxTypeProvider>();

  app.decorate('db', db);
  app.decorate('repos', {
    listings: new ListingRepository(db),
    agents: new AgentRepository(db),
    media: new MediaRepository(db),
  });
  app.decorate('requireApiKey', apiKeyGuard(config.apiKeys) as preHandlerHookHandler);
  app.addSchema(ErrorResponse);

  if (config.apiKeys.length === 0) {
    app.log.warn('API_KEYS is empty: write endpoints will reject all requests');
  }

  await app.register(swagger, {
    openapi: {
      openapi: '3.0.3',
      info: {
        title: 'Property Listing API',
        version: VERSION,
        description:
          'Open-source real estate listing API with search, filters and geo search. Write endpoints require an `x-api-key` header.',
        license: { name: 'MIT', url: 'https://opensource.org/licenses/MIT' },
      },
      tags: [
        { name: 'listings', description: 'Property listings' },
        { name: 'search', description: 'Geo search (radius, bounding box, polygon)' },
        { name: 'media', description: 'Listing photos, videos and floor plans' },
        { name: 'agents', description: 'Listing agents' },
        { name: 'health', description: 'Service health' },
      ],
      components: {
        securitySchemes: { ApiKeyAuth: { type: 'apiKey', in: 'header', name: 'x-api-key' } },
      },
    },
    refResolver: { buildLocalReference: (json, _base, _fragment, i) => (json.$id as string) ?? `def-${i}` },
  });

  if (config.docsEnabled) {
    await app.register(swaggerUi, { routePrefix: '/docs', staticCSP: true });
  }

  await app.register(helmet, (instance) => ({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        imgSrc: ["'self'", 'data:', 'https:'],
        scriptSrc: ["'self'", ...((instance as unknown as { swaggerCSP?: { script: string[] } }).swaggerCSP?.script ?? [])],
        styleSrc: ["'self'", 'https:', ...((instance as unknown as { swaggerCSP?: { style: string[] } }).swaggerCSP?.style ?? [])],
      },
    },
  }));

  await app.register(cors, {
    origin: config.corsOrigin,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'x-api-key'],
  });

  await app.register(rateLimit, {
    max: config.rateLimitMax,
    timeWindow: config.rateLimitWindow,
    allowList: (req) => req.url === '/health',
  });

  app.setErrorHandler((err: FastifyError, request, reply) => {
    if (err instanceof HttpError) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: statusText(err.statusCode),
        message: err.message,
        code: err.code,
      });
    }
    if (err.validation) {
      return reply.status(400).send({ statusCode: 400, error: 'Bad Request', message: err.message, code: 'VALIDATION_ERROR' });
    }
    const pgErr = fromPgError(err);
    if (pgErr) {
      request.log.info({ err }, 'database constraint error');
      return reply.status(pgErr.statusCode).send({
        statusCode: pgErr.statusCode,
        error: statusText(pgErr.statusCode),
        message: pgErr.message,
        code: pgErr.code,
      });
    }
    if (err.statusCode && err.statusCode < 500) {
      return reply.status(err.statusCode).send({
        statusCode: err.statusCode,
        error: statusText(err.statusCode),
        message: err.message,
        code: err.code,
      });
    }
    request.log.error({ err }, 'unhandled error');
    return reply.status(500).send({ statusCode: 500, error: 'Internal Server Error', message: 'Internal Server Error' });
  });

  app.setNotFoundHandler((request, reply) =>
    reply.status(404).send({ statusCode: 404, error: 'Not Found', message: `Route ${request.method} ${request.url} not found` }),
  );

  await app.register(healthRoutes);
  await app.register(listingRoutes, { prefix: '/v1/listings' });
  await app.register(mediaRoutes, { prefix: '/v1/listings' });
  await app.register(agentRoutes, { prefix: '/v1/agents' });

  return app;
}

function statusText(code: number): string {
  const map: Record<number, string> = {
    400: 'Bad Request',
    401: 'Unauthorized',
    403: 'Forbidden',
    404: 'Not Found',
    409: 'Conflict',
    413: 'Payload Too Large',
    415: 'Unsupported Media Type',
    429: 'Too Many Requests',
  };
  return map[code] ?? 'Error';
}
