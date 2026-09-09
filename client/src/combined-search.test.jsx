import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

function healthResponse() {
  return { ok: true, json: async () => ({ status: 'ok', service: 'goraku-base-api' }) };
}

function searchResponse(payload) {
  return { ok: true, json: async () => payload };
}

function media({ id, title, type, provider }) {
  const metadata = type === 'GAME'
    ? { platforms: ['PC'], developers: ['Signal Studio'], publishers: ['Signal Works'] }
    : type === 'MOVIE'
      ? { runtimeMinutes: 120 }
      : type === 'TV'
        ? { seasonCount: 2, episodeCount: 20 }
        : { episodeCount: 12, episodeDurationMinutes: 24 };

  return {
    provider,
    providerId: id,
    type,
    id: `${provider}:${type}:${id}`,
    title,
    originalTitle: null,
    alternativeTitles: [],
    description: null,
    image: null,
    bannerImage: null,
    releaseDate: { year: 2024, month: null, day: null },
    genres: [],
    providerRating: { value: 0, max: 10, normalized: 0 },
    releaseStatus: 'UNKNOWN',
    creators: [],
    isAdult: false,
    metadata
  };
}

function gameMedia(id, title, metadata, provider = 'rawg') {
  return {
    ...media({ id, title, type: 'GAME', provider }),
    metadata
  };
}

function combinedPayload(results, {
  page = 1,
  hasMore = false,
  continuation = null,
  providers = {},
  providerErrors = []
} = {}) {
  return {
    results,
    source: 'combined',
    pagination: { page, hasMore, providers, continuation },
    providerErrors
  };
}

describe('Games and Combined Search experience', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => (
      url === '/api/health'
        ? Promise.resolve(healthResponse())
        : Promise.resolve(searchResponse(combinedPayload([])))
    )));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('offers Games and All choices and renders explicit game metadata placeholders', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      return Promise.resolve(searchResponse({
        results: [gameMedia('1', 'Unknown Game', { platforms: [], developers: [], publishers: [] }, 'thegamesdb')],
        source: 'thegamesdb',
        pagination: { page: 1, perPage: 20, hasMore: false },
        providerErrors: []
      }));
    });
    render(<App />);

    const selector = screen.getByRole('combobox', { name: 'Search media type' });
    expect(screen.getByRole('option', { name: 'Games' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'All' })).toBeInTheDocument();
    expect(selector).toHaveValue('anime');

    fireEvent.change(selector, { target: { value: 'game' } });
    const input = screen.getByRole('searchbox', { name: 'Search games by title' });
    fireEvent.change(input, { target: { value: 'zelda' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Unknown Game' })).toBeInTheDocument();
    expect(screen.getByText('Platforms unavailable')).toBeInTheDocument();
    expect(screen.getByText('Developers unavailable')).toBeInTheDocument();
    expect(screen.getByText('Publishers unavailable')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: /TheGamesDB/i }).every((link) => link.getAttribute('href') === 'https://thegamesdb.net/')).toBe(true);
  });

  it('groups Combined Search results and keeps successful lanes visible after a safe provider failure', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      return Promise.resolve(searchResponse(combinedPayload([
        media({ id: 'a1', title: 'Anime result', type: 'ANIME', provider: 'anilist' }),
        media({ id: 'm1', title: 'Movie result', type: 'MOVIE', provider: 'tmdb' }),
        gameMedia('g1', 'Game result', { platforms: ['PC'], developers: [], publishers: [] })
      ], {
        hasMore: true,
        continuation: 'combined-cursor-1',
        providers: {
          anilist: { page: 1, perPage: 12, hasMore: false },
          tmdb: { page: 1, perPage: 20, hasMore: false }
        },
        providerErrors: [{ provider: 'rawg', code: 'PROVIDER_RATE_LIMITED', message: 'RAWG rate limit reached.' }]
      })));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'all' } });
    const input = screen.getByRole('searchbox', { name: 'Search all media by title' });
    fireEvent.change(input, { target: { value: 'signal' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Anime' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Movies' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Games' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'TV' })).not.toBeInTheDocument();
    expect(screen.getByText('RAWG is temporarily unavailable.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry RAWG search' })).toBeInTheDocument();
    expect(screen.queryByText('RAWG rate limit reached.')).not.toBeInTheDocument();

    const attribution = document.querySelector('.search-attribution');
    expect(attribution).toHaveTextContent('UNOFFICIAL ANILIST / TMDB / RAWG INTEGRATIONS');
    expect(within(attribution).getByRole('link', { name: 'ANILIST' })).toHaveAttribute('href', 'https://anilist.co/');
    expect(within(attribution).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
    expect(within(attribution).getByRole('link', { name: 'RAWG' })).toHaveAttribute('href', 'https://rawg.io/');
    expect(screen.getAllByRole('link', { name: 'RAWG' }).every((link) => link.getAttribute('href') === 'https://rawg.io/')).toBe(true);
  });

  it('attributes Combined Search results sourced from TheGamesDB', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      return Promise.resolve(searchResponse(combinedPayload([
        gameMedia('tgdb-1', 'TheGamesDB game', { platforms: ['PC'], developers: [], publishers: [] }, 'thegamesdb')
      ], {
        providers: { thegamesdb: { page: 1, perPage: 20, hasMore: false } }
      })));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'all' } });
    const input = screen.getByRole('searchbox', { name: 'Search all media by title' });
    fireEvent.change(input, { target: { value: 'zelda' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Games' })).toBeInTheDocument();
    const attribution = document.querySelector('.search-attribution');
    expect(attribution).toHaveTextContent('UNOFFICIAL THEGAMESDB INTEGRATION');
    expect(within(attribution).getByRole('link', { name: 'UNOFFICIAL THEGAMESDB INTEGRATION' })).toHaveAttribute('href', 'https://thegamesdb.net/');
  });

  it('uses the opaque Combined cursor and retries only a failed provider without duplicates', async () => {
    let combinedRequestCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      combinedRequestCount += 1;
      const params = new URL(url, 'http://localhost').searchParams;
      if (combinedRequestCount === 1) {
        expect(params.get('type')).toBe('all');
        expect(params.get('page')).toBe('1');
        expect(params.get('cursor')).toBeNull();
        return Promise.resolve(searchResponse(combinedPayload([
          media({ id: 'a1', title: 'Anime result', type: 'ANIME', provider: 'anilist' }),
          media({ id: 'm1', title: 'Movie result', type: 'MOVIE', provider: 'tmdb' })
        ], {
          hasMore: true,
          continuation: 'opaque-cursor-1',
          providers: {
            anilist: { page: 1, perPage: 12, hasMore: false },
            tmdb: { page: 1, perPage: 20, hasMore: false }
          },
          providerErrors: [{ provider: 'rawg', code: 'PROVIDER_UNAVAILABLE', message: 'RAWG is currently unavailable.' }]
        })));
      }

      expect(params.get('type')).toBe('all');
      expect(params.get('page')).toBe('2');
      expect(params.get('cursor')).toBe('opaque-cursor-1');
      expect(params.get('retryProvider')).toBe('rawg');
      return Promise.resolve(searchResponse(combinedPayload([
        gameMedia('g1', 'Recovered game', { platforms: ['PC'], developers: [], publishers: [] })
      ], {
        page: 2,
        hasMore: false,
        providers: {
          anilist: { page: 1, perPage: 12, hasMore: false },
          tmdb: { page: 1, perPage: 20, hasMore: false },
          rawg: { page: 2, perPage: 20, hasMore: false }
        }
      })));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'all' } });
    const input = screen.getByRole('searchbox', { name: 'Search all media by title' });
    fireEvent.change(input, { target: { value: 'signal' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Anime result' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry RAWG search' }));

    expect(await screen.findByRole('heading', { name: 'Recovered game' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Anime result' })).toHaveLength(1);
    expect(screen.getAllByRole('heading', { name: 'Movie result' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Retry RAWG search' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more media results for signal' })).not.toBeInTheDocument();
    expect(combinedRequestCount).toBe(2);
  });

  it('loads the next Combined page with its cursor and filters repeated media identities', async () => {
    let combinedRequestCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      combinedRequestCount += 1;
      const params = new URL(url, 'http://localhost').searchParams;
      if (combinedRequestCount === 1) {
        return Promise.resolve(searchResponse(combinedPayload([
          media({ id: 'a1', title: 'Anime one', type: 'ANIME', provider: 'anilist' })
        ], {
          hasMore: true,
          continuation: 'opaque-cursor-1',
          providers: { anilist: { page: 1, perPage: 12, hasMore: true } }
        })));
      }

      expect(params.get('page')).toBe('2');
      expect(params.get('cursor')).toBe('opaque-cursor-1');
      expect(params.get('retryProvider')).toBeNull();
      return Promise.resolve(searchResponse(combinedPayload([
        media({ id: 'a1', title: 'Anime one', type: 'ANIME', provider: 'anilist' }),
        media({ id: 'a2', title: 'Anime two', type: 'ANIME', provider: 'anilist' })
      ], {
        page: 2,
        providers: { anilist: { page: 2, perPage: 12, hasMore: false } }
      })));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'all' } });
    const input = screen.getByRole('searchbox', { name: 'Search all media by title' });
    fireEvent.change(input, { target: { value: 'signal' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Anime one' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more all media results for signal' }));

    expect(await screen.findByRole('heading', { name: 'Anime two' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Anime one' })).toHaveLength(1);
    expect(screen.queryByRole('button', { name: 'Load more all media results for signal' })).not.toBeInTheDocument();
    expect(combinedRequestCount).toBe(2);
  });
});
