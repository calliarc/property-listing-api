import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound } from '../lib/errors.js';
import { errorResponses, IdParams } from '../schemas/common.js';
import { Media, MediaCreate, MediaParams, MediaUpdate } from '../schemas/media.js';

const security = [{ ApiKeyAuth: [] }];

export const mediaRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const { media, listings } = app.repos;

  app.get(
    '/:id/media',
    {
      schema: {
        tags: ['media'],
        summary: 'List media for a listing',
        params: IdParams,
        response: { 200: Type.Object({ data: Type.Array(Media) }), 404: errorResponses[404] },
      },
    },
    async (req) => {
      if (!(await listings.exists(req.params.id))) throw notFound('Listing');
      return { data: await media.listForListing(req.params.id) };
    },
  );

  app.post(
    '/:id/media',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['media'],
        summary: 'Attach media (by URL) to a listing',
        security,
        params: IdParams,
        body: MediaCreate,
        response: { 201: Media, 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req, reply) => {
      if (!(await listings.exists(req.params.id))) throw notFound('Listing');
      return reply.status(201).send(await media.create(req.params.id, req.body));
    },
  );

  app.patch(
    '/:id/media/:mediaId',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['media'],
        summary: 'Update a media item',
        security,
        params: MediaParams,
        body: MediaUpdate,
        response: { 200: Media, 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req) => {
      const item = await media.update(req.params.id, req.params.mediaId, req.body);
      if (!item) throw notFound('Media');
      return item;
    },
  );

  app.delete(
    '/:id/media/:mediaId',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['media'],
        summary: 'Delete a media item',
        security,
        params: MediaParams,
        response: { 204: Type.Null(), 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req, reply) => {
      if (!(await media.delete(req.params.id, req.params.mediaId))) throw notFound('Media');
      return reply.status(204).send(null);
    },
  );
};
