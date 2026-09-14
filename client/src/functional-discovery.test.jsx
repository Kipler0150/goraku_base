import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView } from './test-navigation.js';

function response(payload) {
  return { ok: true, json: async () => payload };
}

function unauthenticatedResponse() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: [] } })
  };
}

function media({ id = '550', title = 'Fight Club', provider = 'tmdb', type = 'MOVIE', creators = [] } = {}) {
  return {
    provider,
    providerId: id,
    type,
    id: `${provider}:${type}:${id}`,
    title,
    originalTitle: null,
    alternativeTitles: [],
    description: 'A normalized description.',
    image: null,
    bannerImage: null,
    releaseDate: { year: 1999, month: 10, day: 15 },
    genres: ['Drama'],
    providerRating: { value: 8.4, max: 10, normalized: 8.4 },
    releaseStatus: 'RELEASED',
    creators,
    isAdult: false,
    metadata: type === 'MOVIE' ? { runtimeMinutes: 139 } : { episodeCount: 12, episodeDurationMinutes: 24 }
  };
}

function gameMedia({ id = '3498', title = 'Grand Theft Auto V', creators = [] } = {}) {
  return {
    ...media({ id, title, provider: 'rawg', type: 'GAME', creators }),
    metadata: {
      platforms: ['PC', 'PlayStation 5'],
      developers: ['Rockstar North'],
      publishers: ['Rockstar Games']
    }
  };
}

function list(results, source = 'tmdb', hasMore = false) {
  return {
    results,
    source,
    pagination: { page: 1, perPage: 12, hasMore },
    providerErrors: []
  };
}

function health() {
  return response({ status: 'ok', service: 'goraku-base-api' });
}

describe('functional Discovery surfaces', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([media()])));
      return Promise.resolve(response(list([])));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('opens accessible details from a Media card and returns to the results', async () => {
    const detail = media();
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/api/media/tmdb/movie/550')) return Promise.resolve(response(detail));
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const movieQuery = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(movieQuery, { target: { value: 'fight club' } });
    fireEvent.submit(movieQuery.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Fight Club' })).toBeInTheDocument();
    expect(screen.queryByText('View details', { exact: true })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(screen.getByText('Sign in to save this reference to your library.')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Fight Club details' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    expect(await screen.findByRole('heading', { name: 'Fight Club details' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Bookmark this movie' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));

    expect(screen.getByRole('heading', { name: 'Fight Club' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details for Fight Club' })).toHaveFocus();
    expect(screen.queryByRole('heading', { name: 'Fight Club details' })).not.toBeInTheDocument();
  });

  it('announces details loading while the Provider response is pending', async () => {
    const detail = media();
    let resolveDetail;
    const detailResponse = new Promise((resolve) => { resolveDetail = resolve; });
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/api/media/tmdb/movie/550')) return detailResponse;
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    const detailsPanel = await screen.findByRole('region', { name: 'Fight Club details' });
    expect(detailsPanel).toHaveAttribute('aria-busy', 'true');
    resolveDetail(response(detail));
    expect(await screen.findByRole('heading', { name: 'Fight Club details' })).toBeInTheDocument();
  });

  it('loads Provider-owned Recommendations inside the details panel', async () => {
    const detail = media();
    const recommendation = media({ id: '680', title: 'Pulp Fiction' });
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/recommendations')) return Promise.resolve(response(list([recommendation])));
      if (url.includes('/api/media/tmdb/movie/550')) return Promise.resolve(response(detail));
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));
    await screen.findByRole('heading', { name: 'Fight Club details' });

    const recommendations = await screen.findByRole('region', { name: 'Recommendations' });
    expect(screen.queryByRole('button', { name: 'Load recommendations' })).not.toBeInTheDocument();
    expect(within(recommendations).getByRole('heading', { name: 'Pulp Fiction' })).toBeInTheDocument();
    expect(within(recommendations).queryByText('UNOFFICIAL TMDB INTEGRATION')).not.toBeInTheDocument();
    expect(within(recommendations).queryByText('20 Provider-owned Recommendations loaded.')).not.toBeInTheDocument();
  });

  it('shows only prioritized key creators in details', async () => {
    const detail = media({
      creators: [
        { name: 'Extra Name', role: 'Editor' },
        { name: 'Director One', role: 'Director' },
        { name: 'Creator One', role: 'Creator' },
        { name: 'Writer One', role: 'Writer' },
        { name: 'Story One', role: 'Story' },
        { name: 'Producer One', role: 'Producer' }
      ]
    });
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/recommendations')) return Promise.resolve(response(list([])));
      if (url.includes('/api/media/tmdb/movie/550')) return Promise.resolve(response(detail));
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    const detailsPanel = await screen.findByRole('region', { name: 'Fight Club details' });
    expect(within(detailsPanel).getByText('Director One, Creator One, Writer One, Story One, Producer One')).toBeInTheDocument();
    expect(within(detailsPanel).queryByText(/Extra Name/)).not.toBeInTheDocument();
  });

  it('hides unavailable creator metadata for games', async () => {
    const detail = gameMedia();
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail], 'rawg')));
      if (url.includes('/recommendations')) return Promise.resolve(response(list([], 'rawg')));
      if (url.includes('/api/media/rawg/game/3498')) return Promise.resolve(response(detail));
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'game' } });
    const query = screen.getByRole('searchbox', { name: 'Search games by title' });
    fireEvent.change(query, { target: { value: 'grand theft auto' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Grand Theft Auto V' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Grand Theft Auto V' }));

    const detailsPanel = await screen.findByRole('region', { name: 'Grand Theft Auto V details' });
    expect(within(detailsPanel).queryByText('Key creators')).not.toBeInTheDocument();
    expect(within(detailsPanel).queryByText('Creators unavailable')).not.toBeInTheDocument();
    expect(within(detailsPanel).getByText('Rockstar North')).toBeInTheDocument();
  });

  it('shows popular games when game recommendations are unavailable', async () => {
    const detail = gameMedia();
    const popularGame = gameMedia({ id: '292030', title: 'The Witcher 3: Wild Hunt' });
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail], 'rawg')));
      if (url.includes('/recommendations')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'RAWG is currently unavailable.', details: [] } })
        });
      }
      if (url.includes('/api/media/popular') && new URL(url, 'http://localhost').searchParams.get('type') === 'game') {
        return Promise.resolve(response(list([popularGame], 'rawg')));
      }
      if (url.includes('/api/media/rawg/game/3498')) return Promise.resolve(response(detail));
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'game' } });
    const query = screen.getByRole('searchbox', { name: 'Search games by title' });
    fireEvent.change(query, { target: { value: 'grand theft auto' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Grand Theft Auto V' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Grand Theft Auto V' }));

    const popular = await screen.findByRole('region', { name: 'Popular games' });
    expect(within(popular).getByRole('heading', { name: 'Popular games' })).toBeInTheDocument();
    expect(await within(popular).findByRole('heading', { name: 'The Witcher 3: Wild Hunt' })).toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Recommendations' })).not.toBeInTheDocument();
    expect(screen.queryByText('Provider unavailable.')).not.toBeInTheDocument();
  });

  it('loads supported Discovery results without shelf attribution labels and shows empty state', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular') || url.includes('/api/media/trending') || url.includes('/api/media/latest')) return Promise.resolve(response(list([], 'tmdb')));
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    expect(await screen.findByText('No Popular now Movies available.')).toBeInTheDocument();
    const discovery = screen.getByRole('region', { name: 'Popular now Movies shelf' });
    expect(within(discovery).queryByRole('link', { name: 'TMDB' })).not.toBeInTheDocument();
    expect(screen.queryByText(/One source, three ways/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Adult content is included/)).not.toBeInTheDocument();
  });

  it('loads every shelf page from its next arrow without load-more buttons', async () => {
    const pageTwoTitles = {
      popular: 'Popular page 2',
      trending: 'Trending page 2',
      latest: 'Latest page 2'
    };
    const pageTwoRequests = [];
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      const shelf = url.includes('/api/media/popular')
        ? 'popular'
        : url.includes('/api/media/trending')
          ? 'trending'
          : url.includes('/api/media/latest')
            ? 'latest'
            : null;
      if (shelf) {
        const page = new URL(url, 'http://localhost').searchParams.get('page');
        if (page === '2') {
          pageTwoRequests.push(shelf);
          return Promise.resolve(response(list([media({ id: `${shelf}-2`, title: pageTwoTitles[shelf] })], 'tmdb', false)));
        }
        return Promise.resolve(response(list([media({ id: `${shelf}-1`, title: shelf })], 'tmdb', true)));
      }
      return Promise.resolve(response(list([])));
    });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'popular', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more popular now' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more trending this week' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more latest releases' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Scroll Popular now Movies right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll Trending this week Movies right' }));
    fireEvent.click(screen.getByRole('button', { name: 'Scroll Latest releases Movies right' }));

    await waitFor(() => expect(pageTwoRequests).toEqual(expect.arrayContaining(['popular', 'trending', 'latest'])));
    expect(await screen.findByRole('heading', { name: 'Popular page 2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Trending page 2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Latest page 2' })).toBeInTheDocument();
  });

  it('loads the next shelf page when a rail reaches its horizontal end', async () => {
    const pageTwoRequests = [];
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      const shelf = url.includes('/api/media/popular')
        ? 'popular'
        : url.includes('/api/media/trending')
          ? 'trending'
          : url.includes('/api/media/latest')
            ? 'latest'
            : null;
      if (shelf) {
        const page = new URL(url, 'http://localhost').searchParams.get('page');
        if (page === '2') {
          pageTwoRequests.push(shelf);
          return Promise.resolve(response(list([media({ id: `${shelf}-2`, title: `${shelf} page 2` })], 'tmdb', false)));
        }
        return Promise.resolve(response(list([media({ id: `${shelf}-1`, title: shelf })], 'tmdb', true)));
      }
      return Promise.resolve(response(list([])));
    });
    render(<App />);

    expect(await screen.findByRole('heading', { name: 'popular', level: 3 })).toBeInTheDocument();
    for (const label of ['Popular now Movies shelf', 'Trending this week Movies shelf', 'Latest releases Movies shelf']) {
      const rail = screen.getByRole('region', { name: label }).querySelector('.discovery-rail');
      Object.defineProperty(rail, 'scrollWidth', { configurable: true, value: 1200 });
      Object.defineProperty(rail, 'clientWidth', { configurable: true, value: 400 });
      Object.defineProperty(rail, 'scrollLeft', { configurable: true, value: 850 });
      fireEvent.scroll(rail);
    }

    await waitFor(() => expect(pageTwoRequests).toEqual(expect.arrayContaining(['popular', 'trending', 'latest'])));
    expect(await screen.findByRole('heading', { name: 'popular page 2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'trending page 2' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'latest page 2' })).toBeInTheDocument();
  });

  it('uses honest Anime shelf labels and leaves provider selection to the server', async () => {
    const animeRequests = [];
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('type=anime')) {
        animeRequests.push(url);
        return Promise.resolve(response(list([], 'myanimelist')));
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Anime' }));

    expect(await screen.findByRole('heading', { name: 'Currently airing', level: 3 })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Seasonal releases', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('combobox', { name: 'Source' })).not.toBeInTheDocument();
    await waitFor(() => expect(animeRequests).toHaveLength(3));
    animeRequests.forEach((url) => expect(new URL(url, 'http://localhost').searchParams.has('provider')).toBe(false));
  });

  it('announces unsupported and rate-limited public states with retry actions', async () => {
    let discoveryCall = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular?type=game')) {
        discoveryCall += 1;
        return Promise.resolve(discoveryCall === 1
          ? { ok: false, status: 501, json: async () => ({ error: { code: 'CAPABILITY_UNSUPPORTED', message: 'This Provider does not support the requested operation.', details: [] } }) }
          : { ok: false, status: 503, json: async () => ({ error: { code: 'PROVIDER_RATE_LIMITED', message: 'Provider rate limit reached.', details: [] } }) });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Games' }));
    expect(await screen.findByText('This popular operation is not supported by the catalog provider.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Popular' }));
    expect(await screen.findByText('The catalog provider is rate-limited.')).toBeInTheDocument();
  });

  it('uses the Games shelf labels and skips unsupported Trending requests', async () => {
    const gameDiscoveryUrls = [];
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/') && url.includes('type=game')) {
        gameDiscoveryUrls.push(url);
        return Promise.resolve(response(list([], 'rawg')));
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.click(screen.getByRole('button', { name: 'Games' }));

    expect(await screen.findByText('No Popular Games available.')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Latest releases', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Trending this week', level: 3 })).not.toBeInTheDocument();
    await waitFor(() => expect(gameDiscoveryUrls).toHaveLength(2));
    expect(gameDiscoveryUrls.every((url) => !url.includes('/api/media/trending'))).toBe(true);
  });

  it('distinguishes application rate limits from Provider rate limits', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular?type=movie')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({ error: { code: 'APPLICATION_RATE_LIMITED', message: 'Too many media requests. Please retry later.', details: [] } })
        });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    expect(await screen.findByText('The application is rate-limited. Please retry later.')).toBeInTheDocument();
  });

  it('announces an unavailable Provider state with a retry action', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular?type=movie')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'TMDB is currently unavailable.', details: [] } })
        });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    expect(await screen.findByText('The catalog provider could not return popular now.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Popular now' })).toBeInTheDocument();
  });

  it('shows an invalid details response as a retryable client state', async () => {
    const detail = media();
    let detailCall = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/recommendations')) return Promise.resolve(response(list([])));
      if (url.includes('/api/media/tmdb/movie/550')) {
        detailCall += 1;
        return Promise.resolve(detailCall === 1 ? response({ results: [] }) : response(detail));
      }
      return Promise.resolve(response(list([])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    expect(await screen.findByRole('heading', { name: 'Invalid response.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry details' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(await screen.findByRole('heading', { name: 'Fight Club details' })).toBeInTheDocument();
  });
});
