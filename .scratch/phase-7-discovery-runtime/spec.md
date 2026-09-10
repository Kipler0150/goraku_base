# Phase 7: Discovery enrichment and runtime reliability

Status: ready-for-agent
Completion: complete

## Problem Statement

Phases 1–4 provide Provider-owned search and Combined Search, while Phase 6 provides a private User-owned Library. The next useful slice needs richer public Discovery without coupling Library reads to Providers, and it needs bounded runtime behavior before more Provider traffic is introduced. The original roadmap combined this work with UI refinement; presentation refinement is now a separate Phase 8.

## Solution

Add capability-driven Media details, supported trending and popular Discovery, and Provider-owned Recommendations behind the existing Express media boundary. Add a bounded Media Metadata Cache, in-flight request sharing, public media Application Rate Limits, and lightweight runtime signals. Add only the functional client behavior needed to open details and browse the new lists; keep visual refinement in Phase 8.

Phase 7 remains a local-development and controlled-staging slice. It does not claim production deployment, production authentication hardening, shared cache infrastructure, or personalized recommendations.

## Settled Design Decisions

- Phase 7 is named Discovery enrichment and runtime reliability. UI refinement is Phase 8.
- Discovery is Provider-owned. A Provider-owned Recommendation is related Media returned by a Provider, not a personalized result derived from a User's Library.
- Use an explicit Provider Capability matrix for each Media type and operation: search, details, trending, popular, and Provider-owned Recommendations.
- Implement only capabilities supported and normalized by a Provider. Unsupported operations return 501 with code CAPABILITY_UNSUPPORTED; they are not represented as empty results.
- Details return the existing normalized Media contract. They do not introduce a second provider-specific response shape or expose raw upstream payloads.
- New details, Discovery, and Recommendation operations use the effective Provider explicitly. Existing search fallback behavior remains unchanged; new operations do not silently switch Providers.
- Combined Search does not gain details, Discovery, or Recommendation variants in this phase. Cross-Provider ranking, identity matching, and deduplication remain out of scope.
- Public list responses keep the existing results, pagination, source, and providerErrors shape. A detail response is one Media object.
- The public includeAdult query keeps the existing default. When includeAdult is false, adult items are omitted from lists and a direct adult detail request is treated as not found.
- Use 404 for an absent or filtered Provider Media entry, 429 for the Application Rate Limit, 501 for an unsupported Provider Capability, 503 for a Provider or credential failure, and the existing safe error envelope for all failures.
- Cache only successful public Provider-owned responses. Use a bounded in-process TTL/LRU cache with a maximum of 256 entries, 60-second TTL for search and Discovery, and 5-minute TTL for details and Recommendations.
- Cache keys include every request-affecting value, including Provider, Media type, operation, query or Provider ID, page, perPage, cursor, includeAdult, and any operation-specific option.
- Identical concurrent cache misses share one in-flight Provider request. Expired entries are not served stale.
- Each Provider has a cache policy for eligibility, maximum retention, attribution requirements, and any Provider-specific restriction. A response is not cached when its policy is unknown.
- Apply a per-process token-bucket Application Rate Limit to public /api/media/* routes: 60 requests per minute, burst capacity 10, configurable through server environment. Health checks are exempt.
- Rate-limited responses return 429, Retry-After, and the existing safe error envelope. Provider rate-limit failures remain distinct Provider Failures.
- Runtime signals may count cache hits and misses, Provider requests, rate-limit rejections, and request duration, but must not log query contents, credentials, or User-owned data.
- The functional client uses an accessible in-page details panel selected from a Media card, with a Back to results action. It does not add a router or shareable detail URL in this phase.
- The client renders Discovery and Recommendation results with existing Media cards and preserves loading, empty, unavailable, unsupported, retry, attribution, keyboard, responsive, reduced-motion, and visible-focus behavior.
- Phase 8 may refine the visual hierarchy, layout, typography, interaction flow, responsive presentation, and motion of these surfaces without changing their Phase 7 contracts.

## Public Interface

Details:

~~~http
GET /api/media/:provider/:type/:id
~~~

Provider-owned Recommendations:

~~~http
GET /api/media/:provider/:type/:id/recommendations?page=1&perPage=12&includeAdult=true
~~~

Discovery:

~~~http
GET /api/media/trending?type=anime&provider=anilist&page=1&perPage=12&includeAdult=true
GET /api/media/popular?type=game&provider=rawg&page=1&perPage=12&includeAdult=true
~~~

Details use the Provider and Media type from the route. Discovery may use the type's primary Provider when provider is omitted, but it never silently falls back to another Provider. The server validates Provider/type compatibility, Provider ID syntax, pagination, adult-content preference, and unknown query parameters.

The detail response is a normalized Media object:

~~~json
{
  "provider": "tmdb",
  "type": "MOVIE",
  "providerId": "550",
  "titles": { "display": "Fight Club", "original": "Fight Club", "alternatives": [] },
  "description": "A normalized Provider-owned description.",
  "image": "https://image.example/poster.jpg",
  "bannerImage": null,
  "releaseDate": { "year": 1999, "month": 10, "day": 15 },
  "genres": ["Drama"],
  "providerRating": { "value": 8.4, "scale": 10, "displayScore": 8.4 },
  "releaseStatus": "RELEASED",
  "creators": [],
  "isAdult": false,
  "metadata": { "runtimeMinutes": 139 }
}
~~~

Discovery and Recommendation lists use:

~~~json
{
  "results": [],
  "source": "tmdb",
  "pagination": { "page": 1, "perPage": 12, "hasMore": false },
  "providerErrors": []
}
~~~

## Error and Boundary Contract

All errors use:

~~~json
{
  "error": {
    "code": "CAPABILITY_UNSUPPORTED",
    "message": "This Provider does not support the requested operation.",
    "details": []
  }
}
~~~

Phase 7 does not add authentication to public Media reads. It does not accept User IDs, read Library state, or make Library operations call Providers. Provider credentials remain server-only, and upstream payloads and diagnostics remain private.

## Runtime Model

The media service remains responsible for Provider selection, normalization, fallback policy where already established, and Provider Failure mapping. A cache and rate-limit seam wraps the public media routes without changing normalized Media ownership.

The cache is temporary and process-local. It is not a source of truth, is not shared between application instances, and is not used for User-owned data. Provider policy controls whether a successful response is eligible for storage.

## Testing and Verification

- Add capability-matrix tests for valid and unsupported Provider/type/operation combinations.
- Add adapter tests for supported details, Discovery, and Recommendation operations using mocked HTTP seams; cover empty results, adult filtering, malformed payloads, timeouts, rate limits, unavailable Providers, and safe diagnostics.
- Add HTTP tests for route validation, Provider selection, pagination, 404 filtering, 501 unsupported operations, 503 Provider failures, response shape, attribution metadata, and no silent fallback.
- Add cache tests for key isolation, hit/miss behavior, TTL expiry, LRU bounds, operation-specific TTL, in-flight sharing, failed-request eviction, and Provider policy denial.
- Add rate-limit tests for per-IP token behavior, burst capacity, 429 and Retry-After, configuration, health exemption, and safe responses.
- Add observability tests or spies proving query contents, credentials, Sessions, Library Items, and tracking fields are not logged or cached.
- Add browser tests for details loading and retry, Discovery and Recommendation lists, unsupported and unavailable states, Provider attribution, Back to results, and preservation of existing Phase 6 behavior.
- Run npm run check without Provider credentials or live Provider calls.
- Run npm run test:integration against the dedicated goraku_test database to ensure Phase 7 does not regress the PostgreSQL-backed foundation.
- Add docs/phase-7-walkthrough.md and update README, architecture, PRODUCT.md, and DESIGN.md so Phase 7 and Phase 8 boundaries remain truthful.

## Out of Scope

Personalized recommendations based on a User's Library, cross-Provider ranking or matching, Combined Search Discovery, Provider hydration during Library reads, Media Metadata snapshots, persistent or shared cache infrastructure, cache warming jobs, stale-while-revalidate behavior, production deployment, production authentication hardening, production abuse monitoring, dashboards and alerting, Google OAuth/OIDC, account recovery, email verification, new Media types, and Phase 8 visual refinement.

## Acceptance Checklist

- [x] A Provider Capability matrix governs details, Discovery, and Provider-owned Recommendations.
- [x] Supported details operations return the existing normalized Media contract without raw Provider payloads.
- [x] Supported trending/popular and Recommendation operations use the existing list/pagination contract.
- [x] Unsupported operations return safe 501 CAPABILITY_UNSUPPORTED responses and are distinct from valid empty results.
- [x] New operations use an explicit effective Provider and never silently fall back.
- [x] Adult-content filtering, route validation, Provider errors, 404 behavior, and safe diagnostics are covered.
- [x] Successful public Provider-owned responses use the bounded, policy-aware Media Metadata Cache.
- [x] Identical concurrent cache misses share one Provider request, while failed requests do not poison the cache.
- [x] Public media routes enforce the configured per-IP Application Rate Limit and return safe 429 responses with Retry-After.
- [x] Lightweight runtime signals exclude query contents, credentials, Sessions, Library Items, and tracking data.
- [x] The client provides functional details, Discovery, and Recommendation states without introducing Phase 8 visual redesign.
- [x] Unit, HTTP, browser, and integration verification passes without live Provider calls or exposed secrets.
- [x] The Phase 7 walkthrough, ADR, roadmap, and project boundary documentation are complete.

## Verification

- `npm run check` passed on 2026-09-10: 169 server tests, 70 client tests, the production client build, and the client-secret boundary scan. The suite used mocked or injected Provider seams and no Provider credentials or live Provider calls.
- `TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration` passed on 2026-09-10: all 14 dedicated PostgreSQL integration tests passed. The Phase 7 public Media slice does not add Provider calls to PostgreSQL tests.
- Cache, runtime-signal, safe-error, private-route, browser, and client-build boundary tests confirm that Provider credentials, upstream diagnostics, query contents, Sessions, Library Items, and tracking fields are not retained or exposed at their respective seams.
- `docs/phase-7-walkthrough.md`, `docs/adr/0006-capability-driven-discovery-and-bounded-cache.md`, README, architecture, PRODUCT.md, DESIGN.md, and CONTEXT.md record the implemented Phase 7 boundary and keep Phase 8 as planned presentation refinement.

## Comments

- 2026-09-10 - Verification complete: the full credential-free check, dedicated PostgreSQL integration suite, boundary tests, walkthrough, ADR, and project documentation all pass or are recorded for the Phase 7 local/staging boundary.
- 2026-09-10 — Scope settled through the grill-with-docs process. UI refinement is explicitly Phase 8; Phase 7 is limited to Discovery enrichment, Provider-owned Recommendations, and runtime reliability for local development and controlled staging.
