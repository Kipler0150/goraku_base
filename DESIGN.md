# Goraku Base operating surface

## Direction

An image-led media library with charcoal surfaces, restrained lavender/indigo actions, and the supplied cat-bookmark icon. Preserve the reference-inspired sidebar, rounded cover cards, and clear hierarchy without Spotify's green palette. Dark is the default; light mode uses warm off-white surfaces and darker indigo controls.

## Composition

- Five independent workspaces: Discover, Search, My Library, Account, and About & status. Only sidebar selection changes the workspace; scrolling never does.
- The left sidebar and utility header stay fixed while the selected main view scrolls vertically. Below 700px the sidebar becomes a compact, explicitly named icon rail.
- Discover groups its compact introduction, one catalog/source control, a featured item, and three independent Netflix-style shelves: Popular now, Trending this week, and Latest releases. Search has its own form, vertical results, and details. Account holds authentication; About holds connectivity and provider credits.
- Only Discover uses horizontal rails. Search, Recommendations, and Library use wrapping vertical layouts. Discover rails use fixed portrait cards, desktop arrow controls, native touch scrolling, scroll snapping, and an explicit Load more action per shelf.
- Cards are portrait, full-bleed image surfaces with a softly blurred dark lower treatment. They contain only a two-line title, five-star rating, release date, and the upper-right bookmark; the entire card opens details. Longer descriptions and type-specific metadata belong in details.
- My Library uses cover-and-title cards. Tracking editors expand only when selected; Tags and Collections management is separately collapsible.
- Spacing follows a 4px base: 8–12px within controls/cards, 16–24px between groups, 24–32px between major regions. System sans typography prioritizes operating clarity.

## Interaction and accessibility

Native buttons select workspaces. Hidden workspaces remain mounted to retain results and drafts, but are excluded from presentation and keyboard navigation. Selection resets the main scroll position and focuses the main landmark; returning from details restores focus to the originating card action. Mobile navigation keeps accessible names and title hints.

Load more appends deduplicated results below the existing grid or within the active Discover shelf. Pending or failed later pages do not remove earlier cards. Discover shelves load independently, keep their own errors and retries, and retain append semantics. A Provider without a genuine Latest capability remains visible as an honest unsupported shelf. Existing Library filters and tracking mutations remain server-confirmed.

Both themes include visible focus, status/error feedback, readable form controls, themed selection/caret/scrollbars, and reduced-motion support. Local theme storage failure falls back to a session-only choice.

## Library artwork boundary

Private Library CRUD still stores and returns User-owned tracking and Media references, without server-side Provider hydration. The browser enriches visible Library references through the existing public Media details API, keyed by Provider, type, and Provider ID. Newly saved search metadata is reused immediately when available.

Presentation metadata is memory-only, bounded to 100 entries with a five-minute freshness window; requests are sequential and paced at 1.1 seconds. Leaving Library aborts the current lookup. User changes clear cached presentation data. Provider failures expose an artwork retry; missing or broken images show Cover unavailable without disabling tracking. No database migration or new API contract is introduced.

## Verification scope

See docs/phase-8-walkthrough.md for test and browser evidence. Browser fixtures verify presentation and interaction, not live Provider availability or production readiness.
