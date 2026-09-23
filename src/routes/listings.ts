import type { FastifyPluginAsyncTypebox } from '@fastify/type-provider-typebox';
import { Type } from 'typebox';
import { notFound } from '../lib/errors.js';
import { parseBbox } from '../lib/listing-query.js';
import { toFeatureCollection } from '../lib/serialize.js';
import { errorResponses, IdParams } from '../schemas/common.js';
import {
  BboxQuery,
  Listing,
  ListingCreate,
  ListingListQuery,
  ListingSearchResponse,
  ListingUpdate,
  PolygonBody,
  RadiusQuery,
} from '../schemas/listing.js';
import type { PageMeta } from '../schemas/common.js';

const security = [{ ApiKeyAuth: [] }];

function respond(format: 'json' | 'geojson' | undefined, result: { data: Listing[]; meta: PageMeta }) {
  return format === 'geojson' ? toFeatureCollection(result.data, result.meta) : result;
}

export const listingRoutes: FastifyPluginAsyncTypebox = async (app) => {
  const repo = app.repos.listings;

  app.get(
    '',
    {
      schema: {
        tags: ['listings'],
        summary: 'List listings',
        description: 'Paginated list with filters (price, beds, baths, sqft, property type, status, agent, city) and sorting.',
        querystring: ListingListQuery,
        response: { 200: ListingSearchResponse, 400: errorResponses[400] },
      },
    },
    async (req) => respond(req.query.format, await repo.search(req.query)),
  );

  app.get(
    '/search/radius',
    {
      schema: {
        tags: ['search'],
        summary: 'Radius search',
        description: 'Listings within `radius` meters of `lat`,`lng` (ST_DWithin on geography). Sorted by distance by default.',
        querystring: RadiusQuery,
        response: { 200: ListingSearchResponse, 400: errorResponses[400] },
      },
    },
    async (req) => {
      const { lat, lng, radius, ...filters } = req.query;
      return respond(filters.format, await repo.search(filters, { kind: 'radius', lat, lng, radius }));
    },
  );

  app.get(
    '/search/bbox',
    {
      schema: {
        tags: ['search'],
        summary: 'Bounding box search',
        description: 'Listings inside `bbox=minLng,minLat,maxLng,maxLat` (ST_MakeEnvelope). Ideal for map viewports.',
        querystring: BboxQuery,
        response: { 200: ListingSearchResponse, 400: errorResponses[400] },
      },
    },
    async (req) => {
      const { bbox, ...filters } = req.query;
      return respond(filters.format, await repo.search(filters, parseBbox(bbox)));
    },
  );

  app.post(
    '/search/polygon',
    {
      schema: {
        tags: ['search'],
        summary: 'Polygon search',
        description:
          'Listings inside a GeoJSON Polygon or MultiPolygon (ST_GeomFromGeoJSON + ST_Within). Filters, sorting and pagination go in the query string. Read-only: no API key required.',
        querystring: ListingListQuery,
        body: PolygonBody,
        response: { 200: ListingSearchResponse, 400: errorResponses[400] },
      },
    },
    async (req) =>
      respond(req.query.format, await repo.search(req.query, { kind: 'polygon', geometry: req.body.geometry })),
  );

  app.get(
    '/:id',
    {
      schema: {
        tags: ['listings'],
        summary: 'Get a listing (includes media)',
        params: IdParams,
        response: { 200: Listing, 404: errorResponses[404] },
      },
    },
    async (req) => {
      const listing = await repo.findByIdWithMedia(req.params.id);
      if (!listing) throw notFound('Listing');
      return listing;
    },
  );

  app.post(
    '',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['listings'],
        summary: 'Create a listing',
        security,
        body: ListingCreate,
        response: { 201: Listing, 400: errorResponses[400], 401: errorResponses[401] },
      },
    },
    async (req, reply) => {
      const listing = await repo.create(req.body);
      return reply.status(201).header('location', `/v1/listings/${listing.id}`).send(listing);
    },
  );

  app.patch(
    '/:id',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['listings'],
        summary: 'Update a listing (partial)',
        security,
        params: IdParams,
        body: ListingUpdate,
        response: { 200: Listing, 400: errorResponses[400], 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req) => {
      const listing = await repo.update(req.params.id, req.body);
      if (!listing) throw notFound('Listing');
      return listing;
    },
  );

  app.delete(
    '/:id',
    {
      preHandler: app.requireApiKey,
      schema: {
        tags: ['listings'],
        summary: 'Delete a listing (and its media)',
        security,
        params: IdParams,
        response: { 204: Type.Null(), 401: errorResponses[401], 404: errorResponses[404] },
      },
    },
    async (req, reply) => {
      if (!(await repo.delete(req.params.id))) throw notFound('Listing');
      return reply.status(204).send(null);
    },
  );
};
