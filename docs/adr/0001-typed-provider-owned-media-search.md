# Typed provider-owned media search

Status: accepted

Phase 3 extends the existing media search boundary rather than creating provider-specific public routes: each request selects one supported media type, its compatible provider, and one provider-owned page. Anime uses MyAnimeList as the configured primary and AniList only as an availability fallback; movies and TV use TMDB strictly, with no cross-type merging or fallback. This preserves the normalized Media contract and lets the client evolve from the current anime hook into shared search seams while keeping provider pagination and failure semantics honest.

## Considered Options

- Add separate public routes and separate UI implementations for TMDB movies and TV.
- Merge all providers and media types behind one global search request.
- Extend the existing typed search route with strict provider/type compatibility. **Chosen.**

## Consequences

- `type` remains explicit at the public boundary, and `source` identifies the provider that owns the returned page.
- The API does not promise a unified relevance ranking, total, or page size across providers.
- The client can later render separate Anime, Movies, and TV sections without replacing the provider-neutral card and request state model.

## Current policy

The Anime availability policy was changed after the initial Phase 2 implementation: MyAnimeList is now attempted first when no provider hint is supplied, and AniList is attempted only when MyAnimeList returns `PROVIDER_UNAVAILABLE`. Successful fallback pages identify AniList as their source and pin later pagination to AniList. Explicit provider hints remain strict.
