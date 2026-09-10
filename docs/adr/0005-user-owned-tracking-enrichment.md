# User-owned tracking enrichment

Status: accepted

Phase 6 keeps Personal Rating, Note, and typed Progress on the User-owned Library Item while modeling reusable Tags and Collections as normalized private relationships. Progress uses one validated typed JSONB value because each Library Item has one Media type; Tags and Collections use relational membership tables because they require reusable ownership, uniqueness, and cascading behavior. This preserves the separation from Provider-owned Media Metadata and keeps Library CRUD free of external provider calls.

## Considered Options

- Store all tracking data, Tags, and Collections as unvalidated JSON on each Library Item. Rejected: ownership, uniqueness, membership cleanup, and filtering would be fragile.
- Create separate progress tables for every Media type. Rejected for this phase: it expands the interface and schema for a single mutually exclusive Progress value without a current need to query progress independently.
- Hydrate Provider Metadata during Library reads. Rejected: it couples private tracking availability to external providers and turns references into provider snapshots.

## Consequences

- The Library Item interface returns complete user-owned tracking state but remains reference-only for Provider metadata.
- The server must validate Progress against the immutable Media type on every write.
- Tag and Collection operations need explicit ownership and membership interfaces, but repeated attach/detach requests can be safely retried.

## Operational boundary and verification

This decision is implemented for local development and controlled staging. The authenticated Library is the only detailed tracking surface; public Search remains a Provider-owned metadata surface. Library operations make no external Provider calls, and unauthenticated requests receive safe errors before private repositories are reached.

Migration, domain, HTTP, browser, dedicated PostgreSQL integration, and client-bundle boundary verification are recorded in the [Phase 6 walkthrough](../phase-6-walkthrough.md). Production deployment, authentication hardening, Provider hydration, and Media Metadata snapshots remain outside this decision's verified boundary.
