# Phase 7.3: Bounded Media Metadata Cache

Status: ready-for-agent
Completion: complete

Blocked by: 01, 02

## Goal

Reduce repeated public Provider retrieval while keeping the cache bounded, policy-aware, and completely separate from User-owned data.

## Acceptance Criteria

- [x] Add an injectable in-process TTL/LRU cache with a maximum of 256 normalized response entries.
- [x] Apply 60-second TTLs to search and Discovery and 5-minute TTLs to details and Recommendations.
- [x] Include every request-affecting value in the cache key, including Provider, type, operation, query or ID, pagination, cursor, and includeAdult.
- [x] Cache only successful public Provider-owned responses approved by the Provider policy.
- [x] Share one in-flight request for identical concurrent misses.
- [x] Do not serve expired values stale and do not retain failed requests.
- [x] Prevent Library Items, tracking fields, Sessions, credentials, diagnostics, and query contents from entering cache keys or values.
- [x] Add fake-clock, LRU, policy, hit/miss, expiry, and concurrent-request tests.

## Comments

- 2026-09-10 — The process-local cache is deliberate for local/staging learning and is not a production shared-cache claim.
- 2026-09-10 - Implemented the injectable process-local Media Metadata Cache with opaque request keys, explicit Provider policies, operation-specific TTLs, bounded LRU eviction, in-flight request sharing, safe response cloning, and public search, Discovery, Recommendation, and details route integration.
- 2026-09-10 - Verification: `npm run check` passed (161 server tests, 51 client tests, production build, and client-secret scan); focused cache tests cover key isolation, fake-clock expiry, operation TTLs, LRU bounds, policy denial and attribution, hit/miss behavior, unsafe data boundaries, failed-request eviction, in-flight sharing, and HTTP integration.
