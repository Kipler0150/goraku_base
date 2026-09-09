import { useCallback, useState } from 'react';
import { useHealthCheck } from './hooks/useHealthCheck.js';
import { useAuth } from './hooks/useAuth.js';
import { useLibrary } from './hooks/useLibrary.js';
import { useMediaSearch } from './hooks/useMediaSearch.js';
import { mediaIdentity } from './mediaIdentity.js';
import './styles.css';

const TMDB_URL = 'https://www.themoviedb.org/';
const TMDB_LOGO_URL = 'https://www.themoviedb.org/assets/2/v4/logos/primary-green.svg';
const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const ANILIST_URL = 'https://anilist.co/';
const MYANIMELIST_URL = 'https://myanimelist.net/';
const THEGAMESDB_URL = 'https://thegamesdb.net/';
const RAWG_URL = 'https://rawg.io/';

const PROVIDERS = Object.freeze({
  anilist: { label: 'AniList', url: ANILIST_URL },
  myanimelist: { label: 'MyAnimeList', url: MYANIMELIST_URL },
  tmdb: { label: 'TMDB', url: TMDB_URL },
  thegamesdb: { label: 'TheGamesDB', url: THEGAMESDB_URL },
  rawg: { label: 'RAWG', url: RAWG_URL }
});
const PROVIDER_ORDER = Object.freeze(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);

function ConnectionStatus({ status, error, onRetry }) {
  const isLoading = status === 'loading';
  const isConnected = status === 'connected';

  const title = isLoading
    ? 'Checking backend connection'
    : isConnected
      ? 'Backend connected'
      : 'Backend unavailable';
  const message = isLoading
    ? 'Sending a bounded request to the local API.'
    : isConnected
      ? 'goraku-base-api answered with a valid health payload.'
      : error?.code === 'TIMEOUT'
        ? 'The API did not respond in time. Start Express, then try again.'
        : 'The API could not confirm its health. Start Express, then try again.';

  return (
    <div className={`connection-status connection-status--${status}`} role="status" aria-live="polite" aria-atomic="true">
      <span className="status-signal" aria-hidden="true" />
      <div className="status-copy">
        <strong>{title}</strong>
        <span>{message}</span>
      </div>
      {!isLoading && !isConnected && (
        <button type="button" className="retry-button" onClick={onRetry}>
          Retry connection
        </button>
      )}
    </div>
  );
}

function SignalMark() {
  return (
    <svg className="signal-mark" viewBox="0 0 48 48" aria-hidden="true">
      <path d="M8 10h32M8 19h22M8 28h32M8 37h15" />
      <path d="M34 17v20M29 22l5-5 5 5" />
    </svg>
  );
}

function formatReleaseDate(releaseDate) {
  if (!releaseDate?.year) return 'Release date unavailable';
  const month = releaseDate.month ? `-${String(releaseDate.month).padStart(2, '0')}` : '';
  const day = releaseDate.day ? `-${String(releaseDate.day).padStart(2, '0')}` : '';
  return `${releaseDate.year}${month}${day}`;
}

function formatReleaseStatus(status) {
  const labels = {
    ANNOUNCED: 'Announced',
    ONGOING: 'Ongoing',
    RELEASED: 'Released',
    CANCELLED: 'Cancelled'
  };
  return labels[status] ?? 'Release status unavailable';
}

function formatRating(providerRating) {
  if (!providerRating || !Number.isFinite(providerRating.normalized)) return 'Rating unavailable';
  return `${providerRating.normalized.toFixed(1)} / 10`;
}

function formatCount(value, suffix) {
  return Number.isInteger(value) ? `${value} ${suffix}` : `${suffix} unavailable`;
}

function formatMetadataCount(value, suffix, unavailableLabel = `${suffix} unavailable`) {
  return Number.isInteger(value) ? `${value} ${suffix}` : unavailableLabel;
}

function formatMetadataList(value, label) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : `${label} unavailable`;
}

function formatApiError(error, fallback) {
  if (error?.code === 'VALIDATION_ERROR' && Array.isArray(error.details) && error.details.length > 0) {
    return error.details.map((detail) => detail.message).filter(Boolean).join(' ');
  }
  if (typeof error?.message === 'string' && error.code !== 'INVALID_PAYLOAD' && error.name !== 'TypeError') {
    return error.message;
  }
  return fallback;
}

const MEDIA_TYPE_LABELS = Object.freeze({
  anime: 'Anime',
  movie: 'Movies',
  tv: 'TV',
  game: 'Games',
  all: 'All'
});

function getMediaTypeLabel(type) {
  return MEDIA_TYPE_LABELS[type] ?? MEDIA_TYPE_LABELS.anime;
}

function getMediaTypeNoun(type) {
  if (type === 'anime') return 'anime';
  if (type === 'movie') return 'movies';
  if (type === 'tv') return 'TV';
  if (type === 'game') return 'games';
  return 'all media';
}

function getCardFacts(media) {
  if (media.type === 'MOVIE') {
    return [['Runtime', formatMetadataCount(media.metadata?.runtimeMinutes, 'Minutes', 'Runtime unavailable')]];
  }
  if (media.type === 'TV') {
    return [
      ['Seasons', formatMetadataCount(media.metadata?.seasonCount, 'Seasons')],
      ['Episodes', formatMetadataCount(media.metadata?.episodeCount, 'Episodes')]
    ];
  }
  if (media.type === 'GAME') {
    return [
      ['Platforms', formatMetadataList(media.metadata?.platforms, 'Platforms')],
      ['Developers', formatMetadataList(media.metadata?.developers, 'Developers')],
      ['Publishers', formatMetadataList(media.metadata?.publishers, 'Publishers')]
    ];
  }
  return [
    ['Episodes', formatCount(media.metadata?.episodeCount, 'Episodes')],
    ['Duration', formatCount(media.metadata?.episodeDurationMinutes, 'Minutes')]
  ];
}

function MediaCard({ media, user, libraryItem, libraryAction, onSave, onRequestSignIn }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = media.title || 'Title unavailable';
  const hasImage = Boolean(media.image) && !imageFailed;
  const identity = mediaIdentity(media);
  const isSaving = libraryAction?.type === 'save' && libraryAction.key === identity;
  const isSaved = Boolean(libraryItem);

  return (
    <article className="media-card">
      <div className="media-card__image">
        {hasImage ? (
          <img
            src={media.image}
            alt={`${title} cover`}
            loading="lazy"
            onError={() => setImageFailed(true)}
          />
        ) : (
          <span className="media-card__image-placeholder">Cover unavailable</span>
        )}
        {media.isAdult === true && <span className="media-card__adult">Adult</span>}
      </div>
      <div className="media-card__body">
        <p className="media-card__status">{formatReleaseStatus(media.releaseStatus)}</p>
        <h3>{title}</h3>
        <dl className="media-card__facts">
          <div>
            <dt>Release</dt>
            <dd>{formatReleaseDate(media.releaseDate)}</dd>
          </div>
          <div>
            <dt>Rating</dt>
            <dd>{formatRating(media.providerRating)}</dd>
          </div>
          {getCardFacts(media).map(([label, value]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
        </dl>
        <button
          type="button"
          className="library-action"
          onClick={() => user ? onSave(media) : onRequestSignIn(media)}
          disabled={isSaved || isSaving}
        >
          {isSaving ? 'Saving…' : isSaved ? 'Saved to library' : 'Save to library'}
        </button>
      </div>
    </article>
  );
}

function SearchSkeletons() {
  return (
    <ul className="media-grid media-grid--skeletons" aria-hidden="true">
      {[1, 2, 3, 4].map((skeleton) => (
        <li className="media-card media-card--skeleton" key={skeleton}>
          <div className="skeleton-block skeleton-block--image" />
          <div className="skeleton-copy">
            <div className="skeleton-block skeleton-block--short" />
            <div className="skeleton-block skeleton-block--title" />
            <div className="skeleton-block skeleton-block--line" />
            <div className="skeleton-block skeleton-block--line skeleton-block--line-short" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function SearchState({ children, tone = 'quiet', role }) {
  return <div className={`search-state search-state--${tone}`} role={role}>{children}</div>;
}

const COMBINED_GROUPS = Object.freeze([
  { type: 'ANIME', label: 'Anime' },
  { type: 'MOVIE', label: 'Movies' },
  { type: 'TV', label: 'TV' },
  { type: 'GAME', label: 'Games' }
]);

function getProviderLabel(provider) {
  return PROVIDERS[provider]?.label ?? provider?.toUpperCase() ?? 'Provider';
}

function getCurrentProviders(search) {
  const resultProviders = new Set(search.state.results.map((media) => media.provider));
  const orderedProviders = PROVIDER_ORDER.filter((provider) => resultProviders.has(provider));
  const unknownProviders = [...resultProviders].filter((provider) => !PROVIDERS[provider]);
  const providers = [...orderedProviders, ...unknownProviders];
  if (providers.length > 0) return providers;
  if (search.state.source && search.state.source !== 'combined') return [search.state.source];
  if (search.type === 'anime') return ['anilist', 'myanimelist'];
  return [];
}

function ProviderAttribution({ search }) {
  const providers = getCurrentProviders(search);
  if (providers.length === 0) return `SEARCHING ${getMediaTypeLabel(search.type).toUpperCase()} CATALOG`;

  if (providers.length === 1) {
    const provider = providers[0];
    return (
      <a href={PROVIDERS[provider]?.url} target="_blank" rel="noreferrer">
        UNOFFICIAL {getProviderLabel(provider).toUpperCase()} INTEGRATION
      </a>
    );
  }

  return (
    <>
      <span>UNOFFICIAL </span>
      {providers.map((provider, index) => (
        <span key={provider}>
          {index > 0 && ' / '}
          <a href={PROVIDERS[provider]?.url} target="_blank" rel="noreferrer">
            {getProviderLabel(provider).toUpperCase()}
          </a>
        </span>
      ))}
      <span>{providers.length > 1 ? ' INTEGRATIONS' : ' INTEGRATION'}</span>
    </>
  );
}

function getCombinedGroups(results) {
  return COMBINED_GROUPS
    .map((group) => ({
      ...group,
      results: results.filter((media) => media.type === group.type)
    }))
    .filter((group) => group.results.length > 0);
}

function isRetryableProviderError(provider, pagination) {
  if (!pagination?.continuation) return false;
  // AniList errors covered by a successful MyAnimeList fallback are informational.
  if (provider === 'anilist' && pagination.providers?.myanimelist && !pagination.providers?.anilist) return false;
  // TheGamesDB errors covered by a successful RAWG fallback are informational.
  if (provider === 'thegamesdb' && pagination.providers?.rawg && !pagination.providers?.thegamesdb) return false;
  return true;
}

function ProviderFailureNotices({ search, isBusy }) {
  if (search.type !== 'all' || search.state.providerErrors.length === 0) return null;

  return (
    <aside className="provider-errors" role="alert" aria-label="Provider failures">
      <p>Some provider lanes are unavailable. Successful results remain visible.</p>
      <ul>
        {search.state.providerErrors.map(({ provider }) => {
          const label = getProviderLabel(provider);
          const canRetry = isRetryableProviderError(provider, search.state.pagination);
          const isRetrying = search.state.loadingProvider === provider;
          return (
            <li key={provider}>
              <span>{label} is temporarily unavailable.</span>
              {canRetry ? (
                <button
                  type="button"
                  className="search-action search-action--secondary"
                  onClick={() => search.retryProvider(provider)}
                  disabled={isBusy}
                >
                  {isRetrying ? `Retrying ${label}…` : `Retry ${label} search`}
                </button>
              ) : (
                <span className="provider-errors__detail">
                  {provider === 'anilist' ? 'Anime results are using MyAnimeList.' : 'Game results are using RAWG.'}
                </span>
              )}
            </li>
          );
        })}
      </ul>
    </aside>
  );
}

function MediaGrid({ results, label, user, library, onSave, onRequestSignIn }) {
  return (
    <ul className="media-grid" aria-label={`${label} search results`}>
      {results.map((media) => (
        <li key={mediaIdentity(media)}>
          <MediaCard
            media={media}
            user={user}
            libraryItem={library.results.find((item) => mediaIdentity(item) === mediaIdentity(media))}
            libraryAction={library.action}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
          />
        </li>
      ))}
    </ul>
  );
}

function CombinedResults({ results, user, library, onSave, onRequestSignIn }) {
  return (
    <div className="combined-results">
      {getCombinedGroups(results).map((group) => {
        const headingId = `combined-${group.type.toLowerCase()}-title`;
        return (
          <section className="combined-group" key={group.type} aria-labelledby={headingId}>
            <div className="combined-group__heading">
              <p className="section-index">COMBINED / {group.label.toUpperCase()}</p>
              <h3 id={headingId}>{group.label}</h3>
            </div>
            <MediaGrid
              results={group.results}
              label={group.label}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
            />
          </section>
        );
      })}
    </div>
  );
}

function SearchResults({ search, user, library, onSave, onRequestSignIn }) {
  const { state, isBusy, retrySearch, loadMore, retryPage } = search;
  const typeLabel = getMediaTypeLabel(search.type);
  const typeNoun = getMediaTypeNoun(search.type);
  const statusMessage = state.status === 'initial'
    ? `Ready to search ${typeNoun}.`
    : state.status === 'loading'
      ? `Searching ${typeNoun} for ${state.query}.`
      : state.loadingPage
        ? `Loading more ${typeNoun} results for ${state.query}.`
      : state.status === 'error'
        ? `${typeLabel} search is unavailable.`
        : state.results.length === 0
          ? `No ${typeNoun} results for ${state.query}.`
          : `${state.results.length} ${typeNoun} results loaded.`;

  return (
    <div className="search-results" id="media-results" role="region" aria-label={`${typeLabel} search results`} aria-busy={isBusy}>
      <p className="search-announcement" aria-live="polite" aria-atomic="true">{statusMessage}</p>

      {state.status === 'initial' && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">/ / /</span>
          <h3>Start with a title.</h3>
          <p>Search the {typeNoun} catalog through the Goraku Base signal.</p>
        </SearchState>
      )}

      {state.status === 'loading' && (
        <>
          <p className="visually-hidden">Searching. Results will appear below.</p>
          <SearchSkeletons />
        </>
      )}

      {state.status === 'error' && (
        <SearchState tone="error" role="alert">
          <span className="state-mark" aria-hidden="true">!</span>
          <h3>That signal did not come through.</h3>
          <p>{typeLabel} search is temporarily unavailable. Try the request again.</p>
          <button type="button" className="search-action search-action--secondary" onClick={retrySearch}>Retry search</button>
        </SearchState>
      )}

      {state.status === 'success' && <ProviderFailureNotices search={search} isBusy={isBusy} />}

      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>No results for “{state.query}”.</h3>
          <p>Try a shorter title, an alternate spelling, or another {typeNoun === 'TV' ? 'series' : 'title'}.</p>
        </SearchState>
      )}

      {state.status === 'success' && state.results.length > 0 && (
        <>
          {search.type === 'all' ? (
            <CombinedResults
              results={state.results}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
            />
          ) : (
            <MediaGrid
              results={state.results}
              label={typeLabel}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
            />
          )}

          {state.pageError && (
            <div className="page-error" role="alert">
              <span>Page {state.pageError.page} could not be loaded.</span>
              <button type="button" className="search-action search-action--secondary" onClick={retryPage}>
                Retry page {state.pageError.page}
              </button>
            </div>
          )}

          {state.pagination?.hasMore && (
            <div className="load-more-wrap">
              <button
                type="button"
                className="search-action search-action--primary"
                onClick={loadMore}
                disabled={isBusy}
                aria-label={`Load more ${typeNoun} results for ${state.query}`}
              >
                {state.loadingPage ? 'Loading more…' : 'Load more'}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function MediaSearch({ user, library, onSave, onRequestSignIn }) {
  const search = useMediaSearch({ type: 'anime' });
  const typeLabel = getMediaTypeLabel(search.type);

  return (
    <section className="search-section" id="media-search" aria-labelledby="media-search-title">
      <div className="section-heading">
        <div>
          <h2 id="media-search-title">Search the signal.</h2>
          <p className="section-index">DISCOVERY / {typeLabel.toUpperCase()}</p>
        </div>
        <p className="search-attribution"><ProviderAttribution search={search} /></p>
      </div>

      <form className="search-form" onSubmit={(event) => { event.preventDefault(); search.submitSearch(); }}>
        <div className="search-type-field">
          <label className="search-form__label" htmlFor="media-type">Search media type</label>
          <select
            id="media-type"
            value={search.type}
            onChange={(event) => search.changeType(event.target.value)}
            aria-describedby="media-type-help"
          >
            <option value="anime">Anime</option>
            <option value="movie">Movies</option>
            <option value="tv">TV</option>
            <option value="game">Games</option>
            <option value="all">All</option>
          </select>
        </div>
        <label className="search-form__label" htmlFor="media-query">Search {getMediaTypeNoun(search.type)} by title</label>
        <div className="search-field">
          <input
            id="media-query"
            type="search"
            value={search.query}
            onChange={(event) => search.changeQuery(event.target.value)}
            placeholder={search.type === 'anime'
              ? 'Try Fullmetal Alchemist'
              : search.type === 'movie'
                ? 'Try Arrival'
                : search.type === 'tv'
                  ? 'Try Severance'
                  : search.type === 'game'
                    ? 'Try Zelda'
                    : 'Try a title across media'}
            autoComplete="off"
            aria-describedby="media-query-help"
            aria-controls="media-results"
          />
          <button className="search-action search-action--primary search-submit" type="submit">Search</button>
        </div>
        <p className="search-form__help" id="media-query-help">Search starts after a short pause. Press Enter to search now.</p>
        <p className="visually-hidden" id="media-type-help">Changing the media type clears the current results and searches the selected catalog.</p>
        <label className="adult-toggle">
          <input
            type="checkbox"
            checked={search.includeAdult}
            onChange={(event) => search.toggleIncludeAdult(event.target.checked)}
          />
          <span>Include adult content</span>
        </label>
      </form>

      <SearchResults
        search={search}
        user={user}
        library={library}
        onSave={onSave}
        onRequestSignIn={onRequestSignIn}
      />
    </section>
  );
}

function AuthPanel({ auth, mode, onModeChange, signInPrompt }) {
  if (auth.status === 'loading') {
    return (
      <section className="account-section" id="account" aria-labelledby="account-title" aria-busy="true">
        <h2 id="account-title" className="visually-hidden">Account</h2>
        <div className="account-loading" aria-live="polite">Checking local session…</div>
      </section>
    );
  }

  if (auth.user) {
    return (
      <section className="account-section" id="account" aria-labelledby="account-title">
        <div className="account-bar">
          <div>
            <p className="section-index">ACCOUNT / ACTIVE SESSION</p>
            <h2 id="account-title">Your signal is saved.</h2>
            <p className="account-email">Signed in as <strong>{auth.user.email}</strong></p>
          </div>
          <button type="button" className="search-action search-action--secondary" onClick={auth.logout} disabled={auth.isBusy}>
            {auth.status === 'logging-out' ? 'Signing out…' : 'Log out'}
          </button>
        </div>
        {auth.error && <p className="form-error" role="alert">{formatApiError(auth.error, 'We could not complete that account action.')}</p>}
      </section>
    );
  }

  const isLogin = mode === 'login';
  const title = isLogin ? 'Sign in to your signal.' : 'Create your local signal.';

  return (
    <section className="account-section" id="account" aria-labelledby="account-title">
      <div className="account-heading">
        <div>
          <p className="section-index">ACCOUNT / LOCAL SESSION</p>
          <h2 id="account-title">{title}</h2>
        </div>
        <p className="account-note">Search remains public. A local session unlocks personal library actions.</p>
      </div>
      {signInPrompt && <p className="auth-prompt" aria-live="polite">{signInPrompt}</p>}
      {auth.status === 'error' && auth.error && (
        <p className="form-error" role="alert">{formatApiError(auth.error, 'Authentication is currently unavailable.')}</p>
      )}
      <div className="auth-switcher" aria-label="Authentication options">
        <button type="button" className={isLogin ? 'auth-switcher__active' : ''} onClick={() => onModeChange('login')}>Sign in</button>
        <button type="button" className={!isLogin ? 'auth-switcher__active' : ''} onClick={() => onModeChange('register')}>Register</button>
      </div>
      <form
        className="auth-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const authenticated = isLogin
            ? await auth.login({ email: form.get('email'), password: form.get('password') })
            : await auth.register({ email: form.get('email'), password: form.get('password') });
          if (authenticated) formElement.reset();
        }}
      >
        <label className="search-form__label" htmlFor="auth-email">Email</label>
        <input id="auth-email" name="email" type="email" required autoComplete="email" />
        <label className="search-form__label" htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" required autoComplete={isLogin ? 'current-password' : 'new-password'} />
        {!isLogin && <p className="auth-form__help">Use 12–128 characters and at least one ASCII special character.</p>}
        {auth.error && auth.status !== 'error' && (
          <p className="form-error" role="alert">{formatApiError(auth.error, isLogin ? 'Sign in could not be completed.' : 'Registration could not be completed.')}</p>
        )}
        <button type="submit" className="search-action search-action--primary" disabled={auth.isBusy}>
          {auth.isBusy ? (isLogin ? 'Signing in…' : 'Registering…') : isLogin ? 'Sign in' : 'Register'}
        </button>
      </form>
    </section>
  );
}

function libraryItemLabel(item) {
  return `${getProviderLabel(item.provider)} ${item.type.toLowerCase()} ${item.providerId}`;
}

function formatLibraryStatus(status) {
  return status.replaceAll('_', ' ');
}

function LibraryItem({ item, library }) {
  const label = libraryItemLabel(item);
  const isUpdating = library.action?.id === item.id;

  return (
    <li className="library-item">
      <div className="library-item__identity">
        <p className="section-index">{getProviderLabel(item.provider).toUpperCase()} / {item.type}</p>
        <h3>{item.providerId}</h3>
        <p>Stored reference: {label}. Provider metadata is not loaded in this view.</p>
      </div>
      <div className="library-item__controls">
        <label htmlFor={`library-status-${item.id}`}>Library status for {label}</label>
        <select
          id={`library-status-${item.id}`}
          value={item.libraryStatus}
          onChange={(event) => library.update(item.id, { libraryStatus: event.target.value })}
          disabled={isUpdating}
        >
          <option value="PLANNING">{formatLibraryStatus('PLANNING')}</option>
          <option value="IN_PROGRESS">{formatLibraryStatus('IN_PROGRESS')}</option>
          <option value="COMPLETED">{formatLibraryStatus('COMPLETED')}</option>
          <option value="ON_HOLD">{formatLibraryStatus('ON_HOLD')}</option>
          <option value="DROPPED">{formatLibraryStatus('DROPPED')}</option>
        </select>
        <label className="favorite-toggle">
          <input
            type="checkbox"
            aria-label={`Favorite ${label}`}
            checked={item.favorite}
            onChange={(event) => library.update(item.id, { favorite: event.target.checked })}
            disabled={isUpdating}
          />
          <span>Favorite</span>
        </label>
        <button
          type="button"
          className="search-action search-action--secondary"
          onClick={() => library.remove(item.id)}
          disabled={isUpdating}
        >
          {library.action?.type === 'remove' && isUpdating ? 'Removing…' : `Remove ${label}`}
        </button>
      </div>
    </li>
  );
}

function LibraryView({ auth, library, onRequestSignIn }) {
  const loading = Boolean(auth.user && (library.status === 'idle' || library.status === 'loading'));

  return (
    <section className="library-section" id="library" aria-labelledby="library-title" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2 id="library-title">Your library.</h2>
          <p className="section-index">PERSONAL SIGNAL / REFERENCES</p>
        </div>
        <code>GET /api/library</code>
      </div>

      {!auth.user && (
        <div className="library-state">
          <span className="state-mark" aria-hidden="true">LOCK</span>
          <h3>Sign in to see your library.</h3>
          <p>Search is public, but saved references belong to your local session.</p>
          <button type="button" className="search-action search-action--primary" onClick={onRequestSignIn}>
            Sign in to manage your library
          </button>
        </div>
      )}

      {auth.user && loading && (
        <div className="library-state" aria-live="polite">
          <span className="state-mark" aria-hidden="true">/ / /</span>
          <h3>Loading your library.</h3>
          <p>Reading your stored references from the local API.</p>
        </div>
      )}

      {auth.user && library.status === 'error' && (
        <div className="library-state library-state--error" role="alert">
          <span className="state-mark" aria-hidden="true">!</span>
          <h3>The library signal did not come through.</h3>
          <p>{formatApiError(library.error, 'Library storage is currently unavailable.')}</p>
          <button type="button" className="search-action search-action--secondary" onClick={library.retry}>Retry library</button>
        </div>
      )}

      {auth.user && library.status === 'success' && library.results.length === 0 && (
        <div className="library-state">
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>Your library is clear.</h3>
          <p>Save a result from Search the signal to create your first stored reference.</p>
        </div>
      )}

      {auth.user && library.status === 'success' && library.results.length > 0 && (
        <ul className="library-list" aria-label="Saved library items">
          {library.results.map((item) => <LibraryItem item={item} library={library} key={item.id} />)}
        </ul>
      )}

      {auth.user && library.error && library.status !== 'error' && (
        <p className="form-error" role="alert">{formatApiError(library.error, 'The library action could not be completed.')}</p>
      )}
    </section>
  );
}

export default function App() {
  const { status, error, retry } = useHealthCheck();
  const [authMode, setAuthMode] = useState('login');
  const [signInPrompt, setSignInPrompt] = useState('');
  const auth = useAuth({ checkOnMount: true });

  const handleAuthenticationRequired = useCallback(() => {
    auth.clearSession();
    setAuthMode('login');
    setSignInPrompt('Your session has expired. Sign in again to manage your library.');
  }, [auth.clearSession]);

  const library = useLibrary({
    enabled: auth.status === 'authenticated',
    onAuthenticationRequired: handleAuthenticationRequired
  });

  const requestSignIn = () => {
    setAuthMode('login');
    setSignInPrompt('Sign in to save this reference to your library.');
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <header className="site-header">
        <a className="wordmark" href="/" aria-label="Goraku Base home">
          <SignalMark />
          <span>GORAKU BASE</span>
        </a>
        <nav aria-label="Project navigation">
          <a href="#media-search">Media search</a>
          <a href="#library">Library</a>
          <a href="#account">Account</a>
          <a href="#health-check">Health check</a>
          <a href="#next-signal">Next signal</a>
          <a href="#credits">Credits</a>
        </nav>
      </header>

      <main id="main-content">
        <section className="intro" aria-labelledby="page-title">
          <h1 id="page-title">Find a better<br /><span>signal.</span></h1>
          <div>
            <div className="page-code" aria-label="Page 003: media discovery">PAGE 003 / MEDIA DISCOVERY</div>
            <p className="intro-copy">
              Search normalized anime, movie, TV, and game metadata through the Goraku Base boundary. Combined Search keeps each provider lane visible behind the signal.
            </p>
          </div>
        </section>

        <AuthPanel auth={auth} mode={authMode} onModeChange={(nextMode) => { setAuthMode(nextMode); setSignInPrompt(''); }} signInPrompt={signInPrompt} />

        <MediaSearch
          user={auth.user}
          library={library}
          onSave={library.save}
          onRequestSignIn={requestSignIn}
        />

        <LibraryView auth={auth} library={library} onRequestSignIn={requestSignIn} />

        <section className="health-section" id="health-check" aria-labelledby="health-title">
          <div className="section-heading">
            <div>
              <h2 id="health-title">Backend connection</h2>
              <p className="section-index">LIVE CHECK / 01</p>
            </div>
            <code>GET /api/health</code>
          </div>

          <ConnectionStatus status={status} error={error} onRetry={retry} />

          <dl className="signal-details">
            <div>
              <dt>Expected status</dt>
              <dd>200 OK</dd>
            </div>
            <div>
              <dt>Service identity</dt>
              <dd>goraku-base-api</dd>
            </div>
            <div>
              <dt>Browser request</dt>
              <dd>relative /api path</dd>
            </div>
          </dl>
        </section>

        <section className="next-section" id="next-signal" aria-labelledby="next-title">
          <div className="section-heading section-heading--quiet">
            <div>
              <h2 id="next-title">The signal gets richer next.</h2>
              <p className="section-index">ROADMAP / QUEUED</p>
            </div>
          </div>
          <p>Discovery, local authentication, and reference libraries are live for local and staging use. Google authentication, account recovery, and richer tracking remain future signals.</p>
        </section>
      </main>

      <footer className="site-footer" id="credits" aria-labelledby="credits-title">
        <div className="site-footer__identity">
          <span>GORAKU BASE / PHASE 5</span>
          <span>ANILIST + MYANIMELIST + TMDB + THEGAMESDB + RAWG / UNOFFICIAL</span>
        </div>
        <div className="tmdb-credits">
          <div>
            <p className="section-index">CREDITS / PROVIDER</p>
            <h2 id="credits-title">TMDB</h2>
          </div>
          <div className="tmdb-credits__notice">
            <a href={TMDB_URL} target="_blank" rel="noreferrer">
              <img className="tmdb-credits__logo" src={TMDB_LOGO_URL} alt="TMDB" width="128" height="36" />
            </a>
            <p>{TMDB_NOTICE}</p>
            <nav className="provider-credits" aria-label="Provider credits">
              <a href={ANILIST_URL} target="_blank" rel="noreferrer">AniList</a>
              <a href={MYANIMELIST_URL} target="_blank" rel="noreferrer">MyAnimeList</a>
              <a href={THEGAMESDB_URL} target="_blank" rel="noreferrer">TheGamesDB</a>
              <a href={RAWG_URL} target="_blank" rel="noreferrer">RAWG</a>
            </nav>
          </div>
        </div>
      </footer>
    </div>
  );
}
