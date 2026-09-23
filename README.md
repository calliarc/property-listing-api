# Property Listing API

Open-source real estate listing API with search, filters and map support.

[![CI](https://github.com/calliarc/property-listing-api/actions/workflows/ci.yml/badge.svg)](https://github.com/calliarc/property-listing-api/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/calliarc/property-listing-api?include_prereleases&sort=semver)](https://github.com/calliarc/property-listing-api/releases)
[![Built by CalliArc](https://img.shields.io/badge/built%20by-CalliArc-0a66c2)](https://www.calliarc.com/)

> **Status:** v0.1.0, the first working release. The API is usable but may still change before 1.0.

## Features

- CRUD for listings, agents and media (photos, videos, floor plans, virtual tours by URL)
- Search by price, beds, baths, square footage, property type, status, agent and city, with sorting and pagination
- Geo search: radius (`ST_DWithin`), bounding box (`ST_MakeEnvelope`) and polygon (GeoJSON, `ST_Within`)
- GeoJSON `FeatureCollection` output (`format=geojson`) for maps
- OpenAPI 3 documentation with Swagger UI at `/docs`
- API key auth for write endpoints, rate limiting, security headers (helmet) and configurable CORS
- SQL migrations, a synthetic seed data script and Docker Compose for local development

## Tech stack

- Node.js (22+ recommended, 20+ supported)
- TypeScript
- Fastify 5 with TypeBox schemas for validation
- PostgreSQL + PostGIS (`geography(Point, 4326)` with GiST indexes)
- OpenAPI 3 via `@fastify/swagger` and `@fastify/swagger-ui`
- Vitest for unit and integration tests

## Quick start

### Option 1: Docker Compose

```bash
git clone https://github.com/calliarc/property-listing-api.git
cd property-listing-api

# Pick a key for write endpoints (any random string)
export API_KEYS=$(openssl rand -hex 32)

docker compose up -d --build            # PostGIS + API; migrations run on start
docker compose exec api node dist/db/seed.js --count 200   # optional demo data

curl http://localhost:3000/health
open http://localhost:3000/docs         # Swagger UI
```

### Option 2: Local Node.js

You need Node.js 22 and a PostgreSQL database with PostGIS. The quickest way to get one is `docker compose up -d db`.

```bash
npm install
cp .env.example .env                    # then set API_KEYS and DATABASE_URL
npm run migrate                         # apply SQL migrations in migrations/
npm run seed -- --count 200             # optional synthetic data (--reset to wipe first)
npm run dev                             # http://localhost:3000, docs at /docs
```

The scripts read settings from environment variables. To load `.env`, run them through Node's env-file flag, for example `node --env-file=.env --import tsx src/server.ts`, or export the variables in your shell.

No Docker? `npm run db:lite` starts an in-memory PostgreSQL + PostGIS built on [PGlite](https://pglite.dev) (WebAssembly) on port 5433. It is experimental and meant for trying the API out. Use it with `DATABASE_URL=postgres://postgres@127.0.0.1:5433/postgres DB_POOL_MAX=1`.

### Production build

```bash
npm ci && npm run build
npm run migrate:prod && npm start
```

## Configuration

| Variable | Default | Description |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://postgres:postgres@localhost:5432/property_listing` | PostgreSQL + PostGIS connection string |
| `DB_POOL_MAX` | `10` | Max pool connections |
| `HOST` / `PORT` | `0.0.0.0` / `3000` | Listen address |
| `API_KEYS` | _(empty)_ | Comma-separated keys accepted in `x-api-key`. If empty, every write is rejected |
| `CORS_ORIGIN` | _(empty = disabled)_ | `*` or a comma-separated list of allowed origins |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW` | `100` / `1 minute` | Requests per client IP per window |
| `TRUST_PROXY` | `false` | Trust `X-Forwarded-For`. Only enable this behind a reverse proxy you trust |
| `DOCS_ENABLED` | `true` | Serve Swagger UI at `/docs` and the spec at `/docs/json` |
| `LOG_LEVEL` | `info` | Pino log level |

See [.env.example](.env.example).

## API

All endpoints are under `/v1` and return JSON. Write endpoints need an `x-api-key` header. The full OpenAPI 3 spec is served at `/docs/json`.

| Method | Path | Auth | Description |
| --- | --- | --- | --- |
| GET | `/health` | - | Liveness and database check |
| GET | `/v1/listings` | - | List listings with filters, sorting and pagination |
| GET | `/v1/listings/search/radius` | - | Listings within `radius` meters of `lat`,`lng` |
| GET | `/v1/listings/search/bbox` | - | Listings inside `bbox=minLng,minLat,maxLng,maxLat` |
| POST | `/v1/listings/search/polygon` | - | Listings inside a GeoJSON Polygon/MultiPolygon (read-only) |
| GET | `/v1/listings/{id}` | - | Get a listing, including its media |
| POST | `/v1/listings` | key | Create a listing |
| PATCH | `/v1/listings/{id}` | key | Partially update a listing |
| DELETE | `/v1/listings/{id}` | key | Delete a listing and its media |
| GET | `/v1/listings/{id}/media` | - | List media for a listing |
| POST | `/v1/listings/{id}/media` | key | Attach a media item (by URL) |
| PATCH | `/v1/listings/{id}/media/{mediaId}` | key | Update a media item |
| DELETE | `/v1/listings/{id}/media/{mediaId}` | key | Delete a media item |
| GET | `/v1/agents` | - | List agents (`q` searches name or brokerage) |
| GET | `/v1/agents/{id}` | - | Get an agent |
| POST | `/v1/agents` | key | Create an agent |
| PATCH | `/v1/agents/{id}` | key | Partially update an agent |
| DELETE | `/v1/agents/{id}` | key | Delete an agent (their listings keep `agent_id = null`) |

### Filters, sorting and pagination

The list and search endpoints all accept these query parameters:

- `min_price`, `max_price`, `min_beds`, `max_beds`, `min_baths`, `max_baths`, `min_sqft`, `max_sqft`
- `property_type`: comma-separated list of `house`, `apartment`, `condo`, `townhouse`, `land`, `commercial`
- `status`: comma-separated list of `active`, `pending`, `sold`, `off_market`
- `agent_id`, `city` (exact match, case-insensitive)
- `sort`: one of `created_at`, `price`, `beds` or `sqft`, with a `-` prefix for descending (default `-created_at`). Radius search also accepts `distance`, which is its default
- `page` (default 1) and `limit` (default 20, max 100)
- `format`: `json` (default) or `geojson`

A JSON response looks like `{ "data": [...], "meta": { "page", "limit", "total", "total_pages" } }`. With `format=geojson` you get a `FeatureCollection` in which each listing becomes a `Point` feature (`[lng, lat]`). The same `meta` is included.

### Example requests

```bash
BASE=http://localhost:3000
KEY=your-api-key

# Filtered list: 2+ bed houses or condos under $600k, cheapest first
curl "$BASE/v1/listings?property_type=house,condo&min_beds=2&max_price=600000&sort=price&limit=10"

# Radius search: within 5 km of a point, nearest first (each result has distance_m)
curl "$BASE/v1/listings/search/radius?lat=30.2672&lng=-97.7431&radius=5000&status=active"

# Bounding box search (map viewport) returned as GeoJSON
curl "$BASE/v1/listings/search/bbox?bbox=-97.9,30.1,-97.6,30.4&format=geojson&limit=100"

# Polygon search: GeoJSON geometry in the body, filters in the query string
curl -X POST "$BASE/v1/listings/search/polygon?min_beds=3&format=geojson" \
  -H 'content-type: application/json' \
  -d '{"geometry":{"type":"Polygon","coordinates":[[[-97.80,30.20],[-97.70,30.20],[-97.70,30.30],[-97.80,30.30],[-97.80,30.20]]]}}'

# Create an agent and a listing (writes need x-api-key)
curl -X POST "$BASE/v1/agents" -H "x-api-key: $KEY" -H 'content-type: application/json' \
  -d '{"name":"Alex Example","email":"alex@example.com","brokerage":"Demo Realty"}'

curl -X POST "$BASE/v1/listings" -H "x-api-key: $KEY" -H 'content-type: application/json' -d '{
  "title": "Modern condo near the park",
  "property_type": "condo",
  "price": 425000,
  "beds": 2, "baths": 2, "sqft": 1100,
  "address": { "line1": "100 Example Street", "city": "Sampleton", "region": "Demo North", "postal_code": "D0001" },
  "location": { "lat": 30.2672, "lng": -97.7431 }
}'

# Update, attach a photo, delete
curl -X PATCH "$BASE/v1/listings/<id>" -H "x-api-key: $KEY" -H 'content-type: application/json' -d '{"status":"pending","price":415000}'
curl -X POST "$BASE/v1/listings/<id>/media" -H "x-api-key: $KEY" -H 'content-type: application/json' -d '{"url":"https://images.example.com/1.jpg","caption":"Living room"}'
curl -X DELETE "$BASE/v1/listings/<id>" -H "x-api-key: $KEY"
```

Coordinates use WGS84. Request bodies use `{ "lat", "lng" }`, while GeoJSON uses `[lng, lat]`. The bounding box search does not support boxes that cross the antimeridian.

## Data model

Migrations live in [`migrations/`](migrations) as plain SQL and are applied in filename order. Applied files are tracked in `schema_migrations`.

- `agents`: name, unique email, phone, brokerage, license number
- `listings`: title, description, `property_type`, `status`, `price` + `currency`, beds, baths, sqft, year built, address fields, `location geography(Point, 4326)`, and timestamps (`updated_at` is maintained by a trigger). There is a GiST index on `location` for radius search and one on `location::geometry` for bounding box and polygon search
- `listing_media`: listing id (cascade delete), media type, URL, caption, position

## Seed data

`npm run seed -- --count 200 [--reset]` inserts **synthetic** agents and listings. The addresses are fictional ("Example Street", "Sampleton"), emails use `@example.com` and phone numbers use the reserved 555-01xx range. Points are scattered around a few metro-area coordinates so that map searches look realistic. None of these properties exist.

## Tests

```bash
npm test                   # unit tests; integration tests are skipped without DATABASE_URL
DATABASE_URL=postgres://postgres:postgres@localhost:5432/property_listing_test npm test
```

The integration tests (`test/integration`) run the migrations and exercise every endpoint, including all three geo searches, against a real PostGIS database. **They truncate the tables**, so point them at a dedicated test database. On every push and pull request, CI runs them against a `postgis/postgis` service container.

## Roadmap

- [x] Initial release
- [x] Documentation and examples
- [x] CI and automated tests
- [ ] Full-text search on title and description
- [ ] Media uploads to object storage (S3-compatible)
- [ ] Cursor-based pagination for large result sets

Have an idea? [Open an issue](https://github.com/calliarc/property-listing-api/issues).

## Contributing

Contributions are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

## Changelog

See [CHANGELOG.md](CHANGELOG.md).

## License

[MIT](LICENSE) © 2026 CalliArc

---

Built and maintained by [CalliArc](https://www.calliarc.com/). Need help with real estate software? [Talk to our team](https://www.calliarc.com/industries/real-estate/).
