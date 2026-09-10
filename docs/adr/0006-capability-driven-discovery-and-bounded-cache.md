# Capability-driven Discovery and bounded Media Metadata caching

Status: accepted; implemented in Phase 7 for local development and controlled staging

Phase 7 exposes Provider-owned Media details, Discovery, and Recommendations through an explicit Provider Capability matrix rather than assuming every Provider supports every operation. Unsupported operations remain distinct from empty results, new operations do not silently switch Providers, and details continue to use the normalized Media contract. Successful public Provider responses use a bounded, policy-aware process-local Media Metadata Cache with in-flight request sharing, while User-owned Library data, Sessions, and tracking state remain outside the cache.

## Considered Options

- Assume a universal Provider interface for details, Discovery, and Recommendations. Rejected: Provider capabilities and response semantics differ.
- Return empty results when a Provider lacks an operation. Rejected: it hides capability boundaries and misrepresents Provider behavior.
- Add a shared persistent cache before the public contracts stabilize. Rejected: it adds operational infrastructure and retention concerns to a local/staging phase.
- Cache all responses indiscriminately. Rejected: errors, private data, and Provider-specific retention or attribution policies require separate treatment.

## Consequences

- The capability matrix becomes part of the public boundary and must be tested with every supported Provider/type combination.
- New functional client surfaces must identify their effective Provider and handle unsupported, empty, unavailable, and rate-limited states separately.
- The process-local cache is intentionally not a production shared-cache claim; later deployment work may replace it behind the cache seam.
- Provider policy, attribution, and safe-response rules remain part of the implementation acceptance boundary.
