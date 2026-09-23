-- 001_init: agents, listings, listing_media
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TABLE agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name           text NOT NULL CHECK (length(name) BETWEEN 1 AND 200),
  email          text NOT NULL UNIQUE,
  phone          text,
  brokerage      text,
  license_number text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER agents_set_updated_at
  BEFORE UPDATE ON agents
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE listings (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id      uuid REFERENCES agents(id) ON DELETE SET NULL,
  title         text NOT NULL CHECK (length(title) BETWEEN 1 AND 200),
  description   text,
  property_type text NOT NULL CHECK (property_type IN ('house', 'apartment', 'condo', 'townhouse', 'land', 'commercial')),
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'pending', 'sold', 'off_market')),
  price         numeric(14, 2) NOT NULL CHECK (price >= 0),
  currency      char(3) NOT NULL DEFAULT 'USD',
  beds          integer CHECK (beds >= 0),
  baths         numeric(4, 1) CHECK (baths >= 0),
  sqft          integer CHECK (sqft >= 0),
  year_built    integer CHECK (year_built BETWEEN 1600 AND 2100),
  address_line1 text NOT NULL,
  address_line2 text,
  city          text NOT NULL,
  region        text,
  postal_code   text,
  country       char(2) NOT NULL DEFAULT 'US',
  location      geography(Point, 4326) NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER listings_set_updated_at
  BEFORE UPDATE ON listings
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Geography index for radius search (ST_DWithin on geography)
CREATE INDEX listings_location_gix ON listings USING GIST (location);
-- Geometry expression index for bounding box / polygon search
CREATE INDEX listings_location_geom_gix ON listings USING GIST ((location::geometry));
CREATE INDEX listings_price_idx ON listings (price);
CREATE INDEX listings_status_type_idx ON listings (status, property_type);
CREATE INDEX listings_agent_idx ON listings (agent_id);
CREATE INDEX listings_created_at_idx ON listings (created_at);

CREATE TABLE listing_media (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  media_type text NOT NULL DEFAULT 'image' CHECK (media_type IN ('image', 'video', 'floor_plan', 'virtual_tour')),
  url        text NOT NULL,
  caption    text,
  position   integer NOT NULL DEFAULT 0 CHECK (position >= 0),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX listing_media_listing_idx ON listing_media (listing_id, position);
