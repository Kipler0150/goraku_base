import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useHealthCheck } from './hooks/useHealthCheck.js';
import { useAuth } from './hooks/useAuth.js';
import { useLibrary } from './hooks/useLibrary.js';
import { useMediaSearch } from './hooks/useMediaSearch.js';
import { useMediaDetails } from './hooks/useMediaDetails.js';
import { useMediaDiscovery } from './hooks/useMediaDiscovery.js';
import { useMediaRecommendations } from './hooks/useMediaRecommendations.js';
import { useTaxonomy } from './hooks/useTaxonomy.js';
import { LIBRARY_STATUS_VALUES } from './api/library.js';
import { mediaIdentity } from './mediaIdentity.js';
import { useLibraryMedia } from './hooks/useLibraryMedia.js';
import './styles.css';

const TMDB_URL = 'https://www.themoviedb.org/';
const TMDB_LOGO_URL = 'https://www.themoviedb.org/assets/2/v4/logos/primary-green.svg';
const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';
const ANILIST_URL = 'https://anilist.co/';
const MYANIMELIST_URL = 'https://myanimelist.net/';
const THEGAMESDB_URL = 'https://thegamesdb.net/';
const RAWG_URL = 'https://rawg.io/';
const THEME_STORAGE_KEY = 'goraku-base-theme';

const PROVIDERS = Object.freeze({
  anilist: { label: 'AniList', url: ANILIST_URL },
  myanimelist: { label: 'MyAnimeList', url: MYANIMELIST_URL },
  tmdb: { label: 'TMDB', url: TMDB_URL },
  thegamesdb: { label: 'TheGamesDB', url: THEGAMESDB_URL },
  rawg: { label: 'RAWG', url: RAWG_URL }
});
const PROVIDER_ORDER = Object.freeze(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);
const DISCOVERY_PROVIDERS = Object.freeze({
  anime: ['anilist', 'myanimelist'],
  movie: ['tmdb'],
  tv: ['tmdb'],
  game: ['thegamesdb', 'rawg']
});

function getDiscoveryProviders(type) {
  return DISCOVERY_PROVIDERS[type] ?? [];
}

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

function formatCount(value, suffix) {
  return Number.isInteger(value) ? `${value} ${suffix}` : `${suffix} unavailable`;
}

function formatMetadataCount(value, suffix, unavailableLabel = `${suffix} unavailable`) {
  return Number.isInteger(value) ? `${value} ${suffix}` : unavailableLabel;
}

function formatMetadataList(value, label) {
  return Array.isArray(value) && value.length > 0 ? value.join(', ') : `${label} unavailable`;
}

function formatCardReleaseDate(releaseDate) {
  if (!releaseDate?.year) return 'Release date unavailable';
  if (!releaseDate.month) return String(releaseDate.year);
  const month = new Intl.DateTimeFormat('en', { month: 'short' }).format(new Date(2000, releaseDate.month - 1, 1));
  return releaseDate.day ? month + ' ' + releaseDate.day + ', ' + releaseDate.year : month + ' ' + releaseDate.year;
}

function MediaCardRating({ providerRating }) {
  const normalized = Number.isFinite(providerRating?.normalized)
    ? Math.max(0, Math.min(10, providerRating.normalized))
    : null;
  const stars = normalized === null ? 0 : normalized / 2;
  const label = normalized === null ? 'Rating unavailable' : normalized.toFixed(1) + ' out of 10';

  return (
    <span className="media-card__rating" role="img" aria-label={label}>
      <span className="media-card__stars" aria-hidden="true">
        {Array.from({ length: 5 }, (_, index) => {
          const state = stars >= index + 1 ? 'full' : stars >= index + 0.5 ? 'half' : 'empty';
          return (
            <span className={'media-card__star media-card__star--' + state} key={index}>
              <span className="media-card__star-outline"><StarIcon /></span>
              {state !== 'empty' && <span className="media-card__star-fill"><StarIcon /></span>}
            </span>
          );
        })}
      </span>
      {normalized !== null && <span className="media-card__rating-value">{normalized.toFixed(1)}</span>}
    </span>
  );
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

function getPublicMediaErrorKind(error) {
  if (error?.code === 'CAPABILITY_UNSUPPORTED' || error?.status === 501) return 'unsupported';
  if (error?.code === 'APPLICATION_RATE_LIMITED' || error?.status === 429) return 'application-rate-limited';
  if (error?.code === 'PROVIDER_RATE_LIMITED') return 'rate-limited';
  if (error?.code === 'INVALID_PAYLOAD') return 'invalid-payload';
  if (error?.code === 'PROVIDER_NOT_FOUND' || error?.status === 404) return 'empty';
  return 'unavailable';
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

function ProviderAttributionLink({ provider }) {
  const providerInfo = PROVIDERS[provider];
  if (!providerInfo) return <span>{getProviderLabel(provider)}</span>;
  return (
    <a href={providerInfo.url} target="_blank" rel="noreferrer">
      {providerInfo.label}
    </a>
  );
}

function HomeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8Z" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>;
}

function LibraryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h11a3 3 0 0 1 3 3V19H8a3 3 0 0 1-3-3V4.5Z" /><path d="M8 19h11M8 8h7M8 12h7" /></svg>;
}

function InfoIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7h.01" /></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" /></svg>;
}

function SunIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="3.6" /><path d="M12 2.5v2M12 19.5v2M4.5 4.5l1.4 1.4M18.1 18.1l1.4 1.4M2.5 12h2M19.5 12h2M4.5 19.5l1.4-1.4M18.1 5.9l1.4-1.4" /></svg>;
}

function MoonIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19.5 15.4A7.8 7.8 0 0 1 8.6 4.5 8 8 0 1 0 19.5 15.4Z" /></svg>;
}

function BookmarkIcon({ filled = false }) {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6.5 4.5h11v15l-5.5-3.2-5.5 3.2v-15Z" fill={filled ? 'currentColor' : 'none'} /></svg>;
}

function ArrowIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 12h15M13 6l6 6-6 6" /></svg>;
}

function ThemeToggle({ theme, onToggle }) {
  const nextTheme = theme === 'dark' ? 'light' : 'dark';
  const label = `Switch to ${nextTheme} mode`;
  return (
    <button type="button" className="theme-toggle" onClick={onToggle} aria-label={label} title={label}>
      <span className="theme-toggle__icon">{theme === 'dark' ? <SunIcon /> : <MoonIcon />}</span>
      <span>{theme === 'dark' ? 'Light mode' : 'Dark mode'}</span>
    </button>
  );
}

function getInitialTheme() {
  if (typeof window === 'undefined') return 'dark';
  try {
    return window.localStorage.getItem(THEME_STORAGE_KEY) === 'light' ? 'light' : 'dark';
  } catch { return 'dark'; }
}

function MediaCard({ media, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = media.title || 'Title unavailable';
  const hasImage = Boolean(media.image) && !imageFailed;
  const identity = mediaIdentity(media);
  const isSaving = library.isSaveBusy(identity);
  const isSaved = library.isSaved(media);
  const cardInteractive = Boolean(onViewDetails);
  const CardSurface = cardInteractive ? 'button' : 'div';
  const cardSurfaceProps = cardInteractive
    ? {
      type: 'button',
      className: 'media-card__hit-area',
      'aria-label': 'View details for ' + title,
      onClick: () => onViewDetails(media)
    }
    : { className: 'media-card__hit-area' };

  return (
    <article className={'media-card' + (cardInteractive ? ' media-card--compact' : ' media-card--detail')}>
      <CardSurface {...cardSurfaceProps} data-media-identity={identity}>
        <div className="media-card__image">
          {hasImage ? (
            <img
              src={media.image}
              alt={title + ' cover'}
              loading="lazy"
              onError={() => setImageFailed(true)}
            />
          ) : (
            <span className="media-card__image-placeholder">Cover unavailable</span>
          )}
          {media.isAdult === true && <span className="media-card__adult">Adult</span>}
        </div>
        <div className="media-card__body">
          <h3>{title}</h3>
          <div className="media-card__meta" aria-label="Media highlights">
            <MediaCardRating providerRating={media.providerRating} />
            <span className="media-card__release-date">{formatCardReleaseDate(media.releaseDate)}</span>
          </div>
        </div>
      </CardSurface>
      <button
        type="button"
        className="media-card__bookmark"
        onClick={() => user ? onSave(media) : onRequestSignIn(media)}
        disabled={isSaved || isSaving}
        aria-label={isSaving ? 'Saving to library' : isSaved ? 'Saved to library' : 'Save to library'}
        title={isSaving ? 'Saving ' + title + ' to library' : isSaved ? title + ' saved to library' : 'Save ' + title + ' to library'}
      >
        <BookmarkIcon filled={isSaved} />
        <span className="visually-hidden">{isSaving ? 'Saving to library' : isSaved ? 'Saved to library' : 'Save to library'}</span>
      </button>
    </article>
  );
}

function SearchSkeletons({ variant = '' }) {
  return (
    <ul className={'media-grid media-grid--skeletons' + (variant ? ` media-grid--${variant}` : '')} aria-hidden="true">
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

function MediaGrid({ results, label, user, library, onSave, onRequestSignIn, onViewDetails, variant = 'grid' }) {
  return (
    <ul className={'media-grid' + (variant === 'rail' ? ' media-grid--rail' : '')} aria-label={`${label} results`}>
      {results.map((media) => (
        <li key={mediaIdentity(media)}>
          <MediaCard
            media={media}
            user={user}
            library={library}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
            onViewDetails={onViewDetails}
          />
        </li>
      ))}
    </ul>
  );
}

function CombinedResults({ results, user, library, onSave, onRequestSignIn, onViewDetails }) {
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
              onViewDetails={onViewDetails}
            />
          </section>
        );
      })}
    </div>
  );
}

function SearchResults({ search, user, library, onSave, onRequestSignIn, onViewDetails }) {
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
              onViewDetails={onViewDetails}
            />
          ) : (
            <MediaGrid
              results={state.results}
              label={typeLabel}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
              onViewDetails={onViewDetails}
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

function PublicMediaError({ error, onRetry, resource = 'Media' }) {
  const kind = getPublicMediaErrorKind(error);
  const operationName = resource === 'Discovery' ? 'Discovery' : resource.toLowerCase();
  const copy = {
    unsupported: {
      title: 'Operation unsupported.',
      message: `This ${operationName} operation is not supported by the selected Provider.`
    },
    'rate-limited': {
      title: 'Provider rate-limited.',
      message: 'The selected Provider is rate-limited.'
    },
    'application-rate-limited': {
      title: 'Application rate-limited.',
      message: 'The application is rate-limited. Please retry later.'
    },
    'invalid-payload': {
      title: 'Invalid response.',
      message: `The ${operationName} response was invalid.`
    },
    empty: {
      title: 'Nothing found.',
      message: `No ${resource.toLowerCase()} were found for this request.`
    },
    unavailable: {
      title: 'Provider unavailable.',
      message: `The selected Provider could not return ${operationName.toLowerCase()}.`
    }
  }[kind];

  return (
    <SearchState tone="error" role="alert">
      <span className="state-mark" aria-hidden="true">!</span>
      <h3>{copy.title}</h3>
      <p>{copy.message}</p>
      <button type="button" className="search-action search-action--secondary" onClick={onRetry}>
        Retry {resource}
      </button>
    </SearchState>
  );
}

function DiscoveryControls({ includeAdult, discovery }) {
  const [type, setType] = useState('anime');
  const [operation, setOperation] = useState('trending');
  const [provider, setProvider] = useState('anilist');
  const typeLabel = getMediaTypeLabel(type);
  const typeNoun = getMediaTypeNoun(type);
  const providers = getDiscoveryProviders(type);

  const changeType = (nextType) => {
    setType(nextType);
    setProvider(getDiscoveryProviders(nextType)[0] ?? '');
  };

  return (
    <div className="discovery-controls">
      <div className="discovery-controls__heading">
        <div>

          <h3>Browse trending &amp; popular</h3>
        </div>
        <p>Browse supported Provider lists without changing your Search results.</p>
      </div>
      <div className="discovery-controls__fields">
        <label>
          Discovery media type
          <select aria-label="Discovery media type" value={type} onChange={(event) => changeType(event.target.value)}>
            <option value="anime">Anime catalog</option>
            <option value="movie">Movies catalog</option>
            <option value="tv">TV catalog</option>
            <option value="game">Games catalog</option>
          </select>
        </label>
        <label>
          Discovery operation
          <select aria-label="Discovery operation" value={operation} onChange={(event) => setOperation(event.target.value)}>
            <option value="trending">Trending</option>
            <option value="popular">Popular</option>
          </select>
        </label>
        <label>
          Discovery provider
          <select aria-label="Discovery provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
            {providers.map((providerName) => <option key={providerName} value={providerName}>{getProviderLabel(providerName)}</option>)}
          </select>
        </label>
        <button
          type="button"
          className="search-action search-action--secondary"
          onClick={() => discovery.load({ operation, type, provider })}
          disabled={discovery.isBusy}
        >
          {discovery.isBusy ? 'Loading Discovery…' : `Load ${operation} ${typeNoun}`}
        </button>
      </div>
      <p className="discovery-controls__help">Adult content is {includeAdult ? 'included' : 'excluded'} using your visibility preference.</p>
      <span className="visually-hidden">{typeLabel} Discovery uses the selected Provider without fallback.</span>
    </div>
  );
}

function DiscoveryResults({ discovery, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const { state } = discovery;
  const typeLabel = getMediaTypeLabel(state.type);
  const operationLabel = state.operation === 'popular' ? 'Popular' : 'Trending';
  const resourceLabel = `${operationLabel} ${typeLabel}`;
  const statusMessage = state.status === 'initial'
    ? 'Choose a Provider-owned Discovery list.'
    : state.status === 'loading'
      ? `Loading ${resourceLabel.toLowerCase()}.`
      : state.status === 'error'
        ? `${resourceLabel} is unavailable.`
        : state.results.length === 0
          ? `No ${resourceLabel.toLowerCase()} available.`
          : `${state.results.length} ${resourceLabel.toLowerCase()} loaded.`;

  return (
    <section className="discovery-results" role="region" aria-label={`${resourceLabel} discovery`} aria-busy={discovery.isBusy}>
      <p className="search-announcement" aria-live="polite" aria-atomic="true">{statusMessage}</p>
      {state.status === 'initial' && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">/ / /</span>
          <h3>Browse a Provider list.</h3>
          <p>Choose trending or popular to load Provider-owned Discovery results.</p>
        </SearchState>
      )}
      {state.status === 'loading' && state.results.length === 0 && <SearchSkeletons />}
      {state.status === 'error' && <PublicMediaError error={state.error} onRetry={discovery.retry} resource="Discovery" />}
      {(state.status === 'success' || state.results.length > 0) && (
        <>
          <p className="search-attribution discovery-attribution">
            <span>UNOFFICIAL </span><ProviderAttributionLink provider={state.source} /><span> INTEGRATION</span>
          </p>
          {state.results.length === 0 ? (
            <SearchState>
              <span className="state-mark" aria-hidden="true">0</span>
              <h3>No {resourceLabel} available.</h3>
              <p>The selected Provider returned an empty Discovery list.</p>
            </SearchState>
          ) : (
            <MediaGrid
              results={state.results}
              label={`${resourceLabel} Discovery`}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
              onViewDetails={onViewDetails}
            />
          )}
          {state.pagination?.hasMore && (
            <div className="load-more-wrap">
              <button type="button" className="search-action search-action--primary" onClick={discovery.loadMore} disabled={discovery.isBusy || state.status === 'error'}>
                {discovery.isBusy ? 'Loading more…' : `Load more ${resourceLabel.toLowerCase()}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

const DISCOVERY_SHELVES = Object.freeze([
  { key: 'popular', label: 'Popular now', operation: 'popular' },
  { key: 'trending', label: 'Trending this week', operation: 'trending' },
  { key: 'latest', label: 'Latest releases', operation: 'latest' }
]);

function DiscoveryHero({ media, type, onViewDetails }) {
  const typeLabel = getMediaTypeLabel(type);
  if (!media) {
    return (
      <section className="discovery-hero discovery-hero--empty" aria-label="Discover feature">
        <div className="discovery-hero__copy">
          <p className="section-index">YOUR NEXT FAVORITE</p>
          <h2>Find the story that stays with you.</h2>
          <p>Choose a catalog above to surface Provider-owned picks across popular, trending, and latest releases.</p>
        </div>
        <div className="discovery-hero__art" aria-hidden="true"><img src="/mainIcon.svg" alt="" /></div>
      </section>
    );
  }

  return (
    <section className="discovery-hero" aria-label={`Featured ${typeLabel} item`}>
      <div className="discovery-hero__image">
        {media.image ? <img src={media.image} alt="" /> : <img src="/mainIcon.svg" alt="" />}
      </div>
      <div className="discovery-hero__copy">
        <p className="section-index">FEATURED FROM {getProviderLabel(media.provider).toUpperCase()}</p>
        <h2>{media.title || 'Title unavailable'}</h2>
        <div className="discovery-hero__meta">
          <MediaCardRating providerRating={media.providerRating} />
          <span>{formatCardReleaseDate(media.releaseDate)}</span>
        </div>
        <p>Selected from Popular now in the {typeLabel.toLowerCase()} catalog.</p>
        <button type="button" className="search-action search-action--primary" onClick={() => onViewDetails(media)}>
          Open details <ArrowIcon />
        </button>
      </div>
    </section>
  );
}

function DiscoveryShelf({ shelf, discovery, type, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const railRef = useRef(null);
  const { state } = discovery;
  const typeLabel = getMediaTypeLabel(type);
  const resourceLabel = `${shelf.label} ${typeLabel}`;
  const statusMessage = state.status === 'initial'
    ? `Preparing ${resourceLabel.toLowerCase()}.`
    : state.status === 'loading'
    ? `Loading ${resourceLabel.toLowerCase()}.`
    : state.status === 'error'
      ? `${resourceLabel} is unavailable.`
      : state.status === 'success' && state.results.length === 0
        ? `No ${resourceLabel.toLowerCase()} available.`
        : `${state.results.length} ${resourceLabel.toLowerCase()} loaded.`;

  const scrollRail = (direction) => {
    railRef.current?.scrollBy({ left: direction * Math.max(280, railRef.current.clientWidth * 0.72), behavior: 'smooth' });
  };

  return (
    <section className="discovery-shelf" role="region" aria-label={`${resourceLabel} shelf`} aria-busy={discovery.isBusy || state.status === 'initial'}>
      <div className="discovery-shelf__heading">
        <div>
          <h3>{shelf.label}</h3>
          <p>{state.source ? <><span>UNOFFICIAL </span><ProviderAttributionLink provider={state.source} /><span> INTEGRATION</span></> : 'Provider-owned catalog list'}</p>
        </div>
        <div className="discovery-shelf__actions">
          <span className="visually-hidden" aria-live="polite">{statusMessage}</span>
          <button type="button" className="shelf-arrow shelf-arrow--previous" onClick={() => scrollRail(-1)} aria-label={`Scroll ${resourceLabel} left`} title="Scroll left">
            <ArrowIcon />
          </button>
          <button type="button" className="shelf-arrow" onClick={() => scrollRail(1)} aria-label={`Scroll ${resourceLabel} right`} title="Scroll right">
            <ArrowIcon />
          </button>
        </div>
      </div>

      {state.status === 'error' && <PublicMediaError error={state.error} onRetry={discovery.retry} resource={shelf.label} />}
      {(state.status === 'initial' || state.status === 'loading') && state.results.length === 0 && (
        <div className="discovery-rail"><SearchSkeletons variant="rail" /></div>
      )}
      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>No {resourceLabel} available.</h3>
          <p>The selected Provider has no items for this shelf right now.</p>
        </SearchState>
      )}
      {state.results.length > 0 && (
        <>
          <div className="discovery-rail" ref={railRef}>
            <MediaGrid
              results={state.results}
              label={resourceLabel}
              variant="rail"
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
              onViewDetails={onViewDetails}
            />
          </div>
          {state.pagination?.hasMore && (
            <div className="discovery-shelf__load-more">
              <button type="button" className="search-action search-action--secondary" onClick={discovery.loadMore} disabled={discovery.isBusy}>
                {state.loadingPage ? 'Loading more…' : `Load more ${shelf.label.toLowerCase()}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function DiscoverWorkspace({ active, includeAdult, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const [type, setType] = useState('movie');
  const [provider, setProvider] = useState('tmdb');
  const popular = useMediaDiscovery({ includeAdult });
  const trending = useMediaDiscovery({ includeAdult });
  const latest = useMediaDiscovery({ includeAdult });
  const providers = getDiscoveryProviders(type);
  const featured = popular.state.results[0] ?? trending.state.results[0] ?? null;

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => {
      popular.load({ operation: 'popular', type, provider });
      trending.load({ operation: 'trending', type, provider });
      latest.load({ operation: 'latest', type, provider });
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, type, provider]);

  const changeType = (nextType) => {
    const nextProviders = getDiscoveryProviders(nextType);
    setType(nextType);
    setProvider(nextProviders[0] ?? '');
  };

  return (
    <div className="discover-workspace">
      <div className="discovery-controls">
        <div className="discovery-controls__heading">
          <div>
            <p className="section-index">DISCOVER / CURATED SHELVES</p>
            <h3>What are you in the mood for?</h3>
          </div>
          <p>One source, three ways in: popular now, trending this week, and genuine latest releases.</p>
        </div>
        <div className="discovery-controls__fields">
          <label>
            Catalog
            <select aria-label="Discovery media type" value={type} onChange={(event) => changeType(event.target.value)}>
              <option value="anime">Anime catalog</option>
              <option value="movie">Movies catalog</option>
              <option value="tv">TV catalog</option>
              <option value="game">Games catalog</option>
            </select>
          </label>
          <label>
            Source
            <select aria-label="Discovery provider" value={provider} onChange={(event) => setProvider(event.target.value)}>
              {providers.map((providerName) => <option key={providerName} value={providerName}>{getProviderLabel(providerName)}</option>)}
            </select>
          </label>
          <p className="discovery-controls__help">Adult content is {includeAdult ? 'included' : 'excluded'} using your visibility preference. Each shelf keeps its own loading and retry state.</p>
        </div>
      </div>

      <DiscoveryHero media={featured} type={type} onViewDetails={onViewDetails} />
      <div className="discovery-shelves">
        {DISCOVERY_SHELVES.map((shelf, index) => (
          <DiscoveryShelf
            key={shelf.key}
            shelf={shelf}
            discovery={[popular, trending, latest][index]}
            type={type}
            user={user}
            library={library}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
            onViewDetails={onViewDetails}
          />
        ))}
      </div>
    </div>
  );
}

function RecommendationResults({ recommendations, anchor, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const { state } = recommendations;
  const statusMessage = state.status === 'idle'
    ? 'Recommendations are ready to load.'
    : state.status === 'loading'
      ? 'Loading Provider-owned Recommendations.'
      : state.status === 'error'
        ? 'Recommendations are unavailable.'
        : state.results.length === 0
          ? 'No Provider-owned Recommendations found.'
          : `${state.results.length} Provider-owned Recommendations loaded.`;

  return (
    <section className="recommendations-panel" role="region" aria-label="Provider-owned recommendations" aria-busy={recommendations.isBusy}>
      <div className="recommendations-panel__heading">
        <div>
          <h3>Recommendations</h3>
        </div>
        {state.source && (
          <p className="search-attribution"><span>UNOFFICIAL </span><ProviderAttributionLink provider={state.source} /><span> INTEGRATION</span></p>
        )}
      </div>
      <p className="search-announcement" aria-live="polite" aria-atomic="true">{statusMessage}</p>
      {state.status === 'idle' && (
        <button type="button" className="search-action search-action--secondary" onClick={() => recommendations.load(anchor)}>
          Load recommendations
        </button>
      )}
      {state.status === 'loading' && state.results.length === 0 && <SearchSkeletons />}
      {state.status === 'error' && <PublicMediaError error={state.error} onRetry={recommendations.retry} resource="Recommendations" />}
      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>No recommendations found.</h3>
          <p>The selected Provider returned an empty related-media list.</p>
        </SearchState>
      )}
      {state.results.length > 0 && (
        <>
          <MediaGrid
            results={state.results}
            label="Recommended media"
            user={user}
            library={library}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
            onViewDetails={onViewDetails}
          />
          {state.pagination?.hasMore && (
            <div className="load-more-wrap">
              <button type="button" className="search-action search-action--primary" onClick={recommendations.loadMore} disabled={recommendations.isBusy || state.status === 'error'}>
                {recommendations.isBusy ? 'Loading more…' : 'Load more recommendations'}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function MediaDetailsPanel({ details, recommendations, user, library, onSave, onRequestSignIn, onBack, onViewDetails }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const selectedMedia = details.selectedMedia;
  const media = details.media;
  const title = media?.title ?? selectedMedia?.title ?? 'Selected Media';
  const statusMessage = details.status === 'loading'
    ? `Loading details for ${title}.`
    : details.status === 'error'
      ? 'Media details are unavailable.'
      : `${title} details loaded.`;

  useEffect(() => {
    panelRef.current?.focus();
  }, [selectedMedia]);

  return (
    <section ref={panelRef} tabIndex="-1" className="details-panel" role="region" aria-labelledby={titleId} aria-busy={details.isBusy}>
      <div className="details-panel__heading">
        <div>
          <h2 id={titleId}>{title} details</h2>
        </div>
        {selectedMedia?.provider && (
          <p className="search-attribution"><span>UNOFFICIAL </span><ProviderAttributionLink provider={selectedMedia.provider} /><span> INTEGRATION</span></p>
        )}
      </div>
      <div className="details-panel__actions">
        <button type="button" className="search-action search-action--secondary" onClick={onBack}>Back to results</button>
      </div>
      <p className="search-announcement" aria-live="polite" aria-atomic="true">{statusMessage}</p>
      {details.status === 'loading' && <SearchSkeletons />}
      {details.status === 'error' && <PublicMediaError error={details.error} onRetry={details.retry} resource="details" />}
      {details.status === 'success' && media && (
        <>
          <div className="details-media">
            <MediaCard
              media={media}
              user={user}
              library={library}
              onSave={onSave}
              onRequestSignIn={onRequestSignIn}
            />
            <div className="details-copy">
              <h3>Media metadata</h3>
              <p>{media.description ?? 'Description unavailable.'}</p>
              <dl className="details-facts">
                <div><dt>Provider</dt><dd>{getProviderLabel(media.provider)}</dd></div>
                <div><dt>Genres</dt><dd>{formatMetadataList(media.genres, 'Genres')}</dd></div>
                <div><dt>Creators</dt><dd>{media.creators?.length ? media.creators.map((creator) => creator.name).join(', ') : 'Creators unavailable'}</dd></div>
              </dl>
              <dl className="details-facts">
                {getCardFacts(media).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </div>
          </div>
          <RecommendationResults
            recommendations={recommendations}
            anchor={media}
            user={user}
            library={library}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
            onViewDetails={onViewDetails}
          />
        </>
      )}
    </section>
  );
}

function MediaSearch({ user, library, onSave, onRequestSignIn, mode = 'search', active = true }) {
  const workspaceRef = useRef(null);
  const originRef = useRef(null);
  const restoreFocusRef = useRef(false);
  const search = useMediaSearch({ type: 'anime' });
  const details = useMediaDetails({ includeAdult: search.includeAdult });
  const recommendations = useMediaRecommendations({ includeAdult: search.includeAdult });
  const typeLabel = getMediaTypeLabel(search.type);

  const openDetails = useCallback((media) => {
    if (details.status === 'idle') originRef.current = mediaIdentity(media);
    recommendations.clear();
    details.open(media);
  }, [details.open, details.status, recommendations.clear]);

  const backToResults = useCallback(() => {
    restoreFocusRef.current = true;
    recommendations.clear();
    details.close();
  }, [details.close, recommendations.clear]);

  useEffect(() => {
    if (details.status !== 'idle' || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const origin = Array.from(workspaceRef.current?.querySelectorAll('[data-media-identity]') ?? [])
      .find((button) => button.dataset.mediaIdentity === originRef.current);
    (origin ?? workspaceRef.current)?.focus();
  }, [details.status]);

  return (
    <section ref={workspaceRef} tabIndex={-1} className={`search-section ${mode}-workspace`} aria-label={mode === 'search' ? 'Search workspace' : 'Discover workspace'}>
      {mode === 'search' && <>

      <div className="section-heading">
        <div>
          <h2 id="media-search-title">Search</h2>

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
      </>}

      {details.status === 'idle' ? (mode === 'search' ? (
        <SearchResults
          search={search}
          user={user}
          library={library}
          onSave={onSave}
          onRequestSignIn={onRequestSignIn}
          onViewDetails={openDetails}
        />
      ) : null) : (
        <MediaDetailsPanel
          details={details}
          recommendations={recommendations}
          user={user}
          library={library}
          onSave={onSave}
          onRequestSignIn={onRequestSignIn}
          onBack={backToResults}
          onViewDetails={openDetails}
        />
      )}

      {mode === 'discover' && details.status === 'idle' && (
        <DiscoverWorkspace
          active={active}
          includeAdult={search.includeAdult}
          user={user}
          library={library}
          onSave={onSave}
          onRequestSignIn={onRequestSignIn}
          onViewDetails={openDetails}
        />
      )}
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
  return status.toLowerCase().replaceAll('_', ' ').replace(/(^|\s)\S/g, (character) => character.toUpperCase());
}

function StarIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d="m12 2.75 2.86 5.79 6.39.93-4.63 4.51 1.09 6.37L12 17.34l-5.71 3.01 1.09-6.37-4.63-4.51 6.39-.93L12 2.75Z" />
    </svg>
  );
}

function PersonalRating({ item, library, label }) {
  const rating = item.personalRating;
  const busy = library.isActionBusy(item.id, 'personalRating');
  const valueLabel = rating === null ? 'Unrated on a 0–10 scale.' : `${rating} out of 10.`;

  return (
    <fieldset className="tracking-editor rating-editor" disabled={busy}>
      <legend>Personal rating for {label}</legend>
      <div className="rating-row">
        <button
          type="button"
          className="text-action rating-zero"
          aria-pressed={rating === 0}
          onClick={() => library.update(item.id, { personalRating: 0 }, { actionKey: 'personalRating' })}
        >
          Rate 0 out of 10
        </button>
        <div className="rating-stars" role="group" aria-label={`Personal rating, ${valueLabel}`}>
          {Array.from({ length: 5 }, (_, index) => {
            const leftValue = index * 2 + 1;
            const rightValue = leftValue + 1;
            return (
              <span className="rating-star" key={leftValue}>
                <button
                  type="button"
                  className={`rating-half rating-half--left${rating !== null && rating >= leftValue ? ' is-selected' : ''}`}
                  aria-label={`Rate ${leftValue} out of 10`}
                  aria-pressed={rating === leftValue}
                  onClick={() => library.update(item.id, { personalRating: leftValue }, { actionKey: 'personalRating' })}
                >
                  <StarIcon />
                </button>
                <button
                  type="button"
                  className={`rating-half rating-half--right${rating !== null && rating >= rightValue ? ' is-selected' : ''}`}
                  aria-label={`Rate ${rightValue} out of 10`}
                  aria-pressed={rating === rightValue}
                  onClick={() => library.update(item.id, { personalRating: rightValue }, { actionKey: 'personalRating' })}
                >
                  <StarIcon />
                </button>
              </span>
            );
          })}
        </div>
        <span className="rating-value" aria-live="polite">{valueLabel}</span>
      </div>
      <button
        type="button"
        className="text-action"
        onClick={() => library.update(item.id, { personalRating: null }, { actionKey: 'personalRating' })}
        disabled={busy || rating === null}
      >
        Clear rating / mark unrated
      </button>
    </fieldset>
  );
}

function NoteEditor({ item, library, label }) {
  const [note, setNote] = useState(item.note ?? '');
  const busy = library.isActionBusy(item.id, 'note');
  const noteLength = [...note].length;

  useEffect(() => {
    setNote(item.note ?? '');
  }, [item.id, item.note]);

  async function saveNote(value) {
    await library.update(item.id, { note: value || null }, { actionKey: 'note' });
  }

  return (
    <form
      className="tracking-editor note-editor"
      onSubmit={(event) => {
        event.preventDefault();
        saveNote(note);
      }}
    >
      <label htmlFor={`library-note-${item.id}`}>Note for {label}</label>
      <textarea
        id={`library-note-${item.id}`}
        value={note}
        onChange={(event) => {
          if ([...event.target.value].length <= 5000) setNote(event.target.value);
        }}
        aria-describedby={`library-note-help-${item.id}`}
        disabled={busy}
        rows={4}
        placeholder="Keep a plain-text thought about this Library Item."
      />
      <div className="editor-meta" id={`library-note-help-${item.id}`}>
        <span aria-live="polite">{noteLength} / 5,000 Unicode characters</span>
        <span>Line breaks are kept.</span>
      </div>
      <div className="editor-actions">
        <button type="submit" className="text-action" disabled={busy}>{busy ? 'Saving note…' : 'Save note'}</button>
        <button
          type="button"
          className="text-action text-action--quiet"
          onClick={() => saveNote('')}
          disabled={busy || noteLength === 0}
        >
          Clear note
        </button>
      </div>
    </form>
  );
}

function progressDraftFor(item) {
  if (item.type === 'ANIME') return { episodesWatched: item.progress?.episodesWatched === undefined ? '' : String(item.progress.episodesWatched) };
  if (item.type === 'TV') return {
    season: item.progress?.season === undefined ? '' : String(item.progress.season),
    episode: item.progress?.episode === undefined ? '' : String(item.progress.episode)
  };
  if (item.type === 'MOVIE') return { watched: item.progress?.watched === true };
  return { hoursPlayed: item.progress?.hoursPlayed === undefined ? '' : String(item.progress.hoursPlayed) };
}

function ProgressEditor({ item, library, label }) {
  const [draft, setDraft] = useState(() => progressDraftFor(item));
  const [validationError, setValidationError] = useState('');
  const busy = library.isActionBusy(item.id, 'progress');

  useEffect(() => {
    setDraft(progressDraftFor(item));
    setValidationError('');
  }, [item.id, item.progress, item.type]);

  function progressValue() {
    if (item.type === 'ANIME') {
      const episodesWatched = Number(draft.episodesWatched);
      return draft.episodesWatched !== '' && Number.isInteger(episodesWatched) && episodesWatched >= 0 ? { episodesWatched } : null;
    }
    if (item.type === 'TV') {
      const season = Number(draft.season);
      const episode = Number(draft.episode);
      return draft.season !== '' && draft.episode !== ''
        && Number.isInteger(season) && season >= 0 && Number.isInteger(episode) && episode >= 1
        ? { season, episode }
        : null;
    }
    if (item.type === 'MOVIE') return { watched: draft.watched === true };
    const hoursPlayed = Number(draft.hoursPlayed);
    return Number.isFinite(hoursPlayed) && hoursPlayed >= 0 && /^\d+(\.\d{1,2})?$/.test(draft.hoursPlayed) ? { hoursPlayed } : null;
  }

  async function saveProgress() {
    const progress = progressValue();
    if (!progress) {
      setValidationError('Enter a valid progress value before saving.');
      return;
    }
    setValidationError('');
    await library.update(item.id, { progress }, { actionKey: 'progress' });
  }

  return (
    <form
      className="tracking-editor progress-editor"
      onSubmit={(event) => { event.preventDefault(); saveProgress(); }}
    >
      <div className="editor-label">Progress for {label}</div>
      {item.type === 'ANIME' && (
        <label htmlFor={`library-progress-episodes-${item.id}`}>
          Episodes watched
          <input
            id={`library-progress-episodes-${item.id}`}
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={draft.episodesWatched}
            onChange={(event) => setDraft({ episodesWatched: event.target.value })}
            disabled={busy}
          />
        </label>
      )}
      {item.type === 'TV' && (
        <div className="progress-pair">
          <label htmlFor={`library-progress-season-${item.id}`}>
            Season
            <input
              id={`library-progress-season-${item.id}`}
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={draft.season}
              onChange={(event) => setDraft((current) => ({ ...current, season: event.target.value }))}
              disabled={busy}
            />
          </label>
          <label htmlFor={`library-progress-episode-${item.id}`}>
            Episode
            <input
              id={`library-progress-episode-${item.id}`}
              type="number"
              min="1"
              step="1"
              inputMode="numeric"
              value={draft.episode}
              onChange={(event) => setDraft((current) => ({ ...current, episode: event.target.value }))}
              disabled={busy}
            />
          </label>
        </div>
      )}
      {item.type === 'MOVIE' && (
        <label className="favorite-toggle" htmlFor={`library-progress-watched-${item.id}`}>
          <input
            id={`library-progress-watched-${item.id}`}
            type="checkbox"
            checked={draft.watched}
            onChange={(event) => setDraft({ watched: event.target.checked })}
            disabled={busy}
          />
          Watched
        </label>
      )}
      {item.type === 'GAME' && (
        <label htmlFor={`library-progress-hours-${item.id}`}>
          Hours played
          <input
            id={`library-progress-hours-${item.id}`}
            type="number"
            min="0"
            step="0.01"
            inputMode="decimal"
            value={draft.hoursPlayed}
            onChange={(event) => setDraft({ hoursPlayed: event.target.value })}
            disabled={busy}
          />
        </label>
      )}
      {validationError && <p className="inline-error" role="alert">{validationError}</p>}
      <div className="editor-actions">
        <button type="submit" className="text-action" disabled={busy}>{busy ? 'Saving progress…' : 'Save progress'}</button>
        <button
          type="button"
          className="text-action text-action--quiet"
          onClick={() => { setValidationError(''); library.update(item.id, { progress: null }, { actionKey: 'progress' }); }}
          disabled={busy || item.progress === null}
        >
          Clear progress
        </button>
      </div>
    </form>
  );
}

function RelationshipEditor({ kind, item, library, taxonomy, label }) {
  const isTag = kind === 'tag';
  const field = isTag ? 'tags' : 'collections';
  const resources = taxonomy[`${field}`];
  const title = isTag ? 'Tags' : 'Collections';

  return (
    <fieldset className="tracking-editor relationship-editor" disabled={taxonomy.status !== 'success'}>
      <legend>{title} for {label}</legend>
      {taxonomy.status !== 'success' ? (
        <p className="editor-empty">
          {taxonomy.status === 'error' ? 'Relationships are unavailable. Retry the private relationship lists above.' : 'Loading private relationships…'}
        </p>
      ) : resources.length === 0 ? (
        <p className="editor-empty">Create a {isTag ? 'Tag' : 'Collection'} above to attach it here.</p>
      ) : (
        <div className="relationship-options">
          {resources.map((resource) => {
            const attached = item[field].some((entry) => entry.id === resource.id);
            const busy = library.isActionBusy(item.id, `${kind}:${resource.id}`);
            return (
              <label className="relationship-option" key={resource.id}>
                <input
                  type="checkbox"
                  checked={attached}
                  disabled={busy}
                  onChange={(event) => {
                    const change = event.target.checked ? library.attach : library.detach;
                    change(item.id, kind, resource);
                  }}
                />
                <span>{resource.name}</span>
                {busy && <span className="relationship-option__status" aria-live="polite">Updating…</span>}
              </label>
            );
          })}
        </div>
      )}
    </fieldset>
  );
}

function LibraryItem({ item, library, taxonomy, mediaEntry, onRetryArtwork }) {
  const [imageFailed, setImageFailed] = useState(false);
  const media = mediaEntry?.media;
  const title = media?.title || item.providerId;
  useEffect(() => setImageFailed(false), [media?.image]);
  const label = libraryItemLabel(item);
  const itemError = library.getItemError(item.id);
  const isRemoving = library.isActionBusy(item.id, 'remove');

  return (
    <li className="library-item" aria-busy={library.isItemBusy(item.id)}>
      <div className="library-item__identity">
        <p className="section-index">{getProviderLabel(item.provider).toUpperCase()} / {item.type}</p>
        <div className="library-cover">
          {media?.image && !imageFailed
            ? <img src={media.image} alt={`${title} cover`} loading="lazy" onError={() => setImageFailed(true)} />
            : <span>{mediaEntry?.status === 'error' || mediaEntry?.status === 'success' ? 'Cover unavailable' : 'Loading cover…'}</span>}
        </div>
        <h3>{title}</h3>
        <p>{formatLibraryStatus(item.libraryStatus)}{item.favorite ? ' · Favorite' : ''}</p>
        {mediaEntry?.status === 'error' && <button type="button" className="text-action" onClick={onRetryArtwork}>Retry artwork for {label}</button>}
      </div>
      <details className="library-edit">
        <summary>Edit tracking for {title}</summary>
      <div className="library-item__controls">
        <label htmlFor={`library-status-${item.id}`}>Library status for {label}</label>
        <select
          id={`library-status-${item.id}`}
          value={item.libraryStatus}
          onChange={(event) => library.update(item.id, { libraryStatus: event.target.value }, { actionKey: 'libraryStatus' })}
          disabled={library.isActionBusy(item.id, 'libraryStatus')}
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
            onChange={(event) => library.update(item.id, { favorite: event.target.checked }, { actionKey: 'favorite' })}
            disabled={library.isActionBusy(item.id, 'favorite')}
          />
          <span>Favorite</span>
        </label>
        <PersonalRating item={item} library={library} label={label} />
        <ProgressEditor item={item} library={library} label={label} />
        <NoteEditor item={item} library={library} label={label} />
        <RelationshipEditor kind="tag" item={item} library={library} taxonomy={taxonomy} label={label} />
        <RelationshipEditor kind="collection" item={item} library={library} taxonomy={taxonomy} label={label} />
        {itemError && <p className="form-error" role="alert">{formatApiError(itemError, 'This Library Item action was rejected by the server.')}</p>}
        <button
          type="button"
          className="search-action search-action--secondary"
          onClick={() => library.remove(item.id)}
          disabled={isRemoving}
        >
          {isRemoving ? 'Removing…' : `Remove ${label}`}
        </button>
      </div>
      </details>
    </li>
  );
}

function LibraryFilters({ library, taxonomy }) {
  const [draft, setDraft] = useState({
    libraryStatus: library.filters.libraryStatus ?? '',
    favorite: library.filters.favorite === undefined ? '' : String(library.filters.favorite),
    tagId: library.filters.tagId ?? '',
    collectionId: library.filters.collectionId ?? ''
  });

  useEffect(() => {
    setDraft({
      libraryStatus: library.filters.libraryStatus ?? '',
      favorite: library.filters.favorite === undefined ? '' : String(library.filters.favorite),
      tagId: library.filters.tagId ?? '',
      collectionId: library.filters.collectionId ?? ''
    });
  }, [library.filters]);

  function apply(event) {
    event.preventDefault();
    library.applyFilters({
      libraryStatus: draft.libraryStatus || undefined,
      favorite: draft.favorite === '' ? undefined : draft.favorite === 'true',
      tagId: draft.tagId || undefined,
      collectionId: draft.collectionId || undefined
    });
  }

  function clear() {
    const next = { libraryStatus: '', favorite: '', tagId: '', collectionId: '' };
    setDraft(next);
    library.applyFilters({});
  }

  return (
    <form className="library-filters" onSubmit={apply} aria-label="Filter Library Items">
      <div className="library-filters__heading">
        <div>
          <h3>Filter the signal.</h3>
        </div>
        <p>Filters stay applied while you load more Library Items.</p>
      </div>
      <div className="library-filters__fields">
        <label htmlFor="library-filter-status">
          Library Status
          <select id="library-filter-status" value={draft.libraryStatus} onChange={(event) => setDraft((current) => ({ ...current, libraryStatus: event.target.value }))}>
            <option value="">All statuses</option>
            {LIBRARY_STATUS_VALUES.map((status) => <option value={status} key={status}>{formatLibraryStatus(status)}</option>)}
          </select>
        </label>
        <label htmlFor="library-filter-favorite">
          Favorite
          <select id="library-filter-favorite" value={draft.favorite} onChange={(event) => setDraft((current) => ({ ...current, favorite: event.target.value }))}>
            <option value="">All Library Items</option>
            <option value="true">Favorites only</option>
            <option value="false">Not favorites</option>
          </select>
        </label>
        <label htmlFor="library-filter-tag">
          Tag
          <select id="library-filter-tag" value={draft.tagId} onChange={(event) => setDraft((current) => ({ ...current, tagId: event.target.value }))}>
            <option value="">All Tags</option>
            {taxonomy.tags.map((tag) => <option value={tag.id} key={tag.id}>{tag.name}</option>)}
          </select>
        </label>
        <label htmlFor="library-filter-collection">
          Collection
          <select id="library-filter-collection" value={draft.collectionId} onChange={(event) => setDraft((current) => ({ ...current, collectionId: event.target.value }))}>
            <option value="">All Collections</option>
            {taxonomy.collections.map((collection) => <option value={collection.id} key={collection.id}>{collection.name}</option>)}
          </select>
        </label>
      </div>
      <div className="editor-actions">
        <button type="submit" className="search-action search-action--primary" disabled={library.status === 'loading'}>Apply filters</button>
        <button type="button" className="text-action text-action--quiet" onClick={clear} disabled={library.status === 'loading'}>Clear filters</button>
      </div>
    </form>
  );
}

function TaxonomyResourceRow({ kind, resource, taxonomy, onRename, onRemove }) {
  const [name, setName] = useState(resource.name);
  const error = taxonomy.getError(kind, resource.id);
  const busy = taxonomy.isActionBusy(kind, resource.id);

  useEffect(() => setName(resource.name), [resource.name]);

  return (
    <li className="taxonomy-resource">
      <form
        onSubmit={(event) => {
          event.preventDefault();
          onRename(kind, resource.id, name);
        }}
      >
        <label htmlFor={`${kind}-name-${resource.id}`}>{kind === 'tag' ? 'Tag' : 'Collection'} name</label>
        <div className="taxonomy-resource__edit">
          <input
            id={`${kind}-name-${resource.id}`}
            value={name}
            onChange={(event) => { if ([...event.target.value].length <= 50) setName(event.target.value); }}
            disabled={busy}
          />
          <button type="submit" className="text-action" disabled={busy}>{busy ? 'Saving…' : 'Rename'}</button>
        </div>
      </form>
      <button
        type="button"
        className="text-action text-action--danger"
        aria-label={`Delete ${kind} ${resource.name}`}
        onClick={() => onRemove(kind, resource.id)}
        disabled={busy}
      >
        {busy ? 'Deleting…' : `Delete ${kind}`}
      </button>
      {error && <p className="inline-error" role="alert">{formatApiError(error, `The ${kind} could not be changed.`)}</p>}
    </li>
  );
}

function TaxonomyResourceGroup({ kind, resources, taxonomy, onRename, onRemove }) {
  const title = kind === 'tag' ? 'Tags' : 'Collections';
  const singular = kind === 'tag' ? 'Tag' : 'Collection';
  const createError = taxonomy.getError(kind);
  const createBusy = taxonomy.isActionBusy(kind);
  const pagination = kind === 'tag' ? taxonomy.tagPagination : taxonomy.collectionPagination;
  const loadingMore = taxonomy.loadingMore[kind];
  const pageError = taxonomy.pageErrors[kind];
  const [name, setName] = useState('');

  return (
    <div className="taxonomy-group">
      <div className="taxonomy-group__heading">
        <h3>{title}</h3>
        <span>{resources.length} loaded</span>
      </div>
      <form
        className="taxonomy-create"
        onSubmit={async (event) => {
          event.preventDefault();
          const created = await taxonomy.create(kind, name);
          if (created) setName('');
        }}
      >
        <label htmlFor={`new-${kind}`}>Create {singular}</label>
        <div className="taxonomy-create__fields">
          <input
            id={`new-${kind}`}
            value={name}
            onChange={(event) => { if ([...event.target.value].length <= 50) setName(event.target.value); }}
            placeholder={`New ${singular.toLowerCase()} name`}
            required
            disabled={createBusy}
          />
          <button type="submit" className="text-action" disabled={createBusy}>{createBusy ? 'Creating…' : `Create ${singular}`}</button>
        </div>
      </form>
      {createError && <p className="inline-error" role="alert">{formatApiError(createError, `The ${singular} could not be created.`)}</p>}
      {resources.length > 0 && (
        <ul className="taxonomy-list" aria-label={title}>
          {resources.map((resource) => <TaxonomyResourceRow key={resource.id} kind={kind} resource={resource} taxonomy={taxonomy} onRename={onRename} onRemove={onRemove} />)}
        </ul>
      )}
      {pageError && (
        <div className="page-error" role="alert">
          <span>Page {pageError.page} could not be loaded.</span>
          <button type="button" className="search-action search-action--secondary" onClick={() => taxonomy.retryPage(kind)}>
            Retry page {pageError.page}
          </button>
        </div>
      )}
      {pagination?.hasMore && (
        <button type="button" className="search-action search-action--secondary" onClick={() => taxonomy.loadMore(kind)} disabled={loadingMore}>
          {loadingMore ? `Loading more ${title}…` : `Load more ${title}`}
        </button>
      )}
    </div>
  );
}

function TaxonomyPanel({ taxonomy, onRename, onRemove }) {
  return (
    <section className="taxonomy-panel" aria-labelledby="taxonomy-title" aria-busy={taxonomy.isBusy}>
      <div className="taxonomy-panel__heading">
        <div>
          <h3 id="taxonomy-title">Shape your signal.</h3>
        </div>
        <p>Tags and Collections are private. Deleting one removes only its memberships; saved Library Items stay.</p>
      </div>
      {taxonomy.status === 'loading' && <p className="library-announcement" aria-live="polite">Loading your Tags and Collections…</p>}
      {taxonomy.status === 'error' && (
        <div className="library-state library-state--error" role="alert">
          <h3>Relationships did not come through.</h3>
          <p>{formatApiError(taxonomy.error, 'Tags and Collections are currently unavailable.')}</p>
          <button type="button" className="search-action search-action--secondary" onClick={taxonomy.retry}>Retry Tags and Collections</button>
        </div>
      )}
      {taxonomy.status === 'success' && (
        <div className="taxonomy-groups">
          <TaxonomyResourceGroup kind="tag" resources={taxonomy.tags} taxonomy={taxonomy} onRename={onRename} onRemove={onRemove} />
          <TaxonomyResourceGroup kind="collection" resources={taxonomy.collections} taxonomy={taxonomy} onRename={onRename} onRemove={onRemove} />
        </div>
      )}
    </section>
  );
}

function LibraryView({ auth, library, taxonomy, onRequestSignIn, onRename, onRemove, artwork }) {
  const loading = Boolean(auth.user && (library.status === 'idle' || library.status === 'loading'));
  const hasFilters = Object.values(library.filters).some((value) => value !== undefined);

  return (
    <section className="library-section" id="library" aria-labelledby="library-title" aria-busy={loading}>
      <div className="section-heading">
        <div>
          <h2 id="library-title">Your library.</h2>

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

      {auth.user && <LibraryFilters library={library} taxonomy={taxonomy} />}
      {auth.user && <details className="library-organize"><summary>Organize Tags &amp; Collections</summary><TaxonomyPanel taxonomy={taxonomy} onRename={onRename} onRemove={onRemove} /></details>}

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
          <h3>{hasFilters ? 'No Library Items match.' : 'Your library is clear.'}</h3>
          <p>{hasFilters ? 'Try another filter combination or clear the current focus.' : 'Save a result from Search the signal to create your first stored reference.'}</p>
          {hasFilters && <button type="button" className="search-action search-action--secondary" onClick={() => library.applyFilters({})}>Clear filters</button>}
        </div>
      )}

      {auth.user && library.status === 'success' && library.results.length > 0 && (
        <ul className="library-list" aria-label="Saved library items">
          {library.results.map((item) => <LibraryItem item={item} library={library} taxonomy={taxonomy} key={item.id} mediaEntry={artwork.entries[mediaIdentity(item)]} onRetryArtwork={() => artwork.retry(item)} />)}
        </ul>
      )}

      {auth.user && library.pageError && (
        <div className="page-error" role="alert">
          <span>Page {library.pageError.page} could not be loaded.</span>
          <button type="button" className="search-action search-action--secondary" onClick={library.retryPage}>Retry page {library.pageError.page}</button>
        </div>
      )}

      {auth.user && library.status === 'success' && library.pagination?.hasMore && (
        <div className="load-more-wrap">
          <button type="button" className="search-action search-action--primary" onClick={library.loadMore} disabled={library.loadingPage}>
            {library.loadingPage ? 'Loading more…' : 'Load more Library Items'}
          </button>
        </div>
      )}

      {auth.user && library.error && library.status !== 'error' && !library.pageError && (
        <p className="form-error" role="alert">{formatApiError(library.error, 'The library action could not be completed.')}</p>
      )}
    </section>
  );
}

export default function App() {
  const { status, error, retry } = useHealthCheck();
  const [authMode, setAuthMode] = useState('login');
  const [signInPrompt, setSignInPrompt] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [view, setView] = useState('discover');
  const mainRef = useRef(null);
  const navigate = (nextView) => {
    setView(nextView);
    setSignInPrompt('');
  };
  useEffect(() => {
    if (mainRef.current) { mainRef.current.scrollTop = 0; mainRef.current.focus({ preventScroll: true }); }
  }, [view]);
  const auth = useAuth({ checkOnMount: true });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { window.localStorage.setItem(THEME_STORAGE_KEY, theme); } catch { /* Session-only theme when storage is unavailable. */ }
  }, [theme]);

  const handleAuthenticationRequired = useCallback(() => {
    auth.clearSession();
    setAuthMode('login');
    setSignInPrompt('Your session has expired. Sign in again to manage your library.');
  }, [auth.clearSession]);

  const library = useLibrary({
    enabled: auth.status === 'authenticated',
    onAuthenticationRequired: handleAuthenticationRequired
  });
  const taxonomy = useTaxonomy({
    enabled: auth.status === 'authenticated',
    onAuthenticationRequired: handleAuthenticationRequired
  });

  const artwork = useLibraryMedia(library.results, { enabled: view === 'library' && Boolean(auth.user), userId: auth.user?.id });
  const saveMedia = async (media) => {
    const item = await library.save(media);
    if (item) artwork.remember(media);
    return item;
  };

  const renameResource = useCallback((kind, id, name) => taxonomy.update(kind, id, name), [taxonomy.update]);
  const removeResource = useCallback(async (kind, id) => {
    const removed = await taxonomy.remove(kind, id);
    if (removed) library.retry();
    return removed;
  }, [library.retry, taxonomy.remove]);

  const requestSignIn = () => {
    setAuthMode('login');
    setSignInPrompt('Sign in to save this reference to your library.');
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <button type="button" className="wordmark" onClick={() => navigate('discover')} aria-label="Goraku Base home">
          <span className="wordmark__mark"><img src="/mainIcon.svg" alt="" /></span>
          <span className="wordmark__copy"><strong>GORAKU</strong><small>BASE</small></span>
        </button>
        <p className="sidebar__label">Your media space</p>
        <nav className="sidebar-nav" aria-label="Primary">
          {[['discover', 'Discover', HomeIcon], ['search', 'Search', SearchIcon], ['library', 'My Library', LibraryIcon], ['account', 'Account', UserIcon], ['about', 'About & status', InfoIcon]].map(([key, label, Icon]) => (
            <button key={key} type="button" className={`sidebar-nav__link${view === key ? ' sidebar-nav__link--active' : ''}`} aria-current={view === key ? 'page' : undefined} aria-label={label} title={label} onClick={() => navigate(key)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          <div className="sidebar-status">
            <span className={`sidebar-status__dot sidebar-status__dot--${status}`} aria-hidden="true" />
            <span><strong>{status === 'connected' ? 'Connected' : status === 'loading' ? 'Checking' : 'Offline'}</strong><small>API status</small></span>
          </div>
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <strong className="view-title">{{ discover: 'Discover', search: 'Search', library: 'My Library', account: 'Account', about: 'About & status' }[view]}</strong>
          <div className="topbar__actions">
            <ThemeToggle theme={theme} onToggle={() => setTheme((current) => current === 'dark' ? 'light' : 'dark')} />
          </div>
        </header>

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {signInPrompt && view !== 'account' && <p className="auth-prompt" role="status">{signInPrompt} Select Account in the sidebar.</p>}
        <div hidden={view !== 'discover'}>
        <section className="intro" id="discover" aria-labelledby="page-title">
          <div className="intro__content">
            <h1 id="page-title">Find stories<br /><span>worth keeping.</span></h1>
            <p className="intro-copy">
              Search anime, movies, TV, and games from the sources you already trust. Save the ones that stay with you.
            </p>
            <p className="intro-hint">Browse a catalog below, or select Search in the sidebar.</p>
          </div>
          <div className="intro__visual" aria-hidden="true">
            <div className="intro__halo" />
            <img src="/mainIcon.svg" alt="" />
            <span>PERSONAL MEDIA ARCHIVE</span>
          </div>
        </section>

        <MediaSearch mode="discover" active={view === 'discover'} user={auth.user} library={library} onSave={saveMedia} onRequestSignIn={requestSignIn} />
        </div>
        <div hidden={view !== 'search'}>
        <MediaSearch
          user={auth.user}
          library={library}
          onSave={saveMedia}
          onRequestSignIn={requestSignIn}
        />

        </div>
        <div hidden={view !== 'library'}>
        <LibraryView
          auth={auth}
          artwork={artwork}
          library={library}
          taxonomy={taxonomy}
          onRequestSignIn={requestSignIn}
          onRename={renameResource}
          onRemove={removeResource}
        />

        </div>
        <div hidden={view !== 'account'}>
        <AuthPanel auth={auth} mode={authMode} onModeChange={(nextMode) => { setAuthMode(nextMode); setSignInPrompt(''); }} signInPrompt={signInPrompt} />

        </div>
        <div hidden={view !== 'about'}>
        <section className="health-section" id="health-check" aria-labelledby="health-title">
          <div className="section-heading">
            <div>
              <h2 id="health-title">Backend connection</h2>
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
            </div>
          </div>
          <p>Discovery, local authentication, and private tracking libraries are live for local and staging use. Google authentication and account recovery remain future signals.</p>
        </section>

      <footer role="contentinfo" className="site-footer" id="credits" aria-labelledby="credits-title">
        <div className="site-footer__identity">
          <span>GORAKU BASE / PHASE 6.6</span>
          <span>ANILIST + MYANIMELIST + TMDB + THEGAMESDB + RAWG / UNOFFICIAL</span>
        </div>
        <div className="tmdb-credits">
          <div>
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
      </main>
      </div>
    </div>
  );
}
