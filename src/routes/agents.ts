import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound } from '../lib/errors.js';
import { Agent, AgentCreate, AgentListQuery, AgentUpdate } from '../schemas/agent.js';
import { errorResponses, IdParams, Paginated } from '../schemas/common.js';

const security = [{ ApiKeyAuth: [] }];

export const agentRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const repo = app.repos.agents;

  app.get(
    '',
    {
      schema: {
        tags: ['agents'],
        summary: 'List agents',
        querystring: AgentListQuery,
        response: { 200: Paginated(Agent), 400: errorResponses[400] },
      },
    },
    async (req) => repo.list(req.query),
  );

  app.get(
    '/:id',
    {
      schema: { tags: ['agents'], summary: 'Get an agent', params: IdParams, response: { 200: Agent, 404: errorResponses[404] } },
    },
    async (req) => {
      const agent = await repo.findById(req.params.id);
      if (!agent) throw notFound('Agent');
      return agent;
    },
  );

  app.post(
    '',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['agents'],
        summary: 'Create an agent',
        security,
        body: AgentCreate,
        response: { 201: Agent, 400: errorResponses[400], 401: errorResponses[401], 409: errorResponses[409] },
      },
    },
    async (req, reply) => {
      const agent = await repo.create(req.body);
      return reply.status(201).header('location', `/v1/agents/${agent.id}`).send(agent);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['agents'],
        summary: 'Update an agent (partial)',
        security,
        params: IdParams,
        body: AgentUpdate,
        response: {
          200: Agent,
          400: errorResponses[400],
          401: errorResponses[401],
          404: errorResponses[404],
          409: errorResponses[409],
        },
      },
    },
    async (req) => {
      const agent = await repo.update(req.params.id, req.body);
      if (!agent) throw notFound('Agent');
      return agent;
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['agents'],
        summary: 'Delete an agent (their listings are kept, agent_id set to null)',
        security,
        params: IdParams,
        response: { 204: Type.Null(), 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req, reply) => {
      if (!(await repo.delete(req.params.id))) throw notFound('Agent');
      return reply.status(204).send(null);
    },
  );
};
