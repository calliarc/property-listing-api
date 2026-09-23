import type { PageMeta } from '../schemas/common.js';
import type { Listing } from '../schemas/listing.js';

export interface ListingRow {
  id: string;
  agent_id: string | null;
  title: string;
  description: string | null;
  property_type: Listing['property_type'];
  status: Listing['status'];
  price: number;
  currency: string;
  beds: number | null;
  baths: number | null;
  sqft: number | null;
  year_built: number | null;
  address_line1: string;
  address_line2: string | null;
  city: string;
  region: string | null;
  postal_code: string | null;
  country: string;
  lat: number;
  lng: number;
  distance_m?: number;
  created_at: Date | string;
  updated_at: Date | string;
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : d);

export function toListing(row: ListingRow): Listing {
  const listing: Listing = {
    id: row.id,
    agent_id: row.agent_id,
    title: row.title,
    description: row.description,
    property_type: row.property_type,
    status: row.status,
    price: row.price,
    currency: row.currency,
    beds: row.beds,
    baths: row.baths,
    sqft: row.sqft,
    year_built: row.year_built,
    address: {
      line1: row.address_line1,
      line2: row.address_line2,
      city: row.city,
      region: row.region,
      postal_code: row.postal_code,
      country: row.country,
    },
    location: { lat: row.lat, lng: row.lng },
    created_at: iso(row.created_at),
    updated_at: iso(row.updated_at),
  };
  if (row.distance_m !== undefined && row.distance_m !== null) {
    listing.distance_m = Math.round(row.distance_m * 10) / 10;
  }
  return listing;
}

export interface Feature {
  type: 'Feature';
  id: string;
  geometry: { type: 'Point'; coordinates: [number, number] };
  properties: Record<string, unknown>;
}

export interface FeatureCollection {
  type: 'FeatureCollection';
  features: Feature[];
  meta: PageMeta;
}

/** Converts listings to a GeoJSON FeatureCollection ([lng, lat] order per RFC 7946). */
export function toFeatureCollection(listings: Listing[], meta: PageMeta): FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: listings.map(({ location, ...properties }) => ({
      type: 'Feature',
      id: properties.id,
      geometry: { type: 'Point', coordinates: [location.lng, location.lat] },
      properties,
    })),
    meta,
  };
}
