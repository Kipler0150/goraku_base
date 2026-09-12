# Capability-driven Discover shelves

Status: accepted

The Discover Workspace uses independent shelves with the server-selected primary Provider policy. Movies, TV, and games use Popular now, Trending this week, and Latest releases; Anime uses Popular now, Currently airing, and Seasonal releases. The Anime shelves map to MyAnimeList's popularity ranking, airing ranking, and current-season endpoint, with AniList used only as an availability fallback when MyAnimeList cannot serve a server-selected request. Explicit API Provider selections remain strict. Shelves scroll horizontally only within Discover, while other surfaces remain vertical, and the next rail arrow automatically appends the next page. Unsupported shelves remain visible with an honest state instead of being replaced or mislabeled, and shelf failures do not block successful shelves.

This preserves Provider ownership and ranking semantics while giving Discover the Netflix-style stacked browsing rhythm without introducing personalized ranking or a mixed-Provider global order.
