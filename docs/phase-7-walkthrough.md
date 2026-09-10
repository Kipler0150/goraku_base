# Phase 7 walkthrough: Discovery enrichment and runtime reliability

Status: complete
Completion: complete

This walkthrough covers the completed Phase 7 local-development and controlled-staging slice. It is not a production-readiness claim. Phase 7 extends the public Provider-owned Media surface and bounds repeated traffic; Phase 8 separately refines the presentation of those surfaces.

## Outcome

Phase 7 adds:

- Capability-driven Media details for supported Provider/type combinations.
- Supported trending and popular Discovery lists.
- Provider-owned Recommendations related to an anchor Media entry.
- A bounded, policy-aware Media Metadata Cache.
- In-flight request sharing for identical public Provider requests.
- A configurable per-IP Application Rate Limit for public Media routes.
- Lightweight runtime signals that exclude sensitive data.
- Functional client details, Discovery, and Recommendation states using the existing Media cards.

The boundary remains local development and controlled staging. It does not claim production deployment, shared cache infrastructure, production authentication hardening, or personalized recommendations.

## Relationship to previous and next phases

~~~text
Public Search -> Provider-owned Media -> Details / Discovery / Recommendations
                                      |
                                      +-> bounded metadata cache
                                      +-> Provider failure and rate-limit boundaries

Authenticated Library -> User-owned tracking
                       |
                       +-> no Provider hydration during Library operations

Phase 8 -> presentation refinement of the functional surfaces above
~~~

Phase 7 preserves the Phase 6 separation between Provider-owned Media and User-owned Library Items. The Library never becomes dependent on Provider availability. Phase 8 may improve visual hierarchy, layout, typography, interaction flow, responsive presentation, and motion without changing the Phase 7 contracts.

## Prerequisites

- Node.js 20.19 or newer and npm.
- The repository installed with npm install.
- Provider credentials are optional for credential-free tests.
- PostgreSQL and the dedicated goraku_test database remain required for the existing integration suite.

The normal test and build commands must not make live Provider calls. Adapter tests use injected HTTP seams and deterministic Provider fixtures.

## Architecture and relevant files

~~~text
React functional Media surface
  -> Express public media routes
  -> capability-aware media service
  -> policy-aware cache and request coalescing
  -> Provider adapter
  -> normalized Media
~~~

| Concern | Implemented location |
| --- | --- |
| Capability matrix and operation contracts | `server/media-capabilities.js`, `server/media-details.js`, and `server/media-discovery.js` |
| Provider details and Discovery | `server/providers/` and the media services |
| Public routes and validation | `server/app.js` |
| Cache and request sharing | `server/media-cache.js` |
| Application Rate Limit | `server/rate-limit.js` and `server/app.js` |
| Functional client API/state | `client/src/api/` and `client/src/hooks/` |
| Functional client surface | `client/src/App.jsx` and existing styles |
| Verification | `test/`, `client/src/*.test.*`, and `scripts/verify-client-secrets.js` |

## Capability behavior

The Provider Capability matrix is the source of truth. It must identify whether each Provider and Media type supports:

- Search
- Details
- Trending
- Popular
- Provider-owned Recommendations

An unsupported capability is different from a successful empty result. The API returns 501 CAPABILITY_UNSUPPORTED for the former and a normal 200 list with no results for the latter. Temporary Provider, credential, timeout, malformed-response, and rate-limit failures retain the existing safe Provider Failure behavior.

Provider selection is explicit for details and Recommendations. Discovery may use a type's primary Provider when omitted, but it never silently switches Providers. Existing search fallback behavior remains unchanged.

## API walkthrough

Fetch a normalized Media detail:

~~~powershell
curl.exe -i "http://localhost:3001/api/media/tmdb/movie/550"
~~~

Fetch Provider-owned Recommendations:

~~~powershell
curl.exe -i "http://localhost:3001/api/media/tmdb/movie/550/recommendations?page=1&perPage=12&includeAdult=false"
~~~

Fetch a supported Discovery list:

~~~powershell
curl.exe -i "http://localhost:3001/api/media/trending?type=anime&provider=anilist&page=1&perPage=12&includeAdult=false"
~~~

The detail response is the existing normalized Media contract. It does not contain raw upstream payloads, User-owned Library fields, Sessions, or Provider credentials. Lists retain results, pagination, source, and providerErrors.

When includeAdult is false, adult results are omitted from lists and a direct adult detail request is returned as not found. Unknown query parameters, incompatible Provider/type pairs, malformed IDs, invalid pagination, and invalid adult-content values return the existing validation envelope.

## Cache and request-sharing walkthrough

Successful public Provider-owned responses may enter the Media Metadata Cache only when the Provider policy allows it:

- Search and Discovery entries expire after 60 seconds.
- Details and Recommendations entries expire after 5 minutes.
- At most 256 normalized response entries are retained per process.
- Cache keys contain Provider, type, operation, query or ID, pagination, cursor, includeAdult, and operation-specific options.
- Expired entries are not served stale.
- Identical concurrent misses share one in-flight Provider request.
- Failed requests are removed and never poison the cache.

The cache is process-local and temporary. It never stores Library Items, tracking fields, Tags, Collections, Sessions, credentials, or diagnostics. Provider-specific cache eligibility, retention, and attribution rules must be explicit; unknown policy means no caching.

## Application Rate Limit walkthrough

Public /api/media/* requests use a process-local token bucket keyed by resolved client IP:

- 60 tokens per minute by default.
- Burst capacity of 10.
- Environment-configurable values.
- Health checks exempt.
- No forwarded IP trust unless explicitly configured.

An exhausted bucket returns 429 with Retry-After and the existing safe error envelope. This is distinct from a Provider returning a rate-limit failure.

## Functional browser behavior

The existing public Search surface gains:

1. A View details action on a Media card.
2. An accessible in-page details panel with loading, empty, unsupported, unavailable, and retry states.
3. A Back to results action.
4. Provider-owned Recommendation and supported Discovery lists rendered with existing Media cards.
5. Provider attribution on each new surface.

No router, shareable detail URL, visual redesign, typography overhaul, layout rework, or new visual language is required. Semantic HTML, keyboard operation, visible focus, responsive behavior, reduced motion, and accessible status announcements remain mandatory during Phase 7.

## Implementation order

1. Establish Provider Capability and normalized details seams.
2. Add supported Discovery and Provider-owned Recommendation operations.
3. Wrap successful public operations with the bounded cache and in-flight sharing.
4. Add the Application Rate Limit and sensitive-data-safe runtime signals.
5. Add functional client details, Discovery, and Recommendation states.
6. Run the complete tests, update boundaries, and record verification.

The full specification is in the Phase 7 spec at `../.scratch/phase-7-discovery-runtime/spec.md`. The implementation tickets are:

- ../.scratch/phase-7-discovery-runtime/issues/01-provider-capabilities-and-details.md
- ../.scratch/phase-7-discovery-runtime/issues/02-discovery-and-recommendations.md
- ../.scratch/phase-7-discovery-runtime/issues/03-media-metadata-cache.md
- ../.scratch/phase-7-discovery-runtime/issues/04-rate-limit-and-observability.md
- ../.scratch/phase-7-discovery-runtime/issues/05-functional-discovery-client.md
- ../.scratch/phase-7-discovery-runtime/issues/06-tests-walkthrough-and-boundary.md

## Verification

Run the credential-free suite:

~~~bash
npm run check
~~~

Expected results:

- Existing Phase 1–6 tests continue to pass.
- New capability, adapter, HTTP, cache, rate-limit, observability, and browser tests pass.
- The production client build succeeds.
- The client secret scan finds no server-only configuration, credentials, diagnostics, or private tracking data.

Run the PostgreSQL regression suite separately:

~~~powershell
$env:TEST_DATABASE_URL = 'postgresql://goraku:goraku_dev@localhost:5432/goraku_test'
npm run test:integration
~~~

The suite must continue to use only the dedicated goraku_test database. Phase 7 does not add Provider calls to PostgreSQL tests.

## Troubleshooting expectations

| Symptom | Resolution |
| --- | --- |
| A supported operation returns 501 | Check the Provider Capability matrix before treating it as an empty result. |
| A repeated request still reaches a Provider | Check all cache-key dimensions, TTL state, Provider policy, and in-flight sharing. |
| A request returns 429 | Wait for token refill or adjust the configured local limit; Provider rate-limit failures are reported separately. |
| A detail request returns 404 with includeAdult=false | The Provider Media is adult-classified and is intentionally filtered. |
| A client surface lacks attribution | Treat the Provider policy and functional client acceptance as incomplete. |

## Operational boundary

Phase 7 remains suitable for local development and controlled staging only. Persistent/shared caching, production traffic shaping, authentication rate limiting, abuse monitoring, metrics infrastructure, dashboards, alerting, deployment, account recovery, Google OAuth/OIDC, and personalized User recommendations remain future work.

Phase 8 is the separate UI refinement phase. It may polish Phase 6 and Phase 7 surfaces after their functional behavior is verified, but it does not reopen their domain or API contracts.

## Completion record

Phase 7 was completed on 2026-09-10 for local development and controlled staging. `npm run check` passed with 169 server tests, 70 client tests, a production client build, and the client-secret scan. `TEST_DATABASE_URL=postgresql://goraku:goraku_dev@localhost:5432/goraku_test npm run test:integration` passed all 14 dedicated PostgreSQL integration tests. The capability, adapter, service, HTTP, cache, rate-limit, observability, browser, and boundary tests use mocked or injected Provider seams and do not require Provider credentials or live Provider calls.

The verification confirms that Provider credentials, upstream diagnostics, query contents, Sessions, Library Items, and tracking fields are excluded from cache state, runtime signals, public errors, and public Media responses. The operational boundary remains local development and controlled staging; Phase 8 remains the separate planned presentation-refinement phase.
