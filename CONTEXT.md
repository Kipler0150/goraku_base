# Goraku Base

Goraku Base brings entertainment discovery and personal tracking into one library.

## Language

**Media**: An entertainment entry described by an external provider, independently of any user's tracking preferences.

**Provider**: An external source of media metadata, initially AniList, TMDB, TheGamesDB, or RAWG.

**Library Item**: A user's saved reference to Media, together with that user's tracking information.
_Avoid_: Media when referring to personal tracking data.

**User**: A person with a Goraku Base account who can own Library Items.
_Avoid_: Account when referring to the person.

**Authentication Identity**: A login identity associated with a User, such as a local credential or a future external identity.

**Local Credential**: An email and password identity managed by Goraku Base for authenticating a User.

**Session**: A time-limited authenticated relationship between a User and a client.

**Ownership Authorization**: The rule that a User may access and change only their own Library Items.
_Avoid_: Client-supplied user ownership

**Release Status**: The publication or release state of Media.
_Avoid_: Status without qualification.

**Library Status**: A user's tracking state: Planning, In Progress, Completed, On Hold, or Dropped.
_Avoid_: Release status when referring to personal progress.

**Provider Rating**: A score supplied by a Provider, interpreted with its rating scale.

**Creator**: A person or organization credited on Media with a normalized, provider-independent role.

**Media Metadata**: Provider-owned fields that are specific to a media type, such as episode counts, runtime, or game platforms; it is not personal tracking data.

**TV**: A television series represented as a Media type.
_Avoid_: TV episode, show when referring to the Media type

**Adult Content**: Media that a Provider marks as intended for adult audiences; Goraku Base does not infer this classification.

**Content Visibility Preference**: A user's choice to include or exclude Adult Content from discovery results.

**Combined Search**: A discovery request spanning the active media types: Anime, movies, TV, and games. It is not a Media type and does not promise one cross-provider relevance ranking.
_Avoid_: Global search, unified ranking

**Provider Failure**: An attempted Provider did not return a valid search page. A Provider Failure is distinct from a valid empty result, which means the Provider answered successfully with no matching Media.

**Provider Availability Failure**: A Provider Failure classified as unavailable because of missing or invalid credentials or an explicit provider-unavailable response; it may activate a configured fallback. Rate-limit, timeout, transport, malformed-response, and generic failures remain Provider Failures but do not activate this fallback category.

**Provider Capability**: A Provider's supported operation for a Media type, such as search, details, trending, popular, or Provider-owned Recommendations. An unsupported capability is not an empty result.

**Application Rate Limit**: Goraku Base's own boundary on caller requests, independent of a Provider's limits or failures.

**Personal Rating**: A score assigned by a User to a Library Item on a 0–10 scale, independent of the Provider Rating. It is equivalent to a five-star presentation where each half-star represents one point.

**Note**: User-owned freeform text attached to a Library Item.

**Progress**: A user's recorded position or amount of participation in a Library Item, measured as episodes for Anime, season and episode position for TV, watched state for movies, or hours for games.

**Collection**: A private, User-owned named grouping of Library Items; a Library Item may belong to multiple Collections.

**Tag**: A private, User-owned reusable label applied to Library Items.

**Discovery**: A Provider-owned way to find or browse Media, including search and supported trending or popular lists; it does not imply a User's Library or a global ranking.

**Provider-owned Recommendation**: A Provider-returned list of Media related to an anchor Media entry. It is not personalized from a User's Library and does not promise cross-Provider ranking or identity matching.

**Media Metadata Cache**: A bounded, temporary store of Provider-owned Media responses used to reduce repeated retrieval. It never contains User-owned Library Items, tracking fields, Tags, Collections, or Sessions.
