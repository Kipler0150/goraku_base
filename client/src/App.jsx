import { useState } from 'react';
import { useHealthCheck } from './hooks/useHealthCheck.js';
import { useMediaSearch } from './hooks/useMediaSearch.js';
import './styles.css';

const TMDB_URL = 'https://www.themoviedb.org/';
const TMDB_LOGO_URL = 'https://www.themoviedb.org/assets/2/v4/logos/primary-green.svg';
const TMDB_NOTICE = 'This product uses the TMDB API but is not endorsed or certified by TMDB.';

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

const MEDIA_TYPE_LABELS = Object.freeze({
  anime: 'Anime',
  movie: 'Movies',
  tv: 'TV'
});

function getMediaTypeLabel(type) {
  return MEDIA_TYPE_LABELS[type] ?? MEDIA_TYPE_LABELS.anime;
}

function getMediaTypeNoun(type) {
  return type === 'anime' ? 'anime' : type === 'movie' ? 'movies' : 'TV';
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
  return [
    ['Episodes', formatCount(media.metadata?.episodeCount, 'Episodes')],
    ['Duration', formatCount(media.metadata?.episodeDurationMinutes, 'Minutes')]
  ];
}

function MediaCard({ media }) {
  const [imageFailed, setImageFailed] = useState(false);
  const title = media.title || 'Title unavailable';
  const hasImage = Boolean(media.image) && !imageFailed;

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

function SearchResults({ search }) {
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

      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>No results for “{state.query}”.</h3>
          <p>Try a shorter title, an alternate spelling, or another {typeNoun === 'TV' ? 'series' : 'title'}.</p>
        </SearchState>
      )}

      {state.status === 'success' && state.results.length > 0 && (
        <>
          <ul className="media-grid" aria-label={`${typeLabel} search results`}>
            {state.results.map((media) => (
              <li key={media.id}>
                <MediaCard media={media} />
              </li>
            ))}
          </ul>

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

function MediaSearch() {
  const search = useMediaSearch({ type: 'anime' });
  const typeLabel = getMediaTypeLabel(search.type);
  const attribution = search.state.source === 'myanimelist'
    ? 'UNOFFICIAL MYANIMELIST INTEGRATION'
    : search.state.source === 'anilist'
      ? 'UNOFFICIAL ANILIST INTEGRATION'
      : search.state.source === 'tmdb'
        ? 'UNOFFICIAL TMDB INTEGRATION'
        : search.type === 'anime'
          ? 'UNOFFICIAL ANILIST / MYANIMELIST INTEGRATION'
          : `SEARCHING ${typeLabel.toUpperCase()} CATALOG`;

  return (
    <section className="search-section" id="media-search" aria-labelledby="media-search-title">
      <div className="section-heading">
        <div>
          <h2 id="media-search-title">Search the signal.</h2>
          <p className="section-index">DISCOVERY / {typeLabel.toUpperCase()}</p>
        </div>
        <p className="search-attribution">{attribution}</p>
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
          </select>
        </div>
        <label className="search-form__label" htmlFor="media-query">Search {getMediaTypeNoun(search.type)} by title</label>
        <div className="search-field">
          <input
            id="media-query"
            type="search"
            value={search.query}
            onChange={(event) => search.changeQuery(event.target.value)}
            placeholder={search.type === 'anime' ? 'Try Fullmetal Alchemist' : search.type === 'movie' ? 'Try Arrival' : 'Try Severance'}
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

      <SearchResults search={search} />
    </section>
  );
}

export default function App() {
  const { status, error, retry } = useHealthCheck();

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
              Search normalized anime, movie, and TV metadata through the Goraku Base boundary. The browser talks to Express; each provider stays behind the signal.
            </p>
          </div>
        </section>

        <MediaSearch />

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
          <p>Anime, movie, and TV discovery are live through Express. Accounts, personal tracking, and additional providers remain queued for later phases.</p>
        </section>
      </main>

      <footer className="site-footer" id="credits" aria-labelledby="credits-title">
        <div className="site-footer__identity">
          <span>GORAKU BASE / PHASE 3</span>
          <span>ANI LIST + MYANIMELIST + TMDB / UNOFFICIAL</span>
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
          </div>
        </div>
      </footer>
    </div>
  );
}
