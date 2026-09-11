# Combined multi-provider search

Status: accepted

Phase 4 adds TheGamesDB-primary game search, RAWG availability fallback, and Combined Search to the existing typed media search route. Typed requests retain the Phase 3 provider-owned response contract. `type=all` is the explicit Combined Search mode and runs independent media-type lanes: Anime keeps the AniList-primary/MyAnimeList-fallback policy, movies and TV use TMDB, and games use TheGamesDB with RAWG fallback.

Combined Search returns normalized Media values without pretending that different Providers share a relevance score, total, page size, or identity. Results are ordered deterministically by media type, while each lane preserves its Provider's ordering. Cross-Provider duplicates are retained because cross-Provider matching is not yet part of the domain model.

Combined pages use an opaque continuation cursor. The cursor preserves each lane's page position and the Provider selected by the Anime fallback. A retry may advance only the failed independent lane; it must not refetch or duplicate successful lanes.

## Considered Options

- Add a second combined-search route. Rejected: it duplicates validation and client request seams.
- Use `type=all` on `GET /api/media/search`. **Chosen:** the public route remains one typed boundary, with `all` explicitly meaning Combined Search rather than a Media type.
- Merge all Providers into one globally ranked and deduplicated catalog. Rejected: Provider scores and relevance are not comparable, and cross-Provider matching is future work.
- Query AniList and MyAnimeList independently in Combined Search. Rejected: it would bypass the established Anime fallback policy and produce duplicate Anime results.
- Use numeric page offsets for Combined Search. Rejected: offsets cannot safely preserve fallback selection and independent lane progress; an opaque cursor can.

## Consequences

- The existing typed response remains backward-compatible; Combined Search uses `source: "combined"` and provider-specific pagination metadata.
- A valid result from at least one lane produces HTTP 200, with safe `providerErrors` for failed lanes. HTTP 503 is reserved for the case where every requested lane fails.
- The client must render lane-aware partial failure notices, grouped results, and provider-specific retry/load-more state.
- Cursor contents are opaque to the client and must not contain credentials or raw upstream payloads.
