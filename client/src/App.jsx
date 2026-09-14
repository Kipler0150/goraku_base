import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { useAuth } from './hooks/useAuth.js';
import { useLibrary } from './hooks/useLibrary.js';
import { hasActiveSearchFilters, useMediaSearch } from './hooks/useMediaSearch.js';
import { useMediaFilterOptions } from './hooks/useMediaFilterOptions.js';
import { useMediaDetails } from './hooks/useMediaDetails.js';
import { useMediaDiscovery } from './hooks/useMediaDiscovery.js';
import { useMediaRecommendations } from './hooks/useMediaRecommendations.js';
import { useMediaEpisodes } from './hooks/useMediaEpisodes.js';
import { useTaxonomy } from './hooks/useTaxonomy.js';
import { LIBRARY_STATUS_VALUES } from './api/library.js';
import { mediaIdentity } from './mediaIdentity.js';
import { useLibraryMedia } from './hooks/useLibraryMedia.js';
import './styles.css';

const THEME_STORAGE_KEY = 'goraku-base-theme';
const PROFILE_AVATAR_FALLBACK = '/mainIcon.svg';
const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
const PROFILE_AVATAR_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp']);

const PROVIDERS = Object.freeze({
  anilist: { label: 'AniList' },
  myanimelist: { label: 'MyAnimeList' },
  tmdb: { label: 'TMDB' },
  thegamesdb: { label: 'TheGamesDB' },
  rawg: { label: 'RAWG' }
});
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

function creatorPriority(role) {
  const normalizedRole = typeof role === 'string' ? role.toLowerCase() : '';
  if (normalizedRole.includes('director')) return 0;
  if (normalizedRole.includes('creator') || normalizedRole.includes('showrunner')) return 1;
  if (['writer', 'screenplay', 'story', 'series composition'].some((keyword) => normalizedRole.includes(keyword))) return 2;
  if (normalizedRole.includes('executive producer')) return 3;
  if (normalizedRole.includes('producer')) return 4;
  return 5;
}

function formatPrimaryCreators(creators) {
  if (!Array.isArray(creators)) return 'Creators unavailable';
  const uniqueCreators = creators
    .filter((creator) => creator && typeof creator.name === 'string' && creator.name.trim())
    .map((creator, index) => ({ name: creator.name.trim(), role: creator.role, index }))
    .filter((creator, index, values) => values.findIndex((candidate) => candidate.name === creator.name) === index)
    .sort((left, right) => creatorPriority(left.role) - creatorPriority(right.role) || left.index - right.index)
    .slice(0, 5);
  return uniqueCreators.length > 0 ? uniqueCreators.map((creator) => creator.name).join(', ') : 'Creators unavailable';
}

function hasCreatorMetadata(creators) {
  return Array.isArray(creators) && creators.some((creator) => creator && typeof creator.name === 'string' && creator.name.trim());
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

function getBookmarkNoun(type) {
  if (type === 'ANIME') return 'anime';
  if (type === 'MOVIE') return 'movie';
  if (type === 'TV') return 'TV show';
  if (type === 'GAME') return 'game';
  return 'item';
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

function HomeIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m4 11 8-7 8 7v8a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1v-8Z" /></svg>;
}

function SearchIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.8" cy="10.8" r="6.3" /><path d="m16 16 4.5 4.5" /></svg>;
}

function LibraryIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5h11a3 3 0 0 1 3 3V19H8a3 3 0 0 1-3-3V4.5Z" /><path d="M8 19h11M8 8h7M8 12h7" /></svg>;
}

function UserIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.2" /><path d="M5.5 20c.7-3.2 3-5 6.5-5s5.8 1.8 6.5 5" /></svg>;
}

function EditIcon() {
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m14.5 5.5 4 4M5 19l3.5-.8L19.2 7.5a1.7 1.7 0 0 0 0-2.4l-.3-.3a1.7 1.7 0 0 0-2.4 0L5.8 15.5 5 19Z" /></svg>;
}

function CatalogIcon({ type }) {
  if (type === 'anime') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 4.5h10l2.5 2.5v10L17 19.5H7L4.5 17V7L7 4.5Z" /><path d="m10 9 5 3-5 3V9Z" /></svg>;
  }
  if (type === 'movie') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="5" width="16" height="14" rx="2" /><path d="M4 9h16M4 15h16M8 5v4M16 5v4M8 15v4M16 15v4" /></svg>;
  }
  if (type === 'tv') {
    return <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="6" width="16" height="11" rx="2" /><path d="m9 3 3 3 3-3M9 21h6M12 17v4" /></svg>;
  }
  return <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 9h9a4.5 4.5 0 0 1 4.2 6.1l-1 2.5a2 2 0 0 1-3.5.4l-1.2-1.8H9l-1.2 1.8a2 2 0 0 1-3.5-.4l-1-2.5A4.5 4.5 0 0 1 7.5 9Z" /><path d="M8 12v4M6 14h4M16.5 13h.01M18.5 15h.01" /></svg>;
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
    </button>
  );
}

function getUserAvatarSource(user) {
  if (!user?.avatarUpdatedAt) return PROFILE_AVATAR_FALLBACK;
  return `/api/auth/avatar?v=${encodeURIComponent(user.avatarUpdatedAt)}`;
}

function UserAvatar({ user, previewUrl = null, className = '' }) {
  const source = previewUrl ?? getUserAvatarSource(user);
  const [failedSource, setFailedSource] = useState(null);
  const imageSource = failedSource === source ? PROFILE_AVATAR_FALLBACK : source;

  useEffect(() => {
    setFailedSource(null);
  }, [source]);

  return (
    <span className={`user-avatar ${className}`.trim()} aria-hidden="true">
      <img
        src={imageSource}
        alt=""
        onError={imageSource === PROFILE_AVATAR_FALLBACK ? undefined : () => setFailedSource(source)}
      />
    </span>
  );
}

function AuthActions({ user, onOpenAuth }) {
  if (user) {
    return (
      <button type="button" className="topbar-user" onClick={() => onOpenAuth('account')}>
        <UserAvatar user={user} className="user-avatar--topbar" />
        <span>{user.username}</span>
      </button>
    );
  }

  return (
    <div className="topbar-auth" aria-label="Account actions">
      <button type="button" className="topbar-auth__link" onClick={() => onOpenAuth('login')}>Sign in</button>
      <button type="button" className="search-action search-action--primary" onClick={() => onOpenAuth('register')}>Sign up</button>
    </div>
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
  const isRemoving = library.isRemoveBusy(media);
  const cardInteractive = Boolean(onViewDetails);
  const isDetailCard = !cardInteractive;
  const bookmarkNoun = getBookmarkNoun(media.type);
  const bookmarkLabel = isSaving
    ? 'Saving to library'
    : isRemoving
      ? 'Removing from library'
      : isSaved
        ? `Remove this ${bookmarkNoun}`
        : `Bookmark this ${bookmarkNoun}`;
  const compactBookmarkLabel = isSaving
    ? 'Saving to library'
    : isRemoving
      ? 'Removing from library'
      : isSaved
        ? 'Remove from library'
        : 'Save to library';
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
        className={'media-card__bookmark' + (isDetailCard ? ' media-card__bookmark--detail' : '')}
        onClick={() => {
          if (!user) onRequestSignIn(media);
          else if (isSaved) library.removeMedia(media);
          else onSave(media);
        }}
        disabled={isSaving || isRemoving}
        aria-label={isDetailCard ? bookmarkLabel : compactBookmarkLabel}
        title={isDetailCard ? bookmarkLabel : isSaving ? 'Saving ' + title + ' to library' : isRemoving ? 'Removing ' + title + ' from library' : isSaved ? 'Remove ' + title + ' from library' : 'Save ' + title + ' to library'}
      >
        <BookmarkIcon filled={isSaved} />
        {isDetailCard ? <span>{bookmarkLabel}</span> : <span className="visually-hidden">{compactBookmarkLabel}</span>}
      </button>
    </article>
  );
}

function SaveDestinationDialog({ media, onSave, onClose, taxonomy }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saveMode, setSaveMode] = useState('');
  const [tagId, setTagId] = useState('');
  const [collectionId, setCollectionId] = useState('');
  const dialogRef = useRef(null);
  const modeRef = useRef(null);

  useEffect(() => {
    if (!media) return undefined;
    const previousFocus = document.activeElement;
    setBusy(false);
    setError('');
    setSaveMode('');
    setTagId('');
    setCollectionId('');
    modeRef.current?.focus();
    return () => previousFocus?.focus?.();
  }, [media]);

  useEffect(() => {
    if (!media) return undefined;
    const handleKeyDown = (event) => {
      if (event.key === 'Escape' && !busy) {
        onClose();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = [...dialogRef.current?.querySelectorAll('button:not(:disabled), select:not(:disabled)') ?? []];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [busy, media, onClose]);

  if (!media) return null;

  const title = media.title || 'this title';
  const save = async (destination) => {
    setBusy(true);
    setError('');
    const result = await onSave(media, destination);
    if (!result) {
      setError('This item could not be saved. Try again.');
      setBusy(false);
      return;
    }
    if (result.attached === false) {
      const destinationNames = (Array.isArray(destination) ? destination : [destination]).map(({ resource }) => resource.name).join(' and ');
      setError(`Saved to your library, but could not add it to ${destinationNames}. You can retry from My Library.`);
      setBusy(false);
      return;
    }
    onClose();
  };
  const handleModeChange = (event) => {
    const nextMode = event.target.value;
    setSaveMode(nextMode);
    setTagId('');
    setCollectionId('');
    if (nextMode === 'library') save(null);
  };
  const handleDestinationChange = (kind, event) => {
    const nextId = event.target.value;
    const nextTagId = kind === 'tag' ? nextId : tagId;
    const nextCollectionId = kind === 'collection' ? nextId : collectionId;
    if (kind === 'tag') setTagId(nextId);
    if (kind === 'collection') setCollectionId(nextId);
    if (!nextId) return;
    if (saveMode === 'tag-collection') {
      if (!nextTagId || !nextCollectionId) return;
      const tag = taxonomy.tags.find((candidate) => candidate.id === nextTagId);
      const collection = taxonomy.collections.find((candidate) => candidate.id === nextCollectionId);
      if (tag && collection) save([
        { kind: 'tag', resource: tag },
        { kind: 'collection', resource: collection }
      ]);
      return;
    }
    const resources = kind === 'tag' ? taxonomy.tags : taxonomy.collections;
    const resource = resources.find((candidate) => candidate.id === nextId);
    if (resource) save({ kind, resource });
  };

  return (
    <div
      className="save-destination-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose();
      }}
    >
      <section ref={dialogRef} className="save-destination" role="dialog" aria-modal="true" aria-labelledby="save-destination-title">
        <h2 id="save-destination-title">Save {title}</h2>
        <p className="save-destination__intro">Choose how to save this item.</p>
        <div className="save-destination__groups">
          <label className="save-destination__field" htmlFor="save-destination-mode">
            Save method
            <select ref={modeRef} id="save-destination-mode" value={saveMode} onChange={handleModeChange} disabled={busy}>
              <option value="" disabled>Choose a save method</option>
              <option value="library">Save to Library Only</option>
              <option value="tag" disabled={taxonomy.tags.length === 0}>Save to Tags</option>
              <option value="collection" disabled={taxonomy.collections.length === 0}>Save to Collection</option>
              <option value="tag-collection" disabled={taxonomy.tags.length === 0 || taxonomy.collections.length === 0}>Save to Tags and Collection</option>
            </select>
          </label>
          {(saveMode === 'tag' || saveMode === 'tag-collection') && (
            <label className="save-destination__field" htmlFor="save-destination-tag">
              Tag
              <select id="save-destination-tag" value={tagId} onChange={(event) => handleDestinationChange('tag', event)} disabled={busy}>
                <option value="" disabled>Choose a tag</option>
                {taxonomy.tags.map((tag) => <option key={tag.id} value={tag.id}>{tag.name}</option>)}
              </select>
            </label>
          )}
          {(saveMode === 'collection' || saveMode === 'tag-collection') && (
            <label className="save-destination__field" htmlFor="save-destination-collection">
              Collection
              <select id="save-destination-collection" value={collectionId} onChange={(event) => handleDestinationChange('collection', event)} disabled={busy}>
                <option value="" disabled>Choose a collection</option>
                {taxonomy.collections.map((collection) => <option key={collection.id} value={collection.id}>{collection.name}</option>)}
              </select>
            </label>
          )}
        </div>
        {error && <p className="save-destination__error" role="alert">{error}</p>}
        <div className="save-destination__footer">
          <button type="button" className="text-action text-action--quiet" onClick={onClose} disabled={busy}>Cancel</button>
        </div>
      </section>
    </div>
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
  // MyAnimeList errors covered by a successful AniList fallback are informational.
  if (provider === 'myanimelist' && pagination.providers?.anilist && !pagination.providers?.myanimelist) return false;
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
                  {provider === 'myanimelist' ? 'Anime results are using AniList.' : 'Game results are using RAWG.'}
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
  const filtered = hasActiveSearchFilters(state.filters);
  const searchTarget = state.query
    ? filtered
      ? `selected ${typeNoun} filters`
      : `${typeNoun} for ${state.query}`
    : filtered
      ? `latest ${typeNoun} releases matching selected filters`
      : `latest ${typeNoun} releases`;
  const loadMoreLabel = state.query
    ? `Load more ${typeNoun} results for ${state.query}`
    : `Load more ${searchTarget}`;
  const statusMessage = state.status === 'initial'
    ? 'Ready to browse latest releases or search by title.'
    : state.status === 'loading'
      ? `${state.query ? 'Searching' : 'Loading'} ${searchTarget}.`
      : state.loadingPage
        ? `Loading more ${searchTarget}.`
        : state.status === 'error'
        ? `${typeLabel} search is unavailable.`
        : state.results.length === 0
          ? state.query
            ? `No ${typeNoun} results for ${state.query}.`
            : `No ${searchTarget} found.`
          : `${state.results.length} ${state.query ? `${typeNoun} results` : searchTarget} loaded.`;

  return (
    <div className="search-results" id="media-results" role="region" aria-label={`${typeLabel} search results`} aria-busy={isBusy}>
      <p className="search-announcement" aria-live="polite" aria-atomic="true">{statusMessage}</p>

      {state.status === 'initial' && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">/ / /</span>
          <h3>Browse the latest releases.</h3>
          <p>Search the {typeNoun} catalog by title, or leave the title blank to see what just released.</p>
        </SearchState>
      )}

      {state.status === 'loading' && (
        <>
          <p className="visually-hidden">{state.query ? 'Searching' : 'Loading latest releases'}. Results will appear below.</p>
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

      {state.status === 'success' && filtered && state.source && (
        <p className="search-results__source" role="status">Filtered by {getProviderLabel(state.source)}.</p>
      )}

      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>{filtered ? 'No matches for these filters.' : state.query ? `No results for “${state.query}”.` : 'No latest releases found.'}</h3>
          <p>{filtered ? 'Adjust the selected filters and search again.' : state.query ? `Try a shorter title, an alternate spelling, or another ${typeNoun === 'TV' ? 'series' : 'title'}.` : 'Try again later or choose another catalog.'}</p>
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
                aria-label={loadMoreLabel}
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
      message: `This ${operationName} operation is not supported by the catalog provider.`
    },
    'rate-limited': {
      title: 'Provider rate-limited.',
      message: 'The catalog provider is rate-limited.'
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
      message: `The catalog provider could not return ${operationName.toLowerCase()}.`
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

const DISCOVERY_CATALOGS = Object.freeze([
  { value: 'anime', label: 'Anime' },
  { value: 'movie', label: 'Movies' },
  { value: 'tv', label: 'TV' },
  { value: 'game', label: 'Games' }
]);

const DISCOVERY_SHELVES = Object.freeze({
  default: Object.freeze([
    { key: 'popular', label: 'Popular now', operation: 'popular' },
    { key: 'trending', label: 'Trending this week', operation: 'trending' },
    { key: 'latest', label: 'Latest releases', operation: 'latest' }
  ]),
  game: Object.freeze([
    { key: 'popular', label: 'Popular', operation: 'popular' },
    { key: 'latest', label: 'Latest releases', operation: 'latest' }
  ]),
  anime: Object.freeze([
    { key: 'popular', label: 'Popular now', operation: 'popular' },
    { key: 'trending', label: 'Currently airing', operation: 'trending' },
    { key: 'latest', label: 'Seasonal releases', operation: 'latest' }
  ])
});

function getDiscoveryShelves(type) {
  if (type === 'anime') return DISCOVERY_SHELVES.anime;
  if (type === 'game') return DISCOVERY_SHELVES.game;
  return DISCOVERY_SHELVES.default;
}

function DiscoveryHero({ media, type, onViewDetails }) {
  const typeLabel = getMediaTypeLabel(type);
  const shelfDescription = type === 'anime'
    ? 'popular, currently airing, and seasonal releases'
    : type === 'game'
      ? 'popular and latest releases'
      : 'popular, trending, and latest releases';
  const popularLabel = getDiscoveryShelves(type).find((shelf) => shelf.key === 'popular')?.label ?? 'Popular now';
  if (!media) {
    return (
      <section className="discovery-hero discovery-hero--empty" aria-label="Discover feature">
        <div className="discovery-hero__copy">
          <p className="section-index">YOUR NEXT FAVORITE</p>
          <h2>Find the story that stays with you.</h2>
          <p>Choose a catalog above to surface Provider-owned picks across {shelfDescription}.</p>
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
        <p>Selected from {popularLabel} in the {typeLabel.toLowerCase()} catalog.</p>
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
    railRef.current?.scrollBy?.({ left: direction * Math.max(280, railRef.current.clientWidth * 0.72), behavior: 'smooth' });
  };

  const showNextPage = () => {
    scrollRail(1);
    if (state.pagination?.hasMore) discovery.loadMore();
  };

  const handleRailScroll = () => {
    const rail = railRef.current;
    if (!rail || discovery.isBusy || state.loadingPage || !state.pagination?.hasMore) return;
    if (rail.scrollWidth <= rail.clientWidth) return;
    const remaining = rail.scrollWidth - rail.clientWidth - rail.scrollLeft;
    if (remaining <= Math.max(40, rail.clientWidth * 0.12)) discovery.loadMore();
  };

  return (
    <section className="discovery-shelf" role="region" aria-label={`${resourceLabel} shelf`} aria-busy={discovery.isBusy || state.status === 'initial'}>
      <div className="discovery-shelf__heading">
        <div>
          <h3>{shelf.label}</h3>
        </div>
        <div className="discovery-shelf__actions">
          <span className="visually-hidden" aria-live="polite">{statusMessage}</span>
          <button type="button" className="shelf-arrow shelf-arrow--previous" onClick={() => scrollRail(-1)} aria-label={`Scroll ${resourceLabel} left`} title="Scroll left">
            <ArrowIcon />
          </button>
          <button type="button" className="shelf-arrow" onClick={showNextPage} aria-label={`Scroll ${resourceLabel} right`} title="Scroll right">
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
          <p>The catalog provider has no items for this shelf right now.</p>
        </SearchState>
      )}
      {state.results.length > 0 && (
        <>
          <div className="discovery-rail" ref={railRef} onScroll={handleRailScroll}>
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
        </>
      )}
    </section>
  );
}

function DiscoverWorkspace({ active, includeAdult, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const [type, setType] = useState('movie');
  const popular = useMediaDiscovery({ includeAdult });
  const trending = useMediaDiscovery({ includeAdult });
  const latest = useMediaDiscovery({ includeAdult });
  const featured = popular.state.results[0] ?? trending.state.results[0] ?? null;
  const shelves = getDiscoveryShelves(type);
  const discoveryByShelf = { popular, trending, latest };

  useEffect(() => {
    if (!active) return undefined;
    const timer = window.setTimeout(() => {
      shelves.forEach((shelf) => discoveryByShelf[shelf.key].load({ operation: shelf.operation, type }));
    }, 0);
    return () => window.clearTimeout(timer);
  }, [active, type]);

  const changeType = (nextType) => setType(nextType);

  return (
    <div className="discover-workspace">
      <div className="discovery-controls">
        <div className="discovery-controls__heading">
          <div>
            <p className="section-index">DISCOVER / CURATED SHELVES</p>
            <h3>What are you in the mood for?</h3>
          </div>
        </div>
        <div className="discovery-catalog-picker" role="group" aria-label="Discovery catalogs">
          {DISCOVERY_CATALOGS.map((catalog) => (
            <button
              key={catalog.value}
              type="button"
              className={`discovery-catalog-picker__button${type === catalog.value ? ' discovery-catalog-picker__button--active' : ''}`}
              aria-pressed={type === catalog.value}
              aria-label={catalog.label}
              title={catalog.label}
              onClick={() => changeType(catalog.value)}
            >
              <CatalogIcon type={catalog.value} />
              <span className="discovery-catalog-picker__label">{catalog.label}</span>
            </button>
          ))}
        </div>
      </div>

      <DiscoveryHero media={featured} type={type} onViewDetails={onViewDetails} />
      <div className="discovery-shelves">
        {shelves.map((shelf) => (
          <DiscoveryShelf
            key={shelf.key}
            shelf={shelf}
            discovery={discoveryByShelf[shelf.key]}
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

function RecommendationResults({ recommendations, popularFallback, media, user, library, onSave, onRequestSignIn, onViewDetails }) {
  const usePopularFallback = media?.type === 'GAME' && recommendations.state.status === 'error';
  const displayed = usePopularFallback ? popularFallback : recommendations;
  const { state } = displayed;
  const title = usePopularFallback ? 'Popular games' : 'Recommendations';

  return (
    <section className="recommendations-panel" role="region" aria-label={title} aria-busy={displayed.isBusy}>
      <div className="recommendations-panel__heading">
        <div>
          <h3>{title}</h3>
        </div>
      </div>
      {usePopularFallback && <p className="recommendations-panel__fallback">Recommendations are unavailable, so popular games are shown instead.</p>}
      {state.status === 'loading' && state.results.length === 0 && <SearchSkeletons />}
      {state.status === 'error' && <PublicMediaError error={state.error} onRetry={displayed.retry} resource={title} />}
      {state.status === 'success' && state.results.length === 0 && (
        <SearchState>
          <span className="state-mark" aria-hidden="true">0</span>
          <h3>No {usePopularFallback ? 'popular games' : 'recommendations'} found.</h3>
          <p>{usePopularFallback ? 'The provider returned no popular games.' : 'The provider returned no related titles.'}</p>
        </SearchState>
      )}
      {state.results.length > 0 && (
        <>
          <MediaGrid
            results={state.results}
            label={usePopularFallback ? 'Popular games' : 'Recommended media'}
            user={user}
            library={library}
            onSave={onSave}
            onRequestSignIn={onRequestSignIn}
            onViewDetails={onViewDetails}
          />
          {state.pagination?.hasMore && (
            <div className="load-more-wrap">
              <button type="button" className="search-action search-action--primary" onClick={displayed.loadMore} disabled={displayed.isBusy || state.status === 'error'}>
                {displayed.isBusy ? 'Loading more…' : `Load more ${usePopularFallback ? 'popular games' : 'recommendations'}`}
              </button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

function EpisodeTrackingSection({ media, user, library, libraryItem: providedLibraryItem = null, onRequestSignIn }) {
  const titleId = useId();
  const seasonId = useId();
  const libraryItem = providedLibraryItem ?? library.findSavedItem?.(media);
  const episodes = useMediaEpisodes({
    media,
    libraryItemId: libraryItem?.id,
    enabled: Boolean(user && libraryItem),
    onAuthenticationRequired: () => onRequestSignIn(media)
  });

  if (!episodes.supported) return null;

  return (
    <section className="episode-tracking" aria-labelledby={titleId} aria-busy={episodes.isBusy}>
      <div className="episode-tracking__heading">
        <div>
          <h3 id={titleId}>Episodes</h3>
          <p>Track which released episodes you have watched.</p>
        </div>
        {episodes.episodeStatus === 'success' && (
          <p className="episode-tracking__summary" aria-live="polite">
            {episodes.watchedCount} of {episodes.episodes.length} watched
          </p>
        )}
      </div>

      {!user ? (
        <button type="button" className="text-action" onClick={() => onRequestSignIn(media)}>Sign in to track episodes</button>
      ) : !libraryItem ? (
        <p className="editor-empty">Bookmark this title to start tracking episodes.</p>
      ) : episodes.episodeStatus === 'loading' ? (
        <p className="editor-empty" aria-live="polite">Loading episodes…</p>
      ) : episodes.episodeStatus === 'error' ? (
        <p className="form-error" role="alert">
          {formatApiError(episodes.error, 'Episode data is unavailable. Use Progress in My Library for aggregate tracking.')}
        </p>
      ) : (
        <>
          <div className="episode-tracking__toolbar">
            <label htmlFor={seasonId}>Season
              <select id={seasonId} value={episodes.season} onChange={(event) => episodes.setSeason(Number(event.target.value))} disabled={episodes.isBusy}>
                {episodes.seasonOptions.map((seasonNumber) => <option value={seasonNumber} key={seasonNumber}>Season {seasonNumber}</option>)}
              </select>
            </label>
            <div className="episode-tracking__bulk-actions">
              <button type="button" className="text-action" onClick={() => episodes.markAll(true)} disabled={episodes.isBusy || episodes.episodes.length === 0}>Mark all watched</button>
              <button type="button" className="text-action text-action--quiet" onClick={() => episodes.markAll(false)} disabled={episodes.isBusy || episodes.episodes.length === 0}>Clear watched</button>
            </div>
          </div>
          {episodes.watchedStatus === 'error' && (
            <p className="form-error" role="alert">{formatApiError(episodes.error, 'Watched episode state is unavailable.')}</p>
          )}
          {episodes.episodes.length === 0 ? (
            <p className="editor-empty">No released episodes are available for this season.</p>
          ) : (
            <ul className="episode-list">
              {episodes.episodes.map((episode) => {
                const checked = episodes.watched.has(`${episodes.season}:${episode.number}`);
                const episodeTitle = episode.title || `Episode ${episode.number}`;
                const hasDistinctTitle = episodeTitle !== `Episode ${episode.number}`;
                return (
                  <li className="episode-row" key={`${episodes.season}:${episode.number}`}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={(event) => episodes.toggleEpisode(episode.number, event.target.checked)}
                        disabled={episodes.isBusy}
                      />
                      <span className="episode-row__copy">
                        <strong>{hasDistinctTitle ? `Episode ${episode.number}: ${episodeTitle}` : `Episode ${episode.number}`}</strong>
                        {episode.airDate && <span>{formatCardReleaseDate(episode.airDate)}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </section>
  );
}

function MediaDetailsPanel({ details, recommendations, popularFallback, user, library, onSave, onRequestSignIn, onBack, onViewDetails }) {
  const panelRef = useRef(null);
  const titleId = useId();
  const selectedMedia = details.selectedMedia;
  const media = details.media;
  const title = media?.title ?? selectedMedia?.title ?? 'Selected Media';

  useEffect(() => {
    panelRef.current?.focus();
  }, [selectedMedia]);

  return (
    <section ref={panelRef} tabIndex="-1" className="details-panel" role="region" aria-labelledby={titleId} aria-busy={details.isBusy}>
      <div className="details-panel__heading">
        <div>
          <h2 id={titleId}>{title} details</h2>
        </div>
      </div>
      <div className="details-panel__actions">
        <button type="button" className="search-action search-action--secondary" onClick={onBack}>Back to results</button>
      </div>
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
              <h3>About this title</h3>
              <p>{media.description ?? 'Description unavailable.'}</p>
              <dl className="details-facts">
                <div><dt>Provider</dt><dd>{getProviderLabel(media.provider)}</dd></div>
                <div><dt>Genres</dt><dd>{formatMetadataList(media.genres, 'Genres')}</dd></div>
                {(media.type !== 'GAME' || hasCreatorMetadata(media.creators)) && <div><dt>Key creators</dt><dd>{formatPrimaryCreators(media.creators)}</dd></div>}
              </dl>
              <dl className="details-facts">
                {getCardFacts(media).map(([label, value]) => (
                  <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
                ))}
              </dl>
            </div>
          </div>
          <EpisodeTrackingSection
            media={media}
            user={user}
            library={library}
            onRequestSignIn={onRequestSignIn}
          />
          <RecommendationResults
            recommendations={recommendations}
            popularFallback={popularFallback}
            media={media}
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

function GenreFilter({ search, options, optionsLoading, optionsUnavailable }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const selectedGenres = options.genres.filter((genre) => search.filters.genres.includes(genre.id));
  const selectedCount = search.filters.genres.length;
  const selectionLabel = selectedCount === 0
    ? 'Any genres'
    : selectedCount === 1 && selectedGenres.length === 1
      ? selectedGenres[0].label
      : `${selectedCount} genres selected`;
  const normalizedQuery = query.trim().toLowerCase();
  const visibleGenres = options.genres.filter((genre) => genre.label.toLowerCase().includes(normalizedQuery));

  useEffect(() => {
    setQuery('');
  }, [search.type]);

  const toggleGenre = (genreId) => {
    const genres = search.filters.genres.includes(genreId)
      ? search.filters.genres.filter((selectedId) => selectedId !== genreId)
      : [...search.filters.genres, genreId];
    search.updateFilters({ genres });
  };

  return (
    <div className="search-filter-field search-filter-field--genres">
      <span className="search-filter-field__label" id="media-filter-genres-label">Genres</span>
      <details className="genre-filter">
        <summary aria-label={`Genres: ${selectionLabel}`} onClick={() => setOpen((current) => !current)}>
          <span>{selectionLabel}</span>
          <svg className="genre-filter__chevron" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
            <path d="m3.5 6 4.5 4 4.5-4" />
          </svg>
        </summary>
        <div className="genre-filter__panel" hidden={!open}>
          <div className="genre-filter__search">
            <label className="visually-hidden" htmlFor="media-filter-genres-search">Search genres</label>
            <input
              id="media-filter-genres-search"
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search genres"
              autoComplete="off"
              disabled={optionsUnavailable}
            />
                <button
                  type="button"
                  className="text-action genre-filter__reset"
                  onClick={() => {
                    setQuery('');
                    search.updateFilters({ genres: [] });
                  }}
                  disabled={selectedCount === 0 && query.trim() === ''}
                >
              Reset
            </button>
          </div>
          {optionsLoading ? (
            <p className="genre-filter__status" aria-live="polite">Loading genres…</p>
          ) : optionsUnavailable ? (
            <p className="genre-filter__status" role="status">Genre options are unavailable right now.</p>
          ) : visibleGenres.length === 0 ? (
            <p className="genre-filter__status">No genres match “{query}”.</p>
          ) : (
            <div className="genre-filter__options" role="group" aria-label="Genre options">
              {visibleGenres.map((genre) => {
                const selected = search.filters.genres.includes(genre.id);
                return (
                  <button
                    type="button"
                    className={`genre-filter__option${selected ? ' is-selected' : ''}`}
                    aria-pressed={selected}
                    key={genre.id}
                    onClick={() => toggleGenre(genre.id)}
                  >
                    {genre.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </details>
      <span className="search-filter-field__hint">Choose one or more; matches any selected genre.</span>
    </div>
  );
}

function SearchFilters({ search }) {
  const [open, setOpen] = useState(false);
  const [creatorQuery, setCreatorQuery] = useState('');
  const options = useMediaFilterOptions({
    type: search.type,
    includeAdult: search.includeAdult,
    creatorQuery,
    enabled: open && search.type !== 'all'
  });
  const isCombined = search.type === 'all';
  const selectedCreatorId = search.filters.creator && typeof search.filters.creator === 'object'
    ? search.filters.creator.id
    : search.filters.creator ?? '';
  const availableCreators = [
    ...(selectedCreatorId && search.filters.creator?.label ? [{ id: selectedCreatorId, label: search.filters.creator.label }] : []),
    ...options.creators.filter((creator) => creator.id !== selectedCreatorId)
  ];
  const filterCount = [
    search.filters.genres.length > 0,
    Boolean(selectedCreatorId),
    search.filters.minRating !== '',
    search.filters.minMetacritic !== ''
  ].filter(Boolean).length;

  useEffect(() => {
    setCreatorQuery('');
  }, [search.type]);

  if (isCombined) {
    return (
      <details className="search-filters search-filters--disabled" onToggle={(event) => setOpen(event.currentTarget.open)}>
        <summary>More filters</summary>
        <div className="search-filters__body">
          <label className="adult-toggle">
            <input
              type="checkbox"
              checked={search.includeAdult}
              onChange={(event) => search.toggleIncludeAdult(event.target.checked)}
            />
            <span>Include adult content</span>
          </label>
          <p className="search-filters__disabled-copy">Choose a catalog to use advanced filters.</p>
        </div>
      </details>
    );
  }

  const optionsUnavailable = options.status === 'error';
  const optionsLoading = options.status === 'loading';
  const ratingField = search.type === 'game' ? 'minMetacritic' : 'minRating';
  const ratingLabel = search.type === 'game' ? 'Minimum Metacritic' : 'Minimum Provider Rating';
  const ratingValues = search.type === 'game'
    ? [50, 60, 70, 80, 90]
    : [2, 4, 6, 7, 8, 9, 10];

  return (
    <details className="search-filters" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>
        <span>More filters</span>
        {filterCount > 0 && <span className="search-filters__count">{filterCount} selected</span>}
      </summary>
      <div className="search-filters__body">
        <label className="adult-toggle">
          <input
            type="checkbox"
            checked={search.includeAdult}
            onChange={(event) => search.toggleIncludeAdult(event.target.checked)}
          />
          <span>Include adult content</span>
        </label>
        {optionsUnavailable && (
          <div className="search-filters__notice" role="status">
            <span>Filter options are unavailable right now.</span>
            <button type="button" className="text-action" onClick={options.retry}>Retry options</button>
          </div>
        )}
        <div className="search-filters__fields">
          <GenreFilter
            search={search}
            options={options}
            optionsLoading={optionsLoading}
            optionsUnavailable={optionsUnavailable}
          />

          <div className="search-filter-field">
            <label htmlFor="media-filter-creator-query">Creator</label>
            <input
              id="media-filter-creator-query"
              type="text"
              value={creatorQuery}
              onChange={(event) => setCreatorQuery(event.target.value)}
              placeholder={optionsLoading ? 'Loading creators…' : 'Find a creator'}
              autoComplete="off"
              disabled={optionsUnavailable}
            />
            <select
              id="media-filter-creator"
              value={selectedCreatorId}
              onChange={(event) => search.updateFilters({ creator: availableCreators.find((creator) => creator.id === event.target.value) ?? null })}
              disabled={optionsUnavailable || optionsLoading}
            >
              <option value="">Any creator</option>
              {availableCreators.map((creator) => <option key={creator.id} value={creator.id}>{creator.label}</option>)}
            </select>
            <span className="search-filter-field__hint">Provider-backed suggestions; choose one.</span>
          </div>

          <label className="search-filter-field" htmlFor={`media-filter-${ratingField}`}>
            {ratingLabel}
            <select
              id={`media-filter-${ratingField}`}
              value={search.filters[ratingField]}
              onChange={(event) => search.updateFilters({ [ratingField]: event.target.value, ...(ratingField === 'minRating' ? { minMetacritic: '' } : { minRating: '' }) })}
            >
              <option value="">Any rating</option>
              {ratingValues.map((value) => <option key={value} value={value}>{value}+</option>)}
            </select>
            <span className="search-filter-field__hint">Normalized to a 0–10 scale where supported.</span>
          </label>
        </div>
        <button type="button" className="text-action text-action--quiet" onClick={search.clearFilters} disabled={filterCount === 0}>Clear filters</button>
      </div>
    </details>
  );
}

function MediaSearch({ user, library, onSave, onRequestSignIn, mode = 'search', active = true }) {
  const workspaceRef = useRef(null);
  const originRef = useRef(null);
  const restoreFocusRef = useRef(false);
  const search = useMediaSearch({ type: 'anime' });
  const details = useMediaDetails({ includeAdult: search.includeAdult });
  const recommendations = useMediaRecommendations({ includeAdult: search.includeAdult });
  const popularFallback = useMediaDiscovery({ includeAdult: search.includeAdult });
  const typeLabel = getMediaTypeLabel(search.type);

  const openDetails = useCallback((media) => {
    if (details.status === 'idle') originRef.current = mediaIdentity(media);
    popularFallback.clear();
    recommendations.load(media);
    details.open(media);
  }, [details.open, details.status, popularFallback.clear, recommendations.load]);

  const backToResults = useCallback(() => {
    restoreFocusRef.current = true;
    popularFallback.clear();
    recommendations.clear();
    details.close();
  }, [details.close, popularFallback.clear, recommendations.clear]);

  useEffect(() => {
    if (details.status !== 'success' || details.media?.type !== 'GAME' || recommendations.state.status !== 'error') return;
    if (popularFallback.state.status !== 'initial') return;
    popularFallback.load({ operation: 'popular', type: 'game', provider: 'rawg' });
  }, [details.media?.type, details.status, popularFallback.load, popularFallback.state.status, recommendations.state.status]);

  useEffect(() => {
    if (details.status !== 'idle' || !restoreFocusRef.current) return;
    restoreFocusRef.current = false;
    const origin = Array.from(workspaceRef.current?.querySelectorAll('[data-media-identity]') ?? [])
      .find((button) => button.dataset.mediaIdentity === originRef.current);
    (origin ?? workspaceRef.current)?.focus();
  }, [details.status]);

  return (
    <section id={mode === 'discover' ? 'discover' : undefined} ref={workspaceRef} tabIndex={-1} className={`search-section ${mode}-workspace`} aria-label={mode === 'search' ? 'Search workspace' : 'Discover workspace'}>
      {mode === 'search' && <>

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
            aria-controls="media-results"
          />
          <button className="search-action search-action--primary search-submit" type="submit">Search</button>
        </div>
        <p className="visually-hidden" id="media-type-help">Changing the media type clears the current results and searches the selected catalog.</p>
        <SearchFilters search={search} />
        {search.formError && <p className="form-error search-form__error" role="alert">{search.formError}</p>}
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
          popularFallback={popularFallback}
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

function AccountProfileEditor({ auth }) {
  const inputRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [previewUrl, setPreviewUrl] = useState(null);
  const [localError, setLocalError] = useState('');

  useEffect(() => () => {
    if (previewUrl && typeof URL !== 'undefined' && typeof URL.revokeObjectURL === 'function') {
      URL.revokeObjectURL(previewUrl);
    }
  }, [previewUrl]);

  const clearSelection = () => {
    setSelectedFile(null);
    setPreviewUrl(null);
    setLocalError('');
    if (inputRef.current) inputRef.current.value = '';
  };

  const handleFileChange = (event) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!PROFILE_AVATAR_TYPES.has(file.type)) {
      setLocalError('Choose a JPG, PNG, or WebP image.');
      return;
    }
    if (file.size > PROFILE_AVATAR_MAX_BYTES) {
      setLocalError('Profile pictures must be 2 MB or smaller.');
      return;
    }

    setLocalError('');
    setSelectedFile(file);
    if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
      setPreviewUrl(URL.createObjectURL(file));
    } else {
      setPreviewUrl(null);
    }
  };

  const saveSelection = async () => {
    if (!selectedFile) return;
    setLocalError('');
    const saved = await auth.updateAvatar(selectedFile);
    if (saved) clearSelection();
  };

  const restoreLogo = async () => {
    setLocalError('');
    await auth.removeAvatar();
  };

  const isSaving = auth.status === 'updating-avatar';
  const isRemoving = auth.status === 'removing-avatar';
  const isBusy = auth.isBusy;

  return (
    <section className="account-profile" aria-labelledby="username-title">
      <div className="account-profile__overview">
        <div className="account-profile__avatar">
          <UserAvatar user={auth.user} previewUrl={previewUrl} className="user-avatar--large" />
          <button
            type="button"
            className="account-profile__avatar-edit"
            onClick={() => inputRef.current?.click()}
            disabled={isBusy}
            aria-label="Edit profile picture"
            title="Edit profile picture"
          >
            <EditIcon />
          </button>
        </div>
        <div className="account-profile__copy">
          <h3 id="username-title">{auth.user.username}</h3>
          <p>{selectedFile ? `Previewing ${selectedFile.name}` : auth.user.avatarUpdatedAt ? 'Your uploaded picture is shown across Goraku Base.' : 'The Goraku Base logo is your default picture.'}</p>
          <span className="account-profile__help">JPG, PNG, or WebP · 2 MB maximum</span>
        </div>
      </div>
      <input
        ref={inputRef}
        className="visually-hidden"
        type="file"
        accept="image/jpeg,image/png,image/webp"
        onChange={handleFileChange}
        aria-label="Choose profile picture"
      />
      {selectedFile ? (
        <div className="account-profile__actions">
          <button type="button" className="search-action search-action--primary" onClick={saveSelection} disabled={isBusy}>
            {isSaving ? 'Saving photo…' : 'Save photo'}
          </button>
          <button type="button" className="search-action search-action--secondary" onClick={clearSelection} disabled={isBusy}>Cancel</button>
        </div>
      ) : auth.user.avatarUpdatedAt ? (
        <div className="account-profile__actions">
          <button type="button" className="search-action search-action--secondary" onClick={restoreLogo} disabled={isBusy}>
            {isRemoving ? 'Restoring logo…' : 'Use Goraku logo'}
          </button>
        </div>
      ) : null}
      {localError && <p className="form-error account-profile__error" role="alert">{localError}</p>}
      {isSaving && <p className="account-profile__status" aria-live="polite">Saving your profile picture…</p>}
      {isRemoving && <p className="account-profile__status" aria-live="polite">Restoring the Goraku logo…</p>}
    </section>
  );
}

function AuthPanel({ auth, mode, onModeChange, signInPrompt, resetToken, onClearResetToken }) {
  const [lastEmail, setLastEmail] = useState('');
  const [showPasswordReset, setShowPasswordReset] = useState(false);
  const [passwordResetSent, setPasswordResetSent] = useState(false);
  const [passwordResetComplete, setPasswordResetComplete] = useState(false);

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
        <h2 id="account-title" className="visually-hidden">Account</h2>
        {auth.error && <p className="form-error" role="alert">{formatApiError(auth.error, 'We could not complete that account action.')}</p>}
        <AccountProfileEditor auth={auth} />
        <div className="account-logout">
          <button type="button" className="search-action search-action--secondary" onClick={auth.logout} disabled={auth.isBusy}>
            {auth.status === 'logging-out' ? 'Signing out…' : 'Log out'}
          </button>
        </div>
      </section>
    );
  }

  const isLogin = mode === 'login';

  if (resetToken) {
    return (
      <section className="account-section" id="account" aria-labelledby="account-title">
        <h2 id="account-title" className="visually-hidden">Account</h2>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const password = new FormData(event.currentTarget).get('password');
            const reset = await auth.resetPassword(resetToken, password);
            if (reset) {
              setPasswordResetComplete(true);
              event.currentTarget.reset();
            }
          }}
        >
          <div className="auth-brand" aria-label="Goraku Base">
            <span className="auth-brand__mark"><img src="/mainIcon.svg" alt="" /></span>
            <span className="auth-brand__copy"><strong>GORAKU</strong><small>BASE</small></span>
          </div>
          <h3>Choose a new password</h3>
          {passwordResetComplete ? (
            <p className="auth-prompt" role="status">Your password was reset. You can now sign in.</p>
          ) : (
            <>
              <label className="search-form__label" htmlFor="auth-new-password">New password</label>
              <input id="auth-new-password" name="password" type="password" required autoComplete="new-password" />
              <p className="auth-form__help">Use 12–128 characters and at least one ASCII special character.</p>
              {auth.error && <p className="form-error" role="alert">{formatApiError(auth.error, 'Password reset could not be completed.')}</p>}
              <button type="submit" className="search-action search-action--primary" disabled={auth.isBusy}>
                {auth.isBusy ? 'Resetting…' : 'Reset password'}
              </button>
            </>
          )}
          <p className="auth-mode-prompt">
            <button type="button" className="auth-mode-link" onClick={() => { onClearResetToken(); onModeChange('login'); }}>Back to sign in</button>
          </p>
        </form>
      </section>
    );
  }

  if (showPasswordReset) {
    return (
      <section className="account-section" id="account" aria-labelledby="account-title">
        <h2 id="account-title" className="visually-hidden">Account</h2>
        <form
          className="auth-form"
          onSubmit={async (event) => {
            event.preventDefault();
            const email = new FormData(event.currentTarget).get('email');
            const sent = await auth.requestPasswordReset(email);
            if (sent) {
              setPasswordResetSent(true);
              event.currentTarget.reset();
            }
          }}
        >
          <div className="auth-brand" aria-label="Goraku Base">
            <span className="auth-brand__mark"><img src="/mainIcon.svg" alt="" /></span>
            <span className="auth-brand__copy"><strong>GORAKU</strong><small>BASE</small></span>
          </div>
          <h3>Reset your password</h3>
          {passwordResetSent ? (
            <p className="auth-prompt" role="status">If a verified account exists for that email, a reset link is on its way.</p>
          ) : (
            <>
              <label className="search-form__label" htmlFor="auth-reset-email">Email</label>
              <input id="auth-reset-email" name="email" type="email" required autoComplete="email" />
              {auth.error && <p className="form-error" role="alert">{formatApiError(auth.error, 'Password reset could not be requested.')}</p>}
              <button type="submit" className="search-action search-action--primary" disabled={auth.isBusy}>
                {auth.isBusy ? 'Sending…' : 'Send reset link'}
              </button>
            </>
          )}
          <p className="auth-mode-prompt">
            <button type="button" className="auth-mode-link" onClick={() => { setShowPasswordReset(false); setPasswordResetSent(false); setPasswordResetComplete(false); }}>
              Back to sign in
            </button>
          </p>
        </form>
      </section>
    );
  }

  return (
    <section className="account-section" id="account" aria-labelledby="account-title">
      <h2 id="account-title" className="visually-hidden">Account</h2>
      {signInPrompt && <p className="auth-prompt" aria-live="polite">{signInPrompt}</p>}
      {auth.status === 'error' && auth.error && (
        <p className="form-error" role="alert">{formatApiError(auth.error, 'Authentication is currently unavailable.')}</p>
      )}
      {auth.status === 'verification-required' && (
        <div className="auth-prompt" role="status">
          <p>Check your email to verify your account before signing in. In local development, the verification link is printed in the API server console.</p>
          <button type="button" className="auth-mode-link" onClick={() => auth.resendVerification(auth.verificationEmail)} disabled={auth.isBusy}>
            {auth.isBusy ? 'Resending…' : 'Resend verification email'}
          </button>
        </div>
      )}
      {auth.error?.code === 'EMAIL_NOT_VERIFIED' && lastEmail.includes('@') && (
        <div className="auth-prompt" role="status">
          <p>Verify your email address before signing in.</p>
          <button type="button" className="auth-mode-link" onClick={() => auth.resendVerification(lastEmail)} disabled={auth.isBusy}>
            {auth.isBusy ? 'Resending…' : 'Resend verification email'}
          </button>
        </div>
      )}
      <form
        className="auth-form"
        onSubmit={async (event) => {
          event.preventDefault();
          const formElement = event.currentTarget;
          const form = new FormData(formElement);
          const identifier = form.get('identifier');
          if (isLogin && typeof identifier === 'string' && identifier.includes('@')) setLastEmail(identifier);
          const authenticated = isLogin
            ? await auth.login({ identifier, password: form.get('password') })
            : await auth.register({ username: form.get('username'), email: form.get('email'), password: form.get('password') });
          if (authenticated) formElement.reset();
        }}
      >
        <div className="auth-brand" aria-label="Goraku Base">
          <span className="auth-brand__mark"><img src="/mainIcon.svg" alt="" /></span>
          <span className="auth-brand__copy"><strong>GORAKU</strong><small>BASE</small></span>
        </div>
        {!isLogin && (
          <>
            <label className="search-form__label" htmlFor="auth-username">Username</label>
            <input id="auth-username" name="username" type="text" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_]+" autoComplete="username" />
            <p className="auth-form__help">Use 3–32 letters, numbers, or underscores.</p>
          </>
        )}
        <label className="search-form__label" htmlFor={isLogin ? 'auth-identifier' : 'auth-email'}>{isLogin ? 'Email or username' : 'Email'}</label>
        <input
          id={isLogin ? 'auth-identifier' : 'auth-email'}
          name={isLogin ? 'identifier' : 'email'}
          type={isLogin ? 'text' : 'email'}
          required
          autoComplete={isLogin ? 'username' : 'email'}
        />
        <label className="search-form__label" htmlFor="auth-password">Password</label>
        <input id="auth-password" name="password" type="password" required autoComplete={isLogin ? 'current-password' : 'new-password'} />
        {!isLogin && <p className="auth-form__help">Use 12–128 characters and at least one ASCII special character.</p>}
        {auth.error && auth.status !== 'error' && (
          <p className="form-error" role="alert">{formatApiError(auth.error, isLogin ? 'Sign in could not be completed.' : 'Registration could not be completed.')}</p>
        )}
        {isLogin && (
          <button type="button" className="auth-mode-link auth-form__reset" onClick={() => { setShowPasswordReset(true); setPasswordResetSent(false); }}>
            Forgot password?
          </button>
        )}
        <button type="submit" className="search-action search-action--primary" disabled={auth.isBusy}>
          {auth.isBusy ? (isLogin ? 'Signing in…' : 'Registering…') : isLogin ? 'Sign in' : 'Register'}
        </button>
        <p className="auth-mode-prompt">
          {isLogin ? "Don't have an account?" : 'Already have an account?'}{' '}
          <button type="button" className="auth-mode-link" onClick={() => onModeChange(isLogin ? 'register' : 'login')}>
            {isLogin ? 'Sign up' : 'Sign in'}
          </button>
        </p>
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

function PersonalRating({ item, library }) {
  const rating = item.personalRating;
  const busy = library.isActionBusy(item.id, 'personalRating');
  const valueLabel = rating === null ? 'Unrated on a 0–10 scale.' : `${rating} out of 10.`;

  return (
    <fieldset className="tracking-editor rating-editor" disabled={busy}>
      <legend>Personal Rating</legend>
      <div className="rating-row">
        <button
          type="button"
          className="text-action rating-zero"
          aria-pressed={rating === 0}
          onClick={() => library.update(item.id, { personalRating: 0 }, { actionKey: 'personalRating' })}
        >
          Reset
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
      <label htmlFor={`library-note-${item.id}`}>Note</label>
      <textarea
        id={`library-note-${item.id}`}
        value={note}
        onChange={(event) => {
          if ([...event.target.value].length <= 5000) setNote(event.target.value);
        }}
        aria-describedby={`library-note-help-${item.id}`}
        disabled={busy}
        rows={4}
        placeholder="Write a note..."
      />
      <div className="editor-meta" id={`library-note-help-${item.id}`}>
        <span aria-live="polite">{noteLength} / 5,000 characters</span>
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

function ProgressEditor({ item, library }) {
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
      <div className="editor-label">Progress</div>
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

function RelationshipEditor({ kind, item, library, taxonomy }) {
  const isTag = kind === 'tag';
  const field = isTag ? 'tags' : 'collections';
  const resources = taxonomy[`${field}`];
  const title = isTag ? 'Tags' : 'Collections';

  return (
    <fieldset className="tracking-editor relationship-editor" disabled={taxonomy.status !== 'success'}>
      <legend>{title}</legend>
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

function LibraryItem({ item, user, library, taxonomy, mediaEntry, onRetryArtwork, onRequestArtwork, onRequestSignIn }) {
  const [imageFailed, setImageFailed] = useState(false);
  const [isTrackingOpen, setTrackingOpen] = useState(false);
  const cardRef = useRef(null);
  const media = mediaEntry?.media;
  const trackingSupported = (item.type === 'TV' && item.provider === 'tmdb') ||
    (item.type === 'ANIME' && ['anilist', 'myanimelist'].includes(item.provider));
  const trackingMedia = trackingSupported && !media
    ? { provider: item.provider, providerId: item.providerId, type: item.type, metadata: {} }
    : media;
  const title = media?.title || item.providerId;
  useEffect(() => setImageFailed(false), [media?.image]);
  const label = libraryItemLabel(item);
  const itemError = library.getItemError(item.id);
  const isRemoving = library.isActionBusy(item.id, 'remove');

  useEffect(() => {
    if (!onRequestArtwork) return undefined;
    if (typeof IntersectionObserver === 'undefined') {
      onRequestArtwork(item);
      return undefined;
    }
    const observer = new IntersectionObserver((observerEntries) => {
      if (!observerEntries.some((entry) => entry.isIntersecting)) return;
      onRequestArtwork(item);
      observer.disconnect();
    }, { rootMargin: '240px 0px' });
    if (cardRef.current) observer.observe(cardRef.current);
    return () => observer.disconnect();
  }, [item, onRequestArtwork]);

  return (
    <li ref={cardRef} className="library-item" aria-busy={library.isItemBusy(item.id)}>
      <div className="library-item__identity">
        <p className="section-index">{getMediaTypeLabel(item.type.toLowerCase())}</p>
        <div className="library-cover">
          {media?.image && !imageFailed
            ? <img src={media.image} alt={`${title} cover`} loading="lazy" onError={() => setImageFailed(true)} />
            : <span>{mediaEntry?.status === 'error' || mediaEntry?.status === 'success' ? 'Cover unavailable' : 'Loading cover…'}</span>}
        </div>
        <h3>{title}</h3>
        <p>{formatLibraryStatus(item.libraryStatus)}{item.favorite ? ' · Favorite' : ''}</p>
        {mediaEntry?.status === 'error' && <button type="button" className="text-action" onClick={onRetryArtwork}>Retry artwork for {label}</button>}
      </div>
      <details className="library-edit" onToggle={(event) => setTrackingOpen(event.currentTarget.open)}>
        <summary>Edit tracking</summary>
      <div className="library-item__controls">
        <label htmlFor={`library-status-${item.id}`}>Library Status</label>
        <select
          id={`library-status-${item.id}`}
          aria-label={`Library Status for ${label}`}
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
        <PersonalRating item={item} library={library} />
        <ProgressEditor item={item} library={library} />
        {isTrackingOpen && (
          <EpisodeTrackingSection
            media={trackingMedia}
            user={user}
            library={library}
            libraryItem={item}
            onRequestSignIn={onRequestSignIn}
          />
        )}
        <NoteEditor item={item} library={library} label={label} />
        <RelationshipEditor kind="tag" item={item} library={library} taxonomy={taxonomy} />
        <RelationshipEditor kind="collection" item={item} library={library} taxonomy={taxonomy} />
        {itemError && <p className="form-error" role="alert">{formatApiError(itemError, 'This Library Item action was rejected by the server.')}</p>}
        <button
          type="button"
          className="search-action search-action--secondary"
          onClick={() => library.remove(item.id)}
          disabled={isRemoving}
        >
          {isRemoving ? 'Removing…' : `Remove ${title}`}
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
          <h3>Filter</h3>
        </div>
        <p>Filters stay applied while you load more Library Items.</p>
      </div>
      <div className="library-filters__fields">
        <label htmlFor="library-filter-status">
          Library Status
          <select id="library-filter-status" value={draft.libraryStatus} onChange={(event) => setDraft((current) => ({ ...current, libraryStatus: event.target.value }))}>
            <option value="">All Status</option>
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
          <button type="submit" className="text-action taxonomy-resource__action" disabled={busy}>{busy ? 'Saving…' : 'Rename'}</button>
        </div>
      </form>
      <button
        type="button"
        className="text-action text-action--danger taxonomy-resource__action"
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
        <label className="visually-hidden" htmlFor={`new-${kind}`}>New {singular.toLowerCase()} name</label>
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
      <h2 id="library-title" className="visually-hidden">My Library</h2>

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
          {library.results.map((item) => <LibraryItem item={item} user={auth.user} library={library} taxonomy={taxonomy} key={item.id} mediaEntry={artwork.entries[mediaIdentity(item)]} onRetryArtwork={() => artwork.retry(item)} onRequestArtwork={artwork.request} onRequestSignIn={onRequestSignIn} />)}
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
  const [authMode, setAuthMode] = useState('login');
  const [signInPrompt, setSignInPrompt] = useState('');
  const [theme, setTheme] = useState(getInitialTheme);
  const [view, setView] = useState('discover');
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.search).get('resetToken') ?? '');
  const mainRef = useRef(null);
  const themeTransitionRef = useRef(null);
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

  useEffect(() => () => {
    if (themeTransitionRef.current) window.clearTimeout(themeTransitionRef.current);
    document.documentElement.classList.remove('theme-transition');
    document.documentElement.style.removeProperty('--theme-transition-x');
    document.documentElement.style.removeProperty('--theme-transition-y');
  }, []);

  const toggleTheme = (event) => {
    const root = document.documentElement;
    if (themeTransitionRef.current) window.clearTimeout(themeTransitionRef.current);
    themeTransitionRef.current = null;
    const button = event?.currentTarget;
    const buttonRect = button?.getBoundingClientRect?.();
    if (buttonRect) {
      root.style.setProperty('--theme-transition-x', `${buttonRect.left + buttonRect.width / 2}px`);
      root.style.setProperty('--theme-transition-y', `${buttonRect.top + buttonRect.height / 2}px`);
    }
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    if (typeof document.startViewTransition === 'function') {
      const transition = document.startViewTransition(() => setTheme(nextTheme));
      const cleanup = () => {
        root.style.removeProperty('--theme-transition-x');
        root.style.removeProperty('--theme-transition-y');
      };
      if (transition?.finished?.then) transition.finished.then(cleanup, cleanup);
      else window.setTimeout(cleanup, 560);
      return;
    }
    root.classList.add('theme-transition');
    themeTransitionRef.current = window.setTimeout(() => {
      root.classList.remove('theme-transition');
      themeTransitionRef.current = null;
    }, 220);
    setTheme(nextTheme);
  };

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
  const [saveTarget, setSaveTarget] = useState(null);
  const closeSaveTarget = useCallback(() => setSaveTarget(null), []);
  const saveMediaToDestination = async (media, destination) => {
    const item = await library.save(media);
    if (!item) return null;
    artwork.remember(media);
    const destinations = Array.isArray(destination) ? destination : destination ? [destination] : [];
    let attached = true;
    for (const target of destinations) {
      if (!await library.attach(item.id, target.kind, target.resource)) attached = false;
    }
    return { item, attached };
  };
  const saveMedia = async (media) => {
    const hasDestinations = taxonomy.status === 'success' && (taxonomy.tags.length > 0 || taxonomy.collections.length > 0);
    if (hasDestinations) {
      setSaveTarget(media);
      return null;
    }
    return saveMediaToDestination(media, null);
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
  const openAuth = (mode) => {
    setSignInPrompt('');
    if (mode !== 'account') setAuthMode(mode);
    navigate('account');
  };
  const clearResetToken = () => {
    setResetToken('');
    const url = new URL(window.location.href);
    url.searchParams.delete('resetToken');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  };

  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <aside className="sidebar" aria-label="Primary navigation">
        <button type="button" className="wordmark" onClick={() => navigate('discover')} aria-label="Goraku Base home">
          <span className="wordmark__mark"><img src="/mainIcon.svg" alt="" /></span>
          <span className="wordmark__copy"><strong>GORAKU</strong><small>BASE</small></span>
        </button>
        <nav className="sidebar-nav" aria-label="Primary">
          {[['discover', 'Discover', HomeIcon], ['search', 'Search', SearchIcon], ['library', 'My Library', LibraryIcon], ['account', 'Account', UserIcon]].map(([key, label, Icon]) => (
            <button key={key} type="button" className={`sidebar-nav__link${view === key ? ' sidebar-nav__link--active' : ''}`} aria-current={view === key ? 'page' : undefined} aria-label={label} title={label} onClick={() => navigate(key)}><Icon /><span>{label}</span></button>
          ))}
        </nav>
        <div className="sidebar__bottom">
          {auth.user ? (
            <button type="button" className="sidebar-account" onClick={() => openAuth('account')} title="Open account">
              <UserAvatar user={auth.user} className="sidebar-account__avatar" />
              <span><strong>{auth.user.username}</strong><small>Account</small></span>
            </button>
          ) : (
            <button type="button" className="sidebar-signup" onClick={() => openAuth('register')}>
              <span><strong>Sign up</strong></span>
              <ArrowIcon />
            </button>
          )}
        </div>
      </aside>

      <div className="app-main">
        <header className="topbar">
          <strong className="view-title">{{ discover: 'Discover', search: 'Search', library: 'My Library', account: 'Account' }[view]}</strong>
          <div className="topbar__actions">
            <AuthActions user={auth.user} onOpenAuth={openAuth} />
            <ThemeToggle theme={theme} onToggle={toggleTheme} />
          </div>
        </header>

      <main id="main-content" ref={mainRef} tabIndex={-1}>
        {signInPrompt && view !== 'account' && <p className="auth-prompt" role="status">{signInPrompt} Select Account in the sidebar.</p>}
        <div hidden={view !== 'discover'}>
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
        <AuthPanel auth={auth} mode={authMode} onModeChange={(nextMode) => { setAuthMode(nextMode); setSignInPrompt(''); }} signInPrompt={signInPrompt} resetToken={resetToken} onClearResetToken={clearResetToken} />

        </div>
      </main>
      <SaveDestinationDialog media={saveTarget} taxonomy={taxonomy} onSave={saveMediaToDestination} onClose={closeSaveTarget} />
      </div>
    </div>
  );
}
