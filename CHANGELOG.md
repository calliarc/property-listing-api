# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - 2026-09-23

First working release.

### Added

- CRUD for listings, agents and media (photos, videos, floor plans, virtual tours by URL)
- Search by price, beds, baths, square footage, property type, status, agent and city, with sorting and pagination
- Geo search: radius (`ST_DWithin`), bounding box (`ST_MakeEnvelope`) and polygon (GeoJSON, `ST_Within`)
- GeoJSON `FeatureCollection` output (`format=geojson`) for maps
- OpenAPI 3 documentation with Swagger UI at `/docs`
- API key auth for write endpoints, rate limiting, security headers (helmet) and configurable CORS
- SQL migrations, a synthetic seed data script and Docker Compose for local development

[Unreleased]: https://github.com/calliarc/property-listing-api/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/calliarc/property-listing-api/releases/tag/v0.1.0
