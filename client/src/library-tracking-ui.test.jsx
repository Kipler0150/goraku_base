import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView, openTracking } from './test-navigation.js';

const USER = { id: 'user-1', username: 'reader', email: 'reader@example.com' };
const IDS = {
  movie: '00000000-0000-4000-8000-000000000001',
  anime: '00000000-0000-4000-8000-000000000002',
  tv: '00000000-0000-4000-8000-000000000003',
  game: '00000000-0000-4000-8000-000000000004'
};

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function emptyResponse() {
  return response({ results: [], pagination: { page: 1, perPage: 50, hasMore: false } });
}

function item({ id, type, provider, providerId, libraryStatus = 'PLANNING', favorite = false, personalRating = null, note = null, progress = null, tags = [], collections = [] }) {
  return {
    id,
    provider,
    type,
    providerId,
    libraryStatus,
    favorite,
    personalRating,
    note,
    progress,
    tags,
    collections,
    createdAt: '2026-09-10T00:00:00.000Z',
    updatedAt: '2026-09-10T00:00:00.000Z'
  };
}

const MOVIE = item({ id: IDS.movie, type: 'MOVIE', provider: 'tmdb', providerId: '42' });
const ANIME = item({ id: IDS.anime, type: 'ANIME', provider: 'anilist', providerId: '86' });
const TV = item({ id: IDS.tv, type: 'TV', provider: 'tmdb', providerId: '100' });
const GAME = item({ id: IDS.game, type: 'GAME', provider: 'rawg', providerId: '200' });

function installBaseFetch({
  libraryItems = [MOVIE],
  tags = [],
  collections = [],
  onLibraryList,
  libraryListResponse,
  libraryCreateResponse,
  onLibraryPatch,
  libraryPatchResponse,
  mediaDetailsResponse,
  mediaEpisodesResponse,
  watchedEpisodesResponse,
  watchedEpisodesUpdateResponse,
  searchResponse,
  taxonomyListResponse,
  onTaxonomyRequest
} = {}) {
  let currentItems = [...libraryItems];
  let currentTags = [...tags];
  let currentCollections = [...collections];
  const fetchMock = vi.fn((url, options = {}) => {
    if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
    if (url === '/api/auth/me') return Promise.resolve(response(USER));
    if (url.startsWith('/api/library?') && options.method === 'GET') {
      if (libraryListResponse) return Promise.resolve(libraryListResponse(url));
      const payload = onLibraryList?.(new URLSearchParams(url.split('?')[1]), currentItems) ?? {
        results: currentItems,
        pagination: { page: 1, perPage: 20, hasMore: false }
      };
      return Promise.resolve(response(payload));
    }
    if (url.startsWith('/api/library/') && options.method === 'PATCH') {
      const id = url.split('/').at(-1);
      const changes = JSON.parse(options.body);
      if (libraryPatchResponse) return Promise.resolve(libraryPatchResponse(id, changes));
      const existing = currentItems.find((entry) => entry.id === id);
      const patched = onLibraryPatch?.(existing, changes);
      if (patched?.then) return patched.then((updated) => { currentItems = currentItems.map((entry) => entry.id === id ? updated : entry); return response(updated); });
      const updated = patched ?? { ...existing, ...changes };
      currentItems = currentItems.map((entry) => entry.id === id ? updated : entry);
      return Promise.resolve(response(updated));
    }
    if (url.startsWith('/api/library/') && url.endsWith('/episodes') && options.method === 'GET') {
      return Promise.resolve(watchedEpisodesResponse?.(url) ?? response({ watched: [] }));
    }
    if (url.startsWith('/api/library/') && url.endsWith('/episodes') && options.method === 'PUT') {
      return Promise.resolve(watchedEpisodesUpdateResponse?.(url, JSON.parse(options.body)) ?? response({ watched: [] }));
    }
    if (url === '/api/library' && options.method === 'POST' && libraryCreateResponse) {
      return Promise.resolve(libraryCreateResponse(JSON.parse(options.body)));
    }
    if (url.includes('/episodes?') && mediaEpisodesResponse) return Promise.resolve(mediaEpisodesResponse(url));
    if (url.startsWith('/api/media/') && mediaDetailsResponse) return Promise.resolve(mediaDetailsResponse(url));
    if (url.startsWith('/api/media/search?') && searchResponse) return Promise.resolve(searchResponse(url));
    if (url.startsWith('/api/tags?') && options.method === 'GET') {
      return Promise.resolve(taxonomyListResponse?.('tag', new URL(url, 'http://localhost')) ?? response({ results: currentTags, pagination: { page: 1, perPage: 50, hasMore: false } }));
    }
    if (url.startsWith('/api/collections?') && options.method === 'GET') {
      return Promise.resolve(taxonomyListResponse?.('collection', new URL(url, 'http://localhost')) ?? response({ results: currentCollections, pagination: { page: 1, perPage: 50, hasMore: false } }));
    }
    if (url === '/api/tags' && options.method === 'POST') return Promise.resolve(onTaxonomyRequest?.('createTag', JSON.parse(options.body)) ?? emptyResponse());
    if (url === '/api/collections' && options.method === 'POST') return Promise.resolve(onTaxonomyRequest?.('createCollection', JSON.parse(options.body)) ?? emptyResponse());
    if (url.startsWith('/api/tags/') && options.method === 'PATCH') return Promise.resolve(onTaxonomyRequest?.('updateTag', JSON.parse(options.body), url.split('/').at(-1)) ?? emptyResponse());
    if (url.startsWith('/api/collections/') && options.method === 'PATCH') return Promise.resolve(onTaxonomyRequest?.('updateCollection', JSON.parse(options.body), url.split('/').at(-1)) ?? emptyResponse());
    if (url.startsWith('/api/tags/') && options.method === 'DELETE') return Promise.resolve(onTaxonomyRequest?.('removeTag', null, url.split('/').at(-1)) ?? { ok: true, status: 204, json: async () => null });
    if (url.startsWith('/api/collections/') && options.method === 'DELETE') return Promise.resolve(onTaxonomyRequest?.('removeCollection', null, url.split('/').at(-1)) ?? { ok: true, status: 204, json: async () => null });
    if (url.includes('/tags/') && (options.method === 'PUT' || options.method === 'DELETE')) return Promise.resolve(onTaxonomyRequest?.(options.method === 'PUT' ? 'attachTag' : 'detachTag', null, url) ?? { ok: true, status: 204, json: async () => null });
    if (url.includes('/collections/') && (options.method === 'PUT' || options.method === 'DELETE')) return Promise.resolve(onTaxonomyRequest?.(options.method === 'PUT' ? 'attachCollection' : 'detachCollection', null, url) ?? { ok: true, status: 204, json: async () => null });
    return Promise.resolve(response({ results: [], source: 'tmdb', pagination: { page: 1, perPage: 12, hasMore: false }, providerErrors: [] }));
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('authenticated Library tracking UI', () => {
  it('renders type-specific Progress editors and confirms rating, Note, and Progress updates', async () => {
    const fetchMock = installBaseFetch({ libraryItems: [MOVIE, ANIME, TV, GAME] });
    render(<App />);
    selectView('My Library');

    await screen.findByRole('heading', { name: '42' });
    openTracking();
    expect(await screen.findByLabelText('Episodes watched')).toBeInTheDocument();
    expect(screen.getByLabelText('Season')).toBeInTheDocument();
    expect(screen.getByLabelText('Episode')).toBeInTheDocument();
    expect(screen.getByLabelText('Watched')).toBeInTheDocument();
    expect(screen.getByLabelText('Hours played')).toBeInTheDocument();
    expect(screen.queryByText('Unrated on a 0–10 scale.')).not.toBeInTheDocument();

    const movieItem = screen.getByRole('heading', { name: '42' }).closest('li');
    const animeEpisodes = screen.getByLabelText('Episodes watched');
    fireEvent.change(animeEpisodes, { target: { value: '0' } });
    fireEvent.submit(animeEpisodes.closest('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.anime}`, expect.objectContaining({ body: JSON.stringify({ progress: { episodesWatched: 0 } }) })));
    const tvSeason = screen.getByLabelText('Season');
    const tvEpisode = screen.getByLabelText('Episode');
    fireEvent.change(tvSeason, { target: { value: '2' } });
    fireEvent.change(tvEpisode, { target: { value: '3' } });
    fireEvent.submit(tvSeason.closest('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.tv}`, expect.objectContaining({ body: JSON.stringify({ progress: { season: 2, episode: 3 } }) })));
    const watched = screen.getByLabelText('Watched');
    fireEvent.click(watched);
    fireEvent.submit(watched.closest('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ progress: { watched: true } }) })));
    fireEvent.change(screen.getByLabelText('Episodes watched'), { target: { value: '' } });
    fireEvent.submit(screen.getByLabelText('Episodes watched').closest('form'));
    expect(within(animeEpisodes.closest('form')).getByRole('alert')).toHaveTextContent('Enter a valid progress value before saving.');
    fireEvent.click(within(movieItem).getByRole('button', { name: 'Rate 7 out of 10' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ personalRating: 7 }) })));
    await waitFor(() => expect(screen.getByRole('group', { name: 'Personal rating, 7 out of 10.' })).toBeInTheDocument());
    fireEvent.click(within(movieItem).getByRole('button', { name: 'Reset' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ personalRating: 0 }) })));
    fireEvent.click(within(movieItem).getByRole('button', { name: 'Clear rating / mark unrated' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ personalRating: null }) })));

    const movieNote = within(movieItem).getByLabelText('Note');
    fireEvent.change(movieNote, { target: { value: 'Keep the commentary cut.' } });
    fireEvent.submit(movieNote.closest('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ note: 'Keep the commentary cut.' }) })));
    fireEvent.click(within(movieItem).getByRole('button', { name: 'Clear note' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ note: null }) })));

    const gameHours = screen.getByLabelText('Hours played');
    fireEvent.change(gameHours, { target: { value: '12.5' } });
    fireEvent.submit(gameHours.closest('form'));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.game}`, expect.objectContaining({ body: JSON.stringify({ progress: { hoursPlayed: 12.5 } }) })));
    const gameItem = screen.getByRole('heading', { name: '200' }).closest('li');
    fireEvent.click(within(gameItem).getByRole('button', { name: 'Clear progress' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.game}`, expect.objectContaining({ body: JSON.stringify({ progress: null }) })));
  });

  it('renders TV episode tracking inside the Library Item editor and persists watched changes', async () => {
    const tvDetails = {
      provider: 'tmdb',
      providerId: TV.providerId,
      type: 'TV',
      id: `tmdb:TV:${TV.providerId}`,
      title: 'Game of Thrones',
      originalTitle: null,
      alternativeTitles: [],
      description: 'A normalized description.',
      image: null,
      bannerImage: null,
      releaseDate: { year: 2011, month: 4, day: 17 },
      genres: ['Drama'],
      providerRating: { value: 9, max: 10, normalized: 9 },
      releaseStatus: 'RELEASED',
      creators: [],
      isAdult: false,
      metadata: { seasonCount: 2, episodeCount: 20 }
    };
    const episodePayload = {
      provider: 'tmdb',
      providerId: TV.providerId,
      type: 'TV',
      season: 1,
      episodes: [
        { number: 1, title: 'Winter Is Coming', airDate: { year: 2011, month: 4, day: 17 }, runtimeMinutes: 62, image: null },
        { number: 2, title: 'The Kingsroad', airDate: { year: 2011, month: 4, day: 24 }, runtimeMinutes: 56, image: null }
      ]
    };
    const fetchMock = installBaseFetch({
      libraryItems: [TV],
      mediaDetailsResponse: (url) => url.startsWith('/api/media/tmdb/tv/100?') ? response(tvDetails) : response({}),
      mediaEpisodesResponse: () => response(episodePayload),
      watchedEpisodesResponse: () => response({ watched: [{ season: 1, episode: 1 }] }),
      watchedEpisodesUpdateResponse: () => response({ watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] })
    });
    render(<App />);
    selectView('My Library');

    const itemCard = (await screen.findByRole('heading', { name: 'Game of Thrones' })).closest('li');
    fireEvent.click(within(itemCard).getByText('Edit tracking'));
    const episodeSection = await within(itemCard).findByRole('region', { name: 'Episodes' });
    expect(await within(episodeSection).findByText('1 of 2 watched')).toBeInTheDocument();
    expect(within(episodeSection).getByText('Episode 1: Winter Is Coming')).toBeInTheDocument();
    expect(within(episodeSection).getByText('Episode 2: The Kingsroad')).toBeInTheDocument();

    const episodeCheckboxes = within(episodeSection).getAllByRole('checkbox');
    fireEvent.click(episodeCheckboxes[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.tv}/episodes`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ episodes: [{ season: 1, episode: 2, watched: true }] })
    })));
    expect(await within(episodeSection).findByText('2 of 2 watched')).toBeInTheDocument();
  });

  it('renders AniList-backed anime episode tracking for MyAnimeList library items', async () => {
    const animeItem = item({ id: IDS.anime, type: 'ANIME', provider: 'myanimelist', providerId: '1535' });
    const animeDetails = {
      provider: 'myanimelist',
      providerId: animeItem.providerId,
      type: 'ANIME',
      id: 'myanimelist:ANIME:1535',
      title: 'Death Note',
      originalTitle: null,
      alternativeTitles: [],
      description: 'A normalized anime description.',
      image: null,
      bannerImage: null,
      releaseDate: { year: 2006, month: 10, day: 4 },
      genres: ['Mystery'],
      providerRating: { value: 87, max: 100, normalized: 8.7 },
      releaseStatus: 'RELEASED',
      creators: [],
      isAdult: false,
      metadata: { episodeCount: 2, episodeDurationMinutes: 23 }
    };
    const episodePayload = {
      provider: 'myanimelist',
      providerId: animeItem.providerId,
      type: 'ANIME',
      season: 1,
      episodes: [
        { number: 1, title: 'Episode 1', airDate: null, runtimeMinutes: null, image: null },
        { number: 2, title: 'Episode 2', airDate: null, runtimeMinutes: null, image: null }
      ]
    };
    const fetchMock = installBaseFetch({
      libraryItems: [animeItem],
      mediaDetailsResponse: (url) => url.startsWith('/api/media/myanimelist/anime/1535?') ? response(animeDetails) : response({}),
      mediaEpisodesResponse: () => response(episodePayload),
      watchedEpisodesResponse: () => response({ watched: [{ season: 1, episode: 1 }] }),
      watchedEpisodesUpdateResponse: () => response({ watched: [{ season: 1, episode: 1 }, { season: 1, episode: 2 }] })
    });
    render(<App />);
    selectView('My Library');

    const itemCard = (await screen.findByRole('heading', { name: 'Death Note' })).closest('li');
    fireEvent.click(within(itemCard).getByText('Edit tracking'));
    const episodeSection = await within(itemCard).findByRole('region', { name: 'Episodes' });
    expect(await within(episodeSection).findByText('1 of 2 watched')).toBeInTheDocument();
    expect(within(episodeSection).getByText('Episode 1', { exact: true })).toBeInTheDocument();
    expect(within(episodeSection).getByText('Episode 2', { exact: true })).toBeInTheDocument();
    expect(within(episodeSection).queryByText('Air date unavailable')).not.toBeInTheDocument();
    expect(within(episodeSection).queryByText('Episode 1: Episode 1')).not.toBeInTheDocument();

    fireEvent.click(within(episodeSection).getAllByRole('checkbox')[1]);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.anime}/episodes`, expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ episodes: [{ season: 1, episode: 2, watched: true }] })
    })));
    expect(await within(episodeSection).findByText('2 of 2 watched')).toBeInTheDocument();
  });

  it('creates, renames, attaches, detaches, and deletes Tags and Collections', async () => {
    const tag = { id: '00000000-0000-4000-8000-000000000010', name: 'Favorites', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    const collection = { id: '00000000-0000-4000-8000-000000000011', name: 'Weekend queue', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    const fetchMock = installBaseFetch({
      tags: [],
      collections: [],
      onTaxonomyRequest: (operation, body, id) => {
        if (operation === 'createTag') return response(tag, 201);
        if (operation === 'createCollection') return response(collection, 201);
        if (operation === 'updateTag') return response({ ...tag, name: body.name });
        if (operation === 'updateCollection') return response({ ...collection, name: body.name });
        return { ok: true, status: 204, json: async () => null };
      }
    });
    render(<App />);
    selectView('My Library');

    fireEvent.click(await screen.findByText('Organize Tags & Collections'));
    await screen.findByRole('heading', { name: '42' });
    openTracking();
    const tagInput = await screen.findByLabelText('New tag name');
    fireEvent.change(tagInput, { target: { value: 'Favorites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Tag' }));
    expect(await screen.findByRole('checkbox', { name: 'Favorites' })).toBeInTheDocument();

    const collectionInput = screen.getByLabelText('New collection name');
    fireEvent.change(collectionInput, { target: { value: 'Weekend queue' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Collection' }));
    expect(await screen.findByDisplayValue('Weekend queue')).toBeInTheDocument();

    const tagName = screen.getByLabelText('Tag name');
    fireEvent.change(tagName, { target: { value: 'Keepers' } });
    fireEvent.click(within(tagName.closest('form')).getByRole('button', { name: 'Rename' }));
    expect(await screen.findByDisplayValue('Keepers')).toBeInTheDocument();
    expect(within(tagName.closest('form')).getByRole('button', { name: 'Rename' })).toHaveClass('taxonomy-resource__action');
    expect(screen.getByRole('button', { name: 'Delete tag Keepers' })).toHaveClass('taxonomy-resource__action');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Keepers' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}/tags/${tag.id}`, expect.objectContaining({ method: 'PUT' })));
    fireEvent.click(screen.getByRole('checkbox', { name: 'Keepers' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library/${IDS.movie}/tags/${tag.id}`, expect.objectContaining({ method: 'DELETE' })));

    fireEvent.click(screen.getByRole('button', { name: 'Delete collection Weekend queue' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/collections/${collection.id}`, expect.objectContaining({ method: 'DELETE' })));
    await waitFor(() => expect(screen.queryByDisplayValue('Weekend queue')).not.toBeInTheDocument());
  });

  it('loads additional private Tags and Collections pages on demand', async () => {
    const firstTag = { id: '00000000-0000-4000-8000-000000000010', name: 'First tag', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    const secondTag = { id: '00000000-0000-4000-8000-000000000012', name: 'Second tag', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    installBaseFetch({
      tags: [firstTag],
      taxonomyListResponse: (kind, url) => {
        if (kind === 'tag' && url.searchParams.get('page') === '1') return response({ results: [firstTag], pagination: { page: 1, perPage: 50, hasMore: true } });
        if (kind === 'tag') return response({ results: [secondTag], pagination: { page: 2, perPage: 50, hasMore: false } });
        return response({ results: [], pagination: { page: 1, perPage: 50, hasMore: false } });
      }
    });
    render(<App />);
    selectView('My Library');

    fireEvent.click(await screen.findByText('Organize Tags & Collections'));
    expect(await screen.findByDisplayValue('First tag')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more Tags' }));
    expect(await screen.findByDisplayValue('Second tag')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more Tags' })).not.toBeInTheDocument();
  });

  it('preserves filters while loading another page and reports server conflicts without local success', async () => {
    const second = item({ id: '00000000-0000-4000-8000-000000000005', type: 'MOVIE', provider: 'tmdb', providerId: '43', favorite: true });
    const tag = { id: '00000000-0000-4000-8000-000000000010', name: 'Favorites', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    const collection = { id: '00000000-0000-4000-8000-000000000011', name: 'Weekend queue', createdAt: '2026-09-10T00:00:00.000Z', updatedAt: '2026-09-10T00:00:00.000Z' };
    const filteredMovie = item({ id: IDS.movie, type: 'MOVIE', provider: 'tmdb', providerId: '42', libraryStatus: 'COMPLETED', favorite: true, tags: [tag], collections: [collection] });
    const fetchMock = installBaseFetch({
      libraryItems: [filteredMovie],
      tags: [tag],
      collections: [collection],
      onLibraryList: (params) => params.get('page') === '1'
        ? { results: [filteredMovie], pagination: { page: 1, perPage: 20, hasMore: true } }
        : { results: [second], pagination: { page: 2, perPage: 20, hasMore: false } },
      onTaxonomyRequest: (operation) => operation === 'createTag'
        ? response({ error: { code: 'CONFLICT', message: 'The Tag name is already in use.', details: [] } }, 409)
        : { ok: true, status: 204, json: async () => null }
    });
    render(<App />);
    selectView('My Library');

    await screen.findByRole('heading', { name: '42' });
    await screen.findByRole('option', { name: 'Favorites' });
    await screen.findByRole('option', { name: 'Weekend queue' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Library Status', exact: true }), { target: { value: 'COMPLETED' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Favorite', exact: true }), { target: { value: 'true' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Tag', exact: true }), { target: { value: tag.id } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Collection', exact: true }), { target: { value: collection.id } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply filters' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library?page=1&perPage=20&libraryStatus=completed&favorite=true&tagId=${tag.id}&collectionId=${collection.id}`, expect.anything()));
    fireEvent.click(screen.getByRole('button', { name: 'Load more Library Items' }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(`/api/library?page=2&perPage=20&libraryStatus=completed&favorite=true&tagId=${tag.id}&collectionId=${collection.id}`, expect.anything()));
    expect(await screen.findByRole('heading', { name: '43' })).toBeInTheDocument();

    fireEvent.click(await screen.findByText('Organize Tags & Collections'));
    openTracking();
    const tagInput = screen.getByLabelText('New tag name');
    fireEvent.change(tagInput, { target: { value: 'Favorites' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create Tag' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Tag name is already in use.');
  });

  it('keeps item controls server-confirmed and scoped while a mutation is pending', async () => {
    let resolvePatch;
    installBaseFetch({
      onLibraryPatch: (existing, changes) => new Promise((resolve) => {
        resolvePatch = () => resolve({ ...existing, ...changes });
      })
    });
    render(<App />);
    selectView('My Library');

    await screen.findByRole('heading', { name: '42' });
    openTracking();
    const status = await screen.findByLabelText('Library Status for TMDB movie 42');
    const favorite = screen.getByRole('checkbox', { name: 'Favorite TMDB movie 42' });
    fireEvent.change(status, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(status).toBeDisabled());
    expect(favorite).not.toBeDisabled();
    expect(status).toHaveValue('PLANNING');
    resolvePatch();
    await waitFor(() => expect(status).toHaveValue('COMPLETED'));
  });

  it('keeps private error states actionable for Library, taxonomy, and scalar mutations', async () => {
    const fetchMock = installBaseFetch({
      libraryListResponse: () => response({ error: { code: 'UNAVAILABLE', message: 'Library storage is unavailable.', details: [] } }, 503),
      taxonomyListResponse: (kind) => response({ error: { code: 'UNAVAILABLE', message: `${kind} storage is unavailable.`, details: [] } }, 503)
    });
    render(<App />);
    selectView('My Library');

    expect(await screen.findByText('The library signal did not come through.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry library' })).toBeInTheDocument();
    fireEvent.click(await screen.findByText('Organize Tags & Collections'));
    expect(await screen.findByText('Relationships did not come through.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Tags and Collections' })).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalled();

    cleanup();
    vi.restoreAllMocks();
    const mutationFetch = installBaseFetch({
      libraryPatchResponse: () => response({ error: { code: 'CONFLICT', message: 'Library item changed elsewhere.', details: [] } }, 409)
    });
    render(<App />);
    selectView('My Library');
    await screen.findByRole('heading', { name: '42' });
    openTracking();
    const status = await screen.findByLabelText('Library Status for TMDB movie 42');
    fireEvent.change(status, { target: { value: 'COMPLETED' } });
    expect(await screen.findAllByText('Library item changed elsewhere.')).not.toHaveLength(0);
    expect(status).toHaveValue('PLANNING');
    expect(mutationFetch).toHaveBeenCalledWith(`/api/library/${IDS.movie}`, expect.objectContaining({ body: JSON.stringify({ libraryStatus: 'COMPLETED' }) }));
  });

  it('reconciles a duplicate Save conflict as a detected saved state', async () => {
    const media = {
      provider: 'tmdb',
      type: 'MOVIE',
      providerId: '42',
      title: 'Already saved',
      image: null,
      releaseDate: {},
      releaseStatus: 'RELEASED',
      providerRating: null,
      metadata: { runtimeMinutes: null },
      isAdult: false
    };
    installBaseFetch({
      libraryItems: [],
      searchResponse: () => response({ results: [media], source: 'tmdb', pagination: { page: 1, perPage: 12, hasMore: false }, providerErrors: [] }),
      libraryCreateResponse: () => response({ error: { code: 'CONFLICT', message: 'This Library Item already exists.', details: [] } }, 409)
    });
    render(<App />);
    selectView('My Library');

    selectView('Search');
    const search = await screen.findByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(search, { target: { value: 'already saved' } });
    fireEvent.submit(search.closest('form'));
    const save = await screen.findByRole('button', { name: 'Save to library' });
    fireEvent.click(save);
    expect(await screen.findByRole('button', { name: 'Remove from library' })).toBeInTheDocument();
  });

  it('does not expose private tracking controls to an unauthenticated visitor', async () => {
    const fetchMock = vi.fn((url) => url === '/api/health'
      ? Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }))
      : Promise.resolve(response({ error: { code: 'UNAUTHENTICATED', message: 'Authentication required.', details: [] } }, 401)));
    vi.stubGlobal('fetch', fetchMock);
    render(<App />);
    selectView('My Library');

    expect(await screen.findByText('Sign in to see your library.')).toBeInTheDocument();
    expect(screen.queryByText('Filter')).not.toBeInTheDocument();
    expect(screen.queryByText('Shape your signal.')).not.toBeInTheDocument();
    selectView('Search');
    expect(screen.getByRole('searchbox', { name: 'Search anime by title' })).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/tags' || url === '/api/collections')).toBe(false);
  });
});
