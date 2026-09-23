import { Type, type Static } from 'typebox';
import { Nullable, PaginationQuery, PageMeta, Uuid } from './common.js';
import { Media } from './media.js';

export const PROPERTY_TYPES = ['house', 'apartment', 'condo', 'townhouse', 'land', 'commercial'] as const;
export const LISTING_STATUSES = ['active', 'pending', 'sold', 'off_market'] as const;
export const LISTING_SORTS = [
  'created_at',
  '-created_at',
  'price',
  '-price',
  'beds',
  '-beds',
  'sqft',
  '-sqft',
  'distance',
] as const;

export type PropertyType = (typeof PROPERTY_TYPES)[number];
export type ListingStatus = (typeof LISTING_STATUSES)[number];
export type ListingSort = (typeof LISTING_SORTS)[number];

const PropertyTypeSchema = Type.Enum(PROPERTY_TYPES);
const StatusSchema = Type.Enum(LISTING_STATUSES);

/** Builds a regex for a comma-separated list of allowed values, e.g. "house,condo". */
function csvPattern(values: readonly string[]): string {
  const alt = values.join('|');
  return `^(${alt})(,(${alt}))*$`;
}

export const Location = Type.Object({
  lat: Type.Number({ minimum: -90, maximum: 90 }),
  lng: Type.Number({ minimum: -180, maximum: 180 }),
});

export const Address = Type.Object({
  line1: Type.String({ minLength: 1, maxLength: 200 }),
  line2: Type.Optional(Nullable(Type.String({ maxLength: 200 }))),
  city: Type.String({ minLength: 1, maxLength: 100 }),
  region: Type.Optional(Nullable(Type.String({ maxLength: 100, description: 'State / province / county' }))),
  postal_code: Type.Optional(Nullable(Type.String({ maxLength: 20 }))),
  country: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$', default: 'US', description: 'ISO 3166-1 alpha-2' })),
});

const listingFields = {
  agent_id: Type.Optional(Nullable(Uuid)),
  title: Type.String({ minLength: 1, maxLength: 200 }),
  description: Type.Optional(Nullable(Type.String({ maxLength: 10_000 }))),
  property_type: PropertyTypeSchema,
  status: Type.Optional(StatusSchema),
  price: Type.Number({ minimum: 0, maximum: 999_999_999_999 }),
  currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$', default: 'USD' })),
  beds: Type.Optional(Nullable(Type.Integer({ minimum: 0, maximum: 1000 }))),
  baths: Type.Optional(Nullable(Type.Number({ minimum: 0, maximum: 1000, multipleOf: 0.5 }))),
  sqft: Type.Optional(Nullable(Type.Integer({ minimum: 0 }))),
  year_built: Type.Optional(Nullable(Type.Integer({ minimum: 1600, maximum: 2100 }))),
  address: Address,
  location: Location,
};

export const ListingCreate = Type.Object(listingFields, { additionalProperties: false });
export type ListingCreate = Static<typeof ListingCreate>;

export const ListingUpdate = Type.Object(
  {
    agent_id: listingFields.agent_id,
    title: Type.Optional(listingFields.title),
    description: listingFields.description,
    property_type: Type.Optional(listingFields.property_type),
    status: listingFields.status,
    price: Type.Optional(listingFields.price),
    currency: Type.Optional(Type.String({ pattern: '^[A-Z]{3}$' })),
    beds: listingFields.beds,
    baths: listingFields.baths,
    sqft: listingFields.sqft,
    year_built: listingFields.year_built,
    address: Type.Optional(
      Type.Object(
        {
          line1: Type.Optional(Address.properties.line1),
          line2: Address.properties.line2,
          city: Type.Optional(Address.properties.city),
          region: Address.properties.region,
          postal_code: Address.properties.postal_code,
          country: Type.Optional(Type.String({ pattern: '^[A-Z]{2}$' })),
        },
        { additionalProperties: false },
      ),
    ),
    location: Type.Optional(Location),
  },
  { additionalProperties: false, minProperties: 1 },
);
export type ListingUpdate = Static<typeof ListingUpdate>;

export const Listing = Type.Object({
  id: Uuid,
  agent_id: Nullable(Uuid),
  title: Type.String(),
  description: Nullable(Type.String()),
  property_type: PropertyTypeSchema,
  status: StatusSchema,
  price: Type.Number(),
  currency: Type.String(),
  beds: Nullable(Type.Integer()),
  baths: Nullable(Type.Number()),
  sqft: Nullable(Type.Integer()),
  year_built: Nullable(Type.Integer()),
  address: Type.Object({
    line1: Type.String(),
    line2: Nullable(Type.String()),
    city: Type.String(),
    region: Nullable(Type.String()),
    postal_code: Nullable(Type.String()),
    country: Type.String(),
  }),
  location: Location,
  distance_m: Type.Optional(Type.Number({ description: 'Distance from the search point in meters (radius search only)' })),
  media: Type.Optional(Type.Array(Media)),
  created_at: Type.String({ format: 'date-time' }),
  updated_at: Type.String({ format: 'date-time' }),
});
export type Listing = Static<typeof Listing>;

export const ListingFilterQuery = {
  ...PaginationQuery,
  sort: Type.Optional(
    Type.Enum(LISTING_SORTS, {
      description: 'Sort field; prefix with "-" for descending. "distance" is only valid for radius search.',
    }),
  ),
  min_price: Type.Optional(Type.Number({ minimum: 0 })),
  max_price: Type.Optional(Type.Number({ minimum: 0 })),
  min_beds: Type.Optional(Type.Integer({ minimum: 0 })),
  max_beds: Type.Optional(Type.Integer({ minimum: 0 })),
  min_baths: Type.Optional(Type.Number({ minimum: 0 })),
  max_baths: Type.Optional(Type.Number({ minimum: 0 })),
  min_sqft: Type.Optional(Type.Integer({ minimum: 0 })),
  max_sqft: Type.Optional(Type.Integer({ minimum: 0 })),
  property_type: Type.Optional(
    Type.String({ pattern: csvPattern(PROPERTY_TYPES), description: `Comma-separated: ${PROPERTY_TYPES.join(', ')}` }),
  ),
  status: Type.Optional(
    Type.String({ pattern: csvPattern(LISTING_STATUSES), description: `Comma-separated: ${LISTING_STATUSES.join(', ')}` }),
  ),
  agent_id: Type.Optional(Uuid),
  city: Type.Optional(Type.String({ minLength: 1, maxLength: 100, description: 'Case-insensitive exact city match' })),
  format: Type.Optional(
    Type.Union([Type.Literal('json'), Type.Literal('geojson')], {
      default: 'json',
      description: '"geojson" returns a GeoJSON FeatureCollection for maps',
    }),
  ),
};

export const ListingListQuery = Type.Object(ListingFilterQuery);
export type ListingListQuery = Static<typeof ListingListQuery>;

export const RadiusQuery = Type.Object({
  ...ListingFilterQuery,
  lat: Type.Number({ minimum: -90, maximum: 90 }),
  lng: Type.Number({ minimum: -180, maximum: 180 }),
  radius: Type.Number({ exclusiveMinimum: 0, maximum: 200_000, description: 'Radius in meters (max 200 km)' }),
});
export type RadiusQuery = Static<typeof RadiusQuery>;

export const BboxQuery = Type.Object({
  ...ListingFilterQuery,
  bbox: Type.String({
    description: 'minLng,minLat,maxLng,maxLat (WGS84)',
    pattern: '^\\s*-?\\d+(\\.\\d+)?\\s*(,\\s*-?\\d+(\\.\\d+)?\\s*){3}$',
  }),
});
export type BboxQuery = Static<typeof BboxQuery>;

const Position = Type.Array(Type.Number(), { minItems: 2, maxItems: 3 });
const LinearRing = Type.Array(Position, { minItems: 4, maxItems: 10_000 });

export const PolygonGeometry = Type.Union([
  Type.Object({ type: Type.Literal('Polygon'), coordinates: Type.Array(LinearRing, { minItems: 1, maxItems: 100 }) }),
  Type.Object({
    type: Type.Literal('MultiPolygon'),
    coordinates: Type.Array(Type.Array(LinearRing, { minItems: 1, maxItems: 100 }), { minItems: 1, maxItems: 100 }),
  }),
]);
export type PolygonGeometry = Static<typeof PolygonGeometry>;

export const PolygonBody = Type.Object(
  {
    geometry: PolygonGeometry,
  },
  { description: 'GeoJSON Polygon or MultiPolygon geometry (WGS84, [lng, lat] order)' },
);
export type PolygonBody = Static<typeof PolygonBody>;

export const ListingPage = Type.Object({ data: Type.Array(Listing), meta: PageMeta });

export const FeatureCollection = Type.Object({
  type: Type.Literal('FeatureCollection'),
  features: Type.Array(
    Type.Object({
      type: Type.Literal('Feature'),
      id: Uuid,
      geometry: Type.Object({
        type: Type.Literal('Point'),
        coordinates: Type.Array(Type.Number()),
      }),
      properties: Type.Record(Type.String(), Type.Unknown()),
    }),
  ),
  meta: PageMeta,
});

export const ListingSearchResponse = Type.Union([ListingPage, FeatureCollection]);
