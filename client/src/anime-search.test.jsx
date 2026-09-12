import '@testing-library/jest-dom/vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView } from './test-navigation.js';

function media(id, title) {
  return {
    provider: 'anilist',
    providerId: id,
    type: 'ANIME',
    id: `anilist:ANIME:${id}`,
    title,
    originalTitle: null,
    alternativeTitles: [],
    description: null,
    image: null,
    bannerImage: null,
    releaseDate: { year: 2024, month: null, day: null },
    genres: [],
    providerRating: { value: 0, max: 100, normalized: 0 },
    releaseStatus: 'ONGOING',
    creators: [],
    isAdult: false,
    metadata: { episodeCount: 12, episodeDurationMinutes: 24 }
  };
}

function typedMedia({ id, title, type, metadata, source = 'tmdb' }) {
  return {
    provider: source,
    providerId: id,
    type,
    id: `${source}:${type}:${id}`,
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

function searchPayload(results, page = 1, hasMore = false, source = 'anilist') {
  return {
    results,
    source,
    pagination: { page, perPage: 12, hasMore },
    providerErrors: []
  };
}

function healthResponse() {
  return { ok: true, json: async () => ({ status: 'ok', service: 'goraku-base-api' }) };
}

function unauthenticatedResponse() {
  return {
    ok: false,
    status: 401,
    json: async () => ({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: [] } })
  };
}

function searchResponse(payload) {
  return { ok: true, json: async () => payload };
}

describe('anime search experience', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      return Promise.resolve(searchResponse(searchPayload([])));
    }));
  });

  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('browses latest releases from a blank input, debounces typing, and renders explicit card values', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      return Promise.resolve(searchResponse(searchPayload([media('1', 'Naruto')])))
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    const searchCalls = () => fetch.mock.calls.filter(([url]) => url.startsWith('/api/media/search'));

    expect(searchCalls()).toHaveLength(0);
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('heading', { name: 'Naruto' })).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(1);
    expect(searchCalls()[0]).not.toContain('q=');

    vi.useFakeTimers();
    fireEvent.change(input, { target: { value: 'naruto' } });
    expect(screen.getByText('Searching. Results will appear below.')).toBeInTheDocument();
    expect(searchCalls()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(299);
    });
    expect(searchCalls()).toHaveLength(1);

    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Naruto' })).toBeInTheDocument();
    expect(screen.getByRole('img', { name: '0.0 out of 10' })).toBeInTheDocument();
    expect(screen.getByText('2024')).toBeInTheDocument();
    expect(screen.queryByText('12 Episodes')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'View details for Naruto' })).toBeInTheDocument();
    expect(screen.getByText('Cover unavailable')).toBeInTheDocument();
  });

  it('submits immediately from Enter and reruns page one when adult visibility changes', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      return Promise.resolve(searchResponse(searchPayload([media('1', 'Naruto')])));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'cowboy' } });
    input.focus();
    fireEvent.keyDown(input, { key: 'Enter', code: 'Enter', charCode: 13 });
    fireEvent.submit(input.closest('form'));

    await screen.findByRole('heading', { name: 'Naruto' });
    const searchUrls = fetch.mock.calls.map(([url]) => url).filter((url) => url.startsWith('/api/media/search'));
    expect(searchUrls[0]).toContain('q=cowboy');
    expect(searchUrls[0]).toContain('page=1');

    fireEvent.click(screen.getByRole('checkbox', { name: 'Include adult content' }));
    await waitFor(() => expect(fetch.mock.calls.filter(([url]) => url.startsWith('/api/media/search'))).toHaveLength(2));
    expect(fetch.mock.calls.at(-1)[0]).toContain('includeAdult=false');
    expect(fetch.mock.calls.at(-1)[0]).toContain('page=1');
  });

  it('exposes labelled status and keyboard-reachable search controls', async () => {
    const user = userEvent.setup();
    render(<App />);
    selectView('Search');

    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    const searchButton = within(input.closest('form')).getByRole('button', { name: 'Search' });
    const adultCheckbox = screen.getByRole('checkbox', { name: 'Include adult content' });
    const results = screen.getByRole('region', { name: 'Anime search results' });

    expect(input).toHaveAttribute('aria-controls', 'media-results');
    expect(results).toHaveAttribute('aria-busy', 'false');
    expect(screen.getByText('Ready to browse latest releases or search by title.')).toHaveAttribute('aria-live', 'polite');
    expect(adultCheckbox).toBeChecked();

    input.focus();
    await user.tab();
    expect(searchButton).toHaveFocus();
    await user.tab();
    expect(adultCheckbox).toHaveFocus();
  });

  it('ignores a stale response when a newer query wins', async () => {
    let resolveFirst;
    let resolveSecond;
    let searchCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      searchCount += 1;
      return new Promise((resolve) => {
        if (searchCount === 1) resolveFirst = resolve;
        else resolveSecond = resolve;
      });
    });
    vi.useFakeTimers();
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });

    fireEvent.change(input, { target: { value: 'old' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(searchCount).toBe(1);
    fireEvent.change(input, { target: { value: 'new' } });
    await act(async () => { vi.advanceTimersByTime(300); });
    expect(searchCount).toBe(2);

    await act(async () => {
      resolveFirst(searchResponse(searchPayload([media('old', 'Old result')])));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.queryByRole('heading', { name: 'Old result' })).not.toBeInTheDocument();

    await act(async () => {
      resolveSecond(searchResponse(searchPayload([media('new', 'New result')])));
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'New result' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Old result' })).not.toBeInTheDocument();
  });

  it('shows a safe retry state and retains earlier results when a later page fails', async () => {
    let searchCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      searchCount += 1;
      if (searchCount === 1) return Promise.resolve(searchResponse(searchPayload([media('1', 'First result')], 1, true)));
      if (searchCount === 2) return Promise.reject(new TypeError('network down'));
      return Promise.resolve(searchResponse(searchPayload([media('2', 'Second result')], 2, false)));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'series' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'First result' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more anime results for series' }));
    expect(await screen.findByRole('button', { name: 'Retry page 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'First result' })).toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)[0]).toContain('provider=anilist');

    fireEvent.click(screen.getByRole('button', { name: 'Retry page 2' }));
    expect(await screen.findByRole('heading', { name: 'Second result' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retry page 2' })).not.toBeInTheDocument();
  });

  it('shows a no-results state and a retry action after a failed first request', async () => {
    let searchCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      searchCount += 1;
      if (searchCount === 1) return Promise.reject(new TypeError('network down'));
      return Promise.resolve(searchResponse(searchPayload([])));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'missing' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('button', { name: 'Retry search' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry search' }));
    expect(await screen.findByRole('heading', { name: 'No results for “missing”.' })).toBeInTheDocument();
  });

  it('shows the normal no-results state for a short query', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      return Promise.resolve(searchResponse(searchPayload([])));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: '2e' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: /No results for/ })).toBeInTheDocument();
  });

  it('provides an accessible type selector and reruns a non-empty query for the selected type', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      const params = new URL(url, 'http://localhost').searchParams;
      const type = params.get('type');
      return Promise.resolve(searchResponse(searchPayload([
        type === 'movie'
          ? typedMedia({ id: '10', title: 'Arrival', type: 'MOVIE', metadata: { runtimeMinutes: 116 } })
          : media('1', 'Naruto')
      ], 1, false, type === 'movie' ? 'tmdb' : 'anilist')));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    const typeSelector = screen.getByRole('combobox', { name: 'Search media type' });

    expect(typeSelector).toHaveValue('anime');
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('heading', { name: 'Naruto' })).toBeInTheDocument();

    fireEvent.change(typeSelector, { target: { value: 'movie' } });

    expect(screen.getByText('Searching movies for arrival.')).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();
    expect(screen.getByRole('searchbox', { name: 'Search movies by title' })).toBeInTheDocument();
    expect(screen.queryByText('UNOFFICIAL TMDB INTEGRATION')).not.toBeInTheDocument();
    expect(fetch.mock.calls.at(-1)[0]).toContain('type=movie');
    expect(fetch.mock.calls.at(-1)[0]).toContain('provider=tmdb');
  });

  it('offers a searchable multi-select genre filter with a genre-only reset', async () => {
    const filterOptions = {
      type: 'anime',
      source: 'anilist',
      genres: [
        { id: 'Action', label: 'Action' },
        { id: 'Comedy', label: 'Comedy' },
        { id: 'Drama', label: 'Drama' }
      ],
      creators: [],
      rating: { field: 'minRating', label: 'Minimum Provider Rating', max: 10, step: 0.5 }
    };
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.startsWith('/api/media/filter-options')) return Promise.resolve(searchResponse(filterOptions));
      return Promise.resolve(searchResponse(searchPayload([media('1', 'Naruto')])));
    });
    render(<App />);
    selectView('Search');

    fireEvent.click(screen.getByText('More filters'));
    const genreTrigger = await screen.findByText('Any genres');
    fireEvent.click(genreTrigger);
    const genreSearch = screen.getByRole('searchbox', { name: 'Search genres' });
    expect(screen.getByRole('button', { name: 'Action', pressed: false })).toBeInTheDocument();
    fireEvent.change(genreSearch, { target: { value: 'com' } });
    expect(screen.getByRole('button', { name: 'Comedy', pressed: false })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Action', pressed: false })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Comedy', pressed: false }));
    expect(screen.getByRole('button', { name: 'Comedy', pressed: true })).toBeInTheDocument();
    expect(screen.getByText('Comedy', { selector: 'summary span' })).toBeInTheDocument();
    fireEvent.submit(genreSearch.closest('form'));
    await screen.findByRole('heading', { name: 'Naruto' });
    const latestFilteredUrl = fetch.mock.calls.map(([url]) => url).findLast((url) => url.startsWith('/api/media/search'));
    expect(latestFilteredUrl).toContain('genres=Comedy');
    expect(latestFilteredUrl).not.toContain('q=');

    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(screen.getByText('Any genres', { selector: 'summary span' })).toBeInTheDocument();
  });

  it('keeps runtime and episode facts in details instead of the compact cards', async () => {
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      if (url.includes('/api/media/tmdb/')) {
        const [, type, id] = new URL(url, 'http://localhost').pathname.split('/').slice(3);
        return Promise.resolve(searchResponse(typedMedia({
          id, title: type === 'tv' ? 'Severance' : id === '10' ? 'Arrival' : 'Arrival: Unknown',
          type: type.toUpperCase(),
          metadata: type === 'tv' ? { seasonCount: null, episodeCount: null } : { runtimeMinutes: id === '10' ? 116 : null }
        })));
      }
      const params = new URL(url, 'http://localhost').searchParams;
      const type = params.get('type');
      return Promise.resolve(searchResponse(searchPayload([
        type === 'tv'
          ? typedMedia({ id: '20', title: 'Severance', type: 'TV', metadata: { seasonCount: null, episodeCount: null } })
          : typedMedia({ id: '10', title: 'Arrival', type: 'MOVIE', metadata: { runtimeMinutes: 116 } }),
        ...(type === 'tv' ? [] : [typedMedia({ id: '11', title: 'Arrival: Unknown', type: 'MOVIE', metadata: { runtimeMinutes: null } })])
      ], 1, false, 'tmdb')));
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();
    expect(screen.queryByText('116 Minutes')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details for Arrival', exact: true }));
    await screen.findByRole('heading', { name: 'Arrival details' });
    expect(screen.getByText('116 Minutes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    fireEvent.click(screen.getByRole('button', { name: 'View details for Arrival: Unknown' }));
    await screen.findByRole('heading', { name: 'Arrival: Unknown details' });
    expect(screen.getByText('Runtime unavailable')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Back to results' }));
    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'tv' } });
    expect(await screen.findByRole('heading', { name: 'Severance' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'View details for Severance' }));
    await screen.findByRole('heading', { name: 'Severance details' });
    expect(screen.getByText('Seasons unavailable')).toBeInTheDocument();
    expect(screen.getByText('Episodes unavailable')).toBeInTheDocument();
    expect(screen.queryByText('UNOFFICIAL TMDB INTEGRATION')).not.toBeInTheDocument();
  });

  it('ignores a slower response from the previous type after a type change', async () => {
    let resolveAnime;
    let resolveMovie;
    let searchCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      searchCount += 1;
      return new Promise((resolve) => {
        if (searchCount === 1) resolveAnime = resolve;
        else resolveMovie = resolve;
      });
    });
    render(<App />);
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'signal' } });
    fireEvent.submit(input.closest('form'));
    expect(searchCount).toBe(1);

    fireEvent.change(screen.getByRole('combobox', { name: 'Search media type' }), { target: { value: 'movie' } });
    expect(searchCount).toBe(2);

    await act(async () => {
      resolveAnime(searchResponse(searchPayload([media('old', 'Anime result')])));
      await Promise.resolve();
    });
    expect(screen.queryByRole('heading', { name: 'Anime result' })).not.toBeInTheDocument();

    await act(async () => {
      resolveMovie(searchResponse(searchPayload([
        typedMedia({ id: '30', title: 'Movie result', type: 'MOVIE', metadata: { runtimeMinutes: 90 } })
      ], 1, false, 'tmdb')));
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(screen.getByRole('heading', { name: 'Movie result' })).toBeInTheDocument();
  });

  it('loads and retries a later TV page while retaining the active TMDB source', async () => {
    let searchCount = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(healthResponse());
      if (url === '/api/auth/me') return Promise.resolve(unauthenticatedResponse());
      searchCount += 1;
      const params = new URL(url, 'http://localhost').searchParams;
      if (searchCount === 1) {
        return Promise.resolve(searchResponse(searchPayload([
          typedMedia({ id: '40', title: 'Severance', type: 'TV', metadata: { seasonCount: 2, episodeCount: 19 } })
        ], 1, true, 'tmdb')));
      }
      if (searchCount === 2) return Promise.reject(new TypeError('temporary network down'));
      expect(params.get('type')).toBe('tv');
      expect(params.get('provider')).toBe('tmdb');
      expect(params.get('page')).toBe('2');
      return Promise.resolve(searchResponse(searchPayload([
        typedMedia({ id: '41', title: 'TV result two', type: 'TV', metadata: { seasonCount: null, episodeCount: null } })
      ], 2, false, 'tmdb')));
    });
    render(<App />);
    selectView('Search');

    const typeSelector = screen.getByRole('combobox', { name: 'Search media type' });
    fireEvent.change(typeSelector, { target: { value: 'tv' } });
    const input = screen.getByRole('searchbox', { name: 'Search TV by title' });
    fireEvent.change(input, { target: { value: 'severance' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Severance' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more TV results for severance' }));

    expect(await screen.findByRole('button', { name: 'Retry page 2' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Severance' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retry page 2' }));

    expect(await screen.findByRole('heading', { name: 'TV result two' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Severance' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Load more TV results for severance' })).not.toBeInTheDocument();
  });
});
