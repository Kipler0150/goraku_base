# TheGamesDB primary game provider with RAWG fallback

Status: accepted

Phase 4 game search uses TheGamesDB as the default provider because it avoids the Twitch-account dependency required by IGDB. RAWG remains a server-configured availability fallback, preserving a usable game search when TheGamesDB is unavailable.

## Decision

- The canonical provider ID is `thegamesdb`; its display label remains `TheGamesDB`.
- Typed game searches without an explicit provider attempt TheGamesDB first and RAWG only for an unavailable TheGamesDB result.
- Explicit `provider=thegamesdb` and `provider=rawg` requests are strict and never cross-fallback.
- Combined Search uses the same TheGamesDB-primary/RAWG-fallback game lane.
- A successful RAWG fallback identifies `source: "rawg"` and records the safe TheGamesDB failure in `providerErrors`.
- Combined cursors preserve the effective game provider, so later pages do not silently switch providers.
- Credentials remain server-only as `THEGAMESDB_API_KEY` and `RAWG_API_KEY`.

## Consequences

The public search contract does not change. The adapter owns TheGamesDB’s `apikey`, `name`, `fields`, `include`, and page translation, while the coordinator owns fallback and cursor policy. A TheGamesDB failure caused by a rate limit, malformed response, or generic request error is not automatically hidden by RAWG; only availability failures activate the fallback.
