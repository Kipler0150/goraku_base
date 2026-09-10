import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

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

function media({ id = '550', title = 'Fight Club', provider = 'tmdb', type = 'MOVIE' } = {}) {
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
    creators: [],
    isAdult: false,
    metadata: type === 'MOVIE' ? { runtimeMinutes: 139 } : { episodeCount: 12, episodeDurationMinutes: 24 }
  };
}

function list(results, source = 'tmdb') {
  return {
    results,
    source,
    pagination: { page: 1, perPage: 12, hasMore: false },
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

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const movieQuery = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(movieQuery, { target: { value: 'fight club' } });
    fireEvent.submit(movieQuery.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Fight Club' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    expect(await screen.findByRole('heading', { name: 'Fight Club details' })).toBeInTheDocument();
    expect(within(screen.getByRole('region', { name: 'Fight Club details' })).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));

    expect(screen.getByRole('heading', { name: 'Fight Club' })).toBeInTheDocument();
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

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    expect(await screen.findByText('Loading details for Fight Club.')).toBeInTheDocument();
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

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));
    await screen.findByRole('heading', { name: 'Fight Club details' });

    fireEvent.click(screen.getByRole('button', { name: 'Load recommendations' }));

    const recommendations = await screen.findByRole('region', { name: 'Provider-owned recommendations' });
    expect(within(recommendations).getByRole('heading', { name: 'Pulp Fiction' })).toBeInTheDocument();
    expect(within(recommendations).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
  });

  it('loads supported Discovery results with Provider attribution and empty state', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular')) return Promise.resolve(response(list([], 'tmdb')));
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery media type' }), { target: { value: 'movie' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery operation' }), { target: { value: 'popular' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load popular movies' }));

    const discovery = await screen.findByRole('region', { name: 'Popular Movies discovery' });
    expect(discovery).toHaveTextContent('No Popular Movies available.');
    expect(within(discovery).getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
  });

  it('announces unsupported and rate-limited public states with retry actions', async () => {
    let discoveryCall = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular')) {
        discoveryCall += 1;
        return Promise.resolve(discoveryCall === 1
          ? { ok: false, status: 501, json: async () => ({ error: { code: 'CAPABILITY_UNSUPPORTED', message: 'This Provider does not support the requested operation.', details: [] } }) }
          : { ok: false, status: 503, json: async () => ({ error: { code: 'PROVIDER_RATE_LIMITED', message: 'Provider rate limit reached.', details: [] } }) });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery media type' }), { target: { value: 'game' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery operation' }), { target: { value: 'popular' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load popular games' }));
    expect(await screen.findByText('This Discovery operation is not supported by the selected Provider.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry Discovery' }));
    expect(await screen.findByText('The selected Provider is rate-limited.')).toBeInTheDocument();
  });

  it('distinguishes application rate limits from Provider rate limits', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular')) {
        return Promise.resolve({
          ok: false,
          status: 429,
          json: async () => ({ error: { code: 'APPLICATION_RATE_LIMITED', message: 'Too many media requests. Please retry later.', details: [] } })
        });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery media type' }), { target: { value: 'movie' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery operation' }), { target: { value: 'popular' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load popular movies' }));

    expect(await screen.findByText('The application is rate-limited. Please retry later.')).toBeInTheDocument();
  });

  it('announces an unavailable Provider state with a retry action', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/popular')) {
        return Promise.resolve({
          ok: false,
          status: 503,
          json: async () => ({ error: { code: 'PROVIDER_UNAVAILABLE', message: 'TMDB is currently unavailable.', details: [] } })
        });
      }
      return Promise.resolve(response(list([media()])));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery media type' }), { target: { value: 'movie' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Discovery operation' }), { target: { value: 'popular' } });
    fireEvent.click(screen.getByRole('button', { name: 'Load popular movies' }));

    expect(await screen.findByText('The selected Provider could not return discovery.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry Discovery' })).toBeInTheDocument();
  });

  it('shows an invalid details response as a retryable client state', async () => {
    const detail = media();
    let detailCall = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(health());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/search')) return Promise.resolve(response(list([detail])));
      if (url.includes('/api/media/tmdb/movie/550')) {
        detailCall += 1;
        return Promise.resolve(detailCall === 1 ? response({ results: [] }) : response(detail));
      }
      return Promise.resolve(response(list([])));
    });
    render(<App />);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    const query = screen.getByRole('searchbox', { name: 'Search movies by title' });
    fireEvent.change(query, { target: { value: 'fight club' } });
    fireEvent.submit(query.closest('form'));
    await screen.findByRole('heading', { name: 'Fight Club' });
    fireEvent.click(screen.getByRole('button', { name: 'View details for Fight Club' }));

    expect(await screen.findByText('The details response was invalid.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry details' }));
    expect(await screen.findByRole('heading', { name: 'Fight Club details' })).toBeInTheDocument();
  });
});
