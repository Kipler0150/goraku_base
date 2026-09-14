# Goraku Base user guide

Goraku Base is an entertainment discovery, bookmarking, and personal tracking app for anime, movies, TV, and games.

Live application: https://goraku-base.onrender.com/

This guide explains the features currently available in the application and how to use them.

## Quick start

1. Open Goraku Base.
2. Use Discover or Search to browse titles. Searching is available without an account.
3. Create an account from Account or Sign up when you want to bookmark titles.
4. Verify the registration email before signing in.
5. Bookmark a title to add it to My Library.
6. Open Edit tracking on a Library Item to record your status, rating, notes, progress, tags, collections, and episode history.

## Main navigation

The sidebar contains four workspaces:

- **Discover**: Browse provider-curated shelves without entering a title.
- **Search**: Search a selected catalog by title or use filters.
- **My Library**: Manage bookmarked titles and personal tracking.
- **Account**: Register, sign in, manage your username and profile picture, reset your password, or sign out.

The Goraku Base wordmark returns to Discover. The theme button switches between dark and light themes and remembers the choice in the current browser.

## Discover

Discover presents a featured title and curated shelves for the selected catalog. Choose Anime, Movies, TV, or Games from the catalog buttons.

The shelves depend on the catalog and its configured Provider:

- Anime: Popular now, Currently airing, and Seasonal releases.
- Movies and TV: Popular now, Trending this week, and Latest releases.
- Games: Popular and Latest releases use RAWG; the unsupported Trending shelf is hidden.

Use the arrows beside a shelf to load more titles. Select a card to open its details. Discovery results are provider-curated; they are not ranked from your Library or treated as personalized recommendations.

## Search

### Search by title

1. Open Search.
2. Choose Anime, Movies, TV, Games, or All from Search media type.
3. Enter a title, or leave the title blank.
4. Press Search or press Enter.

An empty title searches the latest releases. If filters are selected while the title is blank, the results are the latest releases matching those filters.

The All catalog searches the active media types together. It is a combined result view, not a promise of one cross-provider ranking.

Use Load more when another page is available. If a provider or page fails, the existing successful results remain visible and a retry action is provided.

### Advanced filters

Open More filters after choosing a specific catalog:

- **Include adult content** controls whether provider-marked adult titles may appear.
- **Genres** lets you search the genre list and select one or more genres. A result may match any selected genre.
- **Creator** lets you search provider-backed creator suggestions and choose one creator.
- **Minimum Provider Rating** filters Anime, Movies, and TV by the provider rating threshold.
- **Minimum Metacritic** filters Games by the minimum Metacritic score.
- **Clear filters** removes all selected filters.

Advanced genre and creator options depend on the selected provider being available. If the options cannot be loaded, use Retry options.

For All, catalog-specific filters are unavailable. Open More filters there only to change Include adult content.

## Viewing title details

Select a search or Discover card to open its details. The details view can show:

- Cover image and title
- Description
- Provider
- Genres
- Key creators
- Release date, rating, runtime, season count, episode count, or game platforms, depending on the media type

Use Back to results to return to the previous result list.

### Bookmarking a title

1. Sign in.
2. Open a title's details or use its bookmark control on a result card.
3. Choose Bookmark this title.
4. If you already created Tags or Collections, choose whether to save to the Library, a Tag, a Collection, or both a Tag and a Collection.

If no Tags or Collections exist, the title is saved directly to the Library. The same provider, type, and provider ID cannot be bookmarked twice for the same User.

To remove a bookmark, select the filled bookmark control or use Remove title in My Library.

## Recommendations

The details view may show Recommendations supplied by the title's provider. These are related titles returned for the selected title. They are not personalized from your Library, Tags, Collections, or ratings. For Games, if RAWG cannot return related titles, the view clearly switches to a Popular games shelf from RAWG instead of leaving an unavailable panel.

Use Load more recommendations when available. A provider may return no recommendations, may not support the operation, or may be temporarily unavailable. The Popular games fallback has its own pagination and retry state.

## Episode tracking

Episode tracking is available for bookmarked Anime and TV Library Items when the selected provider supplies episode data.

### From title details

1. Sign in.
2. Bookmark the Anime or TV title.
3. Open the title details again.
4. In Episodes, choose a season.
5. Tick each watched episode, or use Mark all watched.
6. Use Clear watched to clear the selected season.

The heading shows the watched count for the selected season. Episode titles are shown when the provider supplies them; otherwise the app displays Episode followed by its number. If an air date is unavailable, no date is shown.

### From My Library

1. Open My Library.
2. Find the Anime or TV Library Item.
3. Open Edit tracking.
4. Use the Episodes section and follow the same season and checkbox controls.

Episode tracking is separate from aggregate Progress. The episode checklist records individual watched episodes; Progress is a quick summary value.

## My Library

My Library is private to the signed-in User. If you are signed out, use Sign in to manage your library.

### Filter Library Items

Use the Library filter controls to narrow the list by:

- Library Status: Planning, In Progress, Completed, On Hold, or Dropped
- Favorite: All Library Items, Favorites only, or Not favorites
- Tag
- Collection

Select Apply filters. The filters remain active while you load more Library Items. Select Clear filters to return to the full list.

### Edit tracking

Open Edit tracking on a Library Item to reveal its personal controls.

#### Library Status

Choose one of:

- Planning
- In Progress
- Completed
- On Hold
- Dropped

This is your personal tracking status. It is different from the provider's release status.

#### Favorite

Select Favorite to mark or unmark the item as a favorite. Favorites can be used in the Library filter.

#### Personal Rating

Select a half-star value from 0 to 10. Use Reset to select a zero rating. Use Clear rating / mark unrated to remove the rating entirely.

Personal Rating is your score and is independent from the Provider Rating displayed on media cards.

#### Progress

The progress editor changes by media type:

- Anime: Episodes watched
- TV: Season and Episode
- Movies: Watched checkbox
- Games: Hours played, allowing up to two decimal places

Select Save progress. Select Clear progress to remove the aggregate progress value.

For Anime and TV, use the Episodes section when you need individual episode history.

#### Note

Enter up to 5,000 characters in the Note field. Select Save note to keep it or Clear note to remove it. Notes are private to your User.

#### Tags and Collections

Tags and Collections are private reusable relationships:

1. Create a Tag or Collection in Organize Tags & Collections.
2. Open Edit tracking on a Library Item.
3. Select the checkbox for each Tag or Collection to attach it.
4. Clear a checkbox to detach it.

Deleting a Tag or Collection removes its memberships but does not remove the Library Items.

#### Remove a Library Item

Use Remove title at the bottom of Edit tracking. This deletes the bookmark and its personal tracking data for that Library Item.

## Tags and Collections

Open Organize Tags & Collections in My Library.

### Create

Enter a name and select Create Tag or Create Collection. Names may contain up to 50 characters.

### Rename

Edit the name beside an existing resource and select Rename.

### Delete

Select Delete tag or Delete collection. Deletion affects only that private grouping and its memberships; saved Library Items remain.

## Account and authentication

### Register

1. Open Account and choose Sign up.
2. Enter a username, email, and password.
3. Select Register.
4. Open the verification email and follow its link.
5. Return to Goraku Base and sign in.

Username rules:

- 3–32 characters
- Lowercase letters, numbers, and underscores
- Unique across Users

Password rules:

- 12–128 characters
- At least one ASCII special character

Disposable or temporary email domains may be rejected. Check your spam folder if the verification email does not arrive, then use Resend verification email.

### Sign in

Use either your email address or username with your password. An email must be verified before the account can sign in.

### Forgot password

1. Open Account.
2. Select Forgot password?.
3. Enter the verified email address.
4. Open the reset email.
5. Choose and save a new password.

Reset links expire, so request a new one if the link is no longer valid.

### Profile picture

The Goraku Base logo is the default profile picture.

1. Open Account while signed in.
2. Hover over the profile picture.
3. Select the edit icon.
4. Choose a JPG, PNG, or WebP image up to 2 MB.
5. Select Save photo.

Select Use Goraku logo to remove the uploaded picture and restore the default logo. The profile picture is shown in the account controls and sidebar.

### Sign out

Use Log out below the profile picture on the Account page. This ends the current session.

## Providers and availability

Goraku Base gathers media metadata from external providers and normalizes it for the application:

- Anime: MyAnimeList, with AniList availability fallback
- Movies and TV: TMDB
- Games: TheGamesDB for title search and details; RAWG for Discovery, filters, recommendations, and availability fallback

Provider availability can change because of credentials, rate limits, outages, unsupported operations, or incomplete provider data. A provider error is different from a successful search with no matching titles. Use the relevant Retry action when one is shown.

**A save action fails immediately in local development.** Open the client at `http://localhost:5173`. The API intentionally accepts mutations only from the configured `APP_ORIGIN`; Vite now fails instead of silently moving to port 5174 when port 5173 is already occupied. Stop the duplicate client process, restart the client, and use the displayed configured origin.

Free hosting may also have a cold start after inactivity, so the first request can take longer than later requests.

## Glossary

**Media** — A title or game described by external provider metadata. It is not a user's personal tracking record.

**Provider** — An external catalog such as MyAnimeList, AniList, TMDB, TheGamesDB, or RAWG.

**Library Item** — A User's bookmarked reference to Media, including personal status, rating, progress, notes, Tags, and Collections.

**User** — A person with a Goraku Base account who owns Library Items and private tracking data.

**Username** — The unique public display name chosen during registration.

**Verified Email** — An email address confirmed through the verification link sent by Goraku Base.

**Bookmark** — The action of saving a Media reference to My Library.

**Library Status** — Your personal state for a Library Item: Planning, In Progress, Completed, On Hold, or Dropped.

**Release Status** — The provider's state for a title, such as ongoing or released. It is not your personal Library Status.

**Provider Rating** — A score supplied by the external catalog.

**Personal Rating** — Your own 0–10 score for a Library Item.

**Progress** — Aggregate participation information, such as episodes watched, a TV season and episode, a movie watched flag, or game hours played.

**Episode Tracking** — Individual watched/unwatched episode records for supported Anime and TV Library Items.

**Tag** — A private reusable label that can be attached to multiple Library Items.

**Collection** — A private named grouping of Library Items.

**Discovery Shelf** — A provider-curated list such as Popular now, Currently airing, or Latest releases.

**Provider-owned Recommendation** — A related-title list returned by the provider for a selected title. It is not personalized from your Library.

**Adult Content** — A title marked by a provider as intended for adult audiences. Include adult content controls whether those provider markings are included in results.

## Common issues

**I cannot see My Library.** Sign in first. Library data is tied to your authenticated session.

**A provider is unavailable.** Select Retry. If the problem continues, the provider may be rate-limited, unavailable, missing configuration, or unable to support that operation.

**No recommendations appear.** The provider may have returned an empty related-title list or may not support recommendations for that title.

**Episodes are unavailable.** Confirm that the title is bookmarked and that you are signed in. Episode data is provider-dependent; use aggregate Progress if the provider does not return an episode list.

**The verification or reset email is missing.** Check spam or junk folders and use the resend action. Make sure the address is correct.

**The application seems slow on the first visit.** The free Render service may be waking from sleep. Wait briefly and retry.

**A cover image is missing.** The provider did not return a usable image or the image host was temporarily unavailable. The Library view provides a retry action when artwork loading fails.
