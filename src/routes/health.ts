import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { VERSION } from '../version.js';

export const healthRoutes: FastifyPluginAsyncTypebox = async (app) => {
  app.get(
    '/health',
    {
      schema: {
        tags: ['health'],
        summary: 'Liveness and database check',
        response: {
          200: Type.Object({ status: Type.Literal('ok'), version: Type.String(), database: Type.Literal('up') }),
          503: Type.Object({ status: Type.Literal('degraded'), version: Type.String(), database: Type.Literal('down') }),
        },
      },
    },
    async (_req, reply) => {
      try {
        await app.db.query('SELECT 1');
        return { status: 'ok' as const, version: VERSION, database: 'up' as const };
      } catch (err) {
        app.log.error({ err }, 'health check failed');
        return reply.status(503).send({ status: 'degraded' as const, version: VERSION, database: 'down' as const });
      }
    },
  );
};
