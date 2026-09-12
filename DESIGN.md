# Goraku Base operating surface

## Direction

An image-led media library with charcoal surfaces, restrained lavender/indigo actions, and the supplied cat-bookmark icon. Preserve the reference-inspired sidebar, rounded cover cards, and clear hierarchy without Spotify's green palette. Dark is the default; light mode uses warm off-white surfaces and darker indigo controls.

## Composition

- Four independent workspaces: Discover, Search, My Library, and Account. Only sidebar selection changes the workspace; scrolling never does.
- The left sidebar and utility header stay fixed while the selected main view scrolls vertically. Below 700px the sidebar becomes a compact, explicitly named icon rail.
- Discover groups its compact introduction, catalog buttons, a featured item, and three independent streaming-style shelves. Anime uses honest MAL-backed labels—Popular now, Currently airing, and Seasonal releases—while other catalogs use Popular now, Trending this week, and Latest releases. Search has its own form, vertical results, and details. Account holds authentication.
- Only Discover uses horizontal rails. Search, Recommendations, and Library use wrapping vertical layouts. Discover rails use fixed portrait cards, desktop arrow controls, native touch scrolling, scroll snapping, and automatic next-page loading from either the rail arrow or the horizontal scroll boundary.
- The Discover hero keeps a two-column composition on wide screens and becomes a full-width image-backed copy layer at intermediate widths so the featured content stays aligned beside a persistent sidebar. Catalog buttons retain accessible text labels and switch to icon-only controls at compact widths.
- Card highlight rows wrap when the rating and release date cannot share a line. Theme changes use a progressive-enhancement View Transition reveal from the theme control, with the existing short color transition as the fallback and reduced motion respected in both paths.
- Cards are portrait, full-bleed image surfaces with a softly blurred dark lower treatment. They contain only a two-line title, five-star rating, release date, and the upper-right bookmark; the entire card opens details. Longer descriptions and type-specific metadata belong in details. For authenticated Users with existing private Tags or Collections, the bookmark opens a focused save-method and destination chooser; a filled bookmark removes the Library Item and cascades its memberships. Users without either resource keep the immediate one-click save path.
- My Library uses cover-and-title cards. The topbar supplies the visible workspace title; filters use concise labels, item cards show only their human-readable media type, and tracking editors expand behind a title-independent “Edit tracking” disclosure. Tags and Collections management is separately collapsible. Account shows the authenticated User's identity and a focused Profile picture editor; the Goraku logo is the default fallback, while uploaded pictures are previewed before an explicit save and can be removed to restore the logo.
- Spacing follows a 4px base: 8–12px within controls/cards, 16–24px between groups, 24–32px between major regions. System sans typography prioritizes operating clarity.

## Interaction and accessibility

Native buttons select workspaces. Hidden workspaces remain mounted to retain results and drafts, but are excluded from presentation and keyboard navigation. Selection resets the main scroll position and focuses the main landmark; returning from details restores focus to the originating card action. Mobile navigation keeps accessible names and title hints.

Next-page navigation appends deduplicated results within the active Discover shelf. Pending or failed later pages do not remove earlier cards. Discover shelves load independently, keep their own errors and retries, and retain append semantics. The server selects the catalog's primary Provider; Anime uses MyAnimeList for popular, airing-ranked, and seasonal lists, with AniList reserved as an availability fallback for server-selected Anime search and Discovery requests. Explicit Provider selections remain strict. Existing Library filters and tracking mutations remain server-confirmed.

Both themes include visible focus, status/error feedback, readable form controls, themed selection/caret/scrollbars, and reduced-motion support. Local theme storage failure falls back to a session-only choice.

## Library artwork boundary

Private Library CRUD still stores and returns User-owned tracking and Media references, without server-side Provider hydration. The browser enriches visible Library references through the existing public Media details API, keyed by Provider, type, and Provider ID. Newly saved search metadata is reused immediately when available.

Presentation metadata is memory-only, bounded to 100 entries with a five-minute freshness window; requests are sequential and paced at 1.1 seconds. Leaving Library aborts the current lookup. User changes clear cached presentation data. Provider failures expose an artwork retry; missing or broken images show Cover unavailable without disabling tracking. The local User identity includes a unique normalized username, registration collects username, email, and password, and login accepts either email or username through one identifier field.

## Verification scope

See docs/phase-8-walkthrough.md for test and browser evidence. Browser fixtures verify presentation and interaction, not live Provider availability or production readiness.
