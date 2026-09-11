import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView, openTracking } from './test-navigation.js';

const USER = { id: 'user-1', email: 'reader@example.com' };
const LIBRARY_ID = '00000000-0000-4000-8000-000000000001';

function response(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function libraryItem({ id = LIBRARY_ID, providerId = '42', favorite = false, libraryStatus = 'PLANNING' } = {}) {
  return {
    id,
    provider: 'tmdb',
    type: 'MOVIE',
    providerId,
    libraryStatus,
    favorite,
    personalRating: null,
    note: null,
    progress: null,
    tags: [],
    collections: [],
    createdAt: '2026-09-09T00:00:00.000Z',
    updatedAt: '2026-09-09T00:00:00.000Z'
  };
}

function media() {
  return {
    provider: 'tmdb',
    providerId: '43',
    type: 'MOVIE',
    id: 'tmdb:MOVIE:43',
    title: 'Arrival',
    originalTitle: null,
    alternativeTitles: [],
    description: null,
    image: null,
    bannerImage: null,
    releaseDate: { year: 2016, month: null, day: null },
    genres: [],
    providerRating: { value: 8, max: 10, normalized: 8 },
    releaseStatus: 'RELEASED',
    creators: [],
    isAdult: false,
    metadata: { runtimeMinutes: 116 }
  };
}

function searchPayload(results = [media()]) {
  return {
    results,
    source: 'tmdb',
    pagination: { page: 1, perPage: 12, hasMore: false },
    providerErrors: []
  };
}

describe('authentication and library experience', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn((url) => (
      url === '/api/health'
        ? Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }))
        : Promise.resolve(response(searchPayload([])))
    )));
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows safe registration errors, then exposes the authenticated User and logout', async () => {
    let registrations = 0;
    fetch.mockImplementation((url) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/register') {
        registrations += 1;
        return registrations === 1
          ? Promise.resolve(response({ error: { code: 'VALIDATION_ERROR', message: 'The request body is invalid.', details: [{ field: 'password', message: 'Password is too short.' }] } }, 400))
          : Promise.resolve(response(USER, 201));
      }
      if (url.startsWith('/api/library?')) return Promise.resolve(response({ results: [], pagination: { page: 1, perPage: 20, hasMore: false } }));
      if (url === '/api/auth/logout') return Promise.resolve({ ok: true, status: 204, json: async () => null });
      return Promise.resolve(response(searchPayload([])));
    });
    render(<App />);
    selectView('Account');

    fireEvent.click(screen.getByRole('button', { name: 'Register', exact: true }));
    const form = document.querySelector('.auth-form');
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: USER.email } });
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.submit(form);

    expect(await screen.findByRole('alert')).toHaveTextContent('Password is too short.');
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(form);

    expect(await screen.findByText(USER.email)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Log out' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByText('Sign in to see your library.')).toBeInTheDocument();
  });

  it('restores an existing session and shows the library loading state', async () => {
    let resolveLibrary;
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/me') return Promise.resolve(response(USER));
      if (url.startsWith('/api/library?') && options.method === 'GET') {
        return new Promise((resolve) => { resolveLibrary = resolve; });
      }
      return Promise.resolve(response(searchPayload([])));
    }));
    render(<App />);
    selectView('Account');

    expect(await screen.findByText(USER.email)).toBeInTheDocument();
    selectView('My Library');
    expect(await screen.findByRole('heading', { name: 'Loading your library.' })).toBeInTheDocument();
    resolveLibrary(response({ results: [], pagination: { page: 1, perPage: 20, hasMore: false } }));
    expect(await screen.findByRole('heading', { name: 'Your library is clear.' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('keeps search public while unauthenticated and does not mutate the library from Save', async () => {
    fetch.mockImplementation((url) => url === '/api/health'
      ? Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }))
      : Promise.resolve(response(searchPayload())));
    render(<App />);
    selectView('Account');
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));

    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));

    expect(screen.getByText('Sign in to save this reference to your library.')).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/library' && options?.method === 'POST')).toBe(false);
  });

  it('saves a Media reference and updates, favorites, and removes Library Items', async () => {
    const existing = libraryItem();
    const saved = libraryItem({ id: '00000000-0000-4000-8000-000000000002', providerId: '43' });
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/login') return Promise.resolve(response(USER));
      if (url.startsWith('/api/library?') && options.method === 'GET') return Promise.resolve(response({ results: [existing], pagination: { page: 1, perPage: 20, hasMore: false } }));
      if (url === '/api/library' && options.method === 'POST') return Promise.resolve(response(saved, 201));
      if (url === `/api/library/${LIBRARY_ID}` && options.method === 'PATCH') {
        const changes = JSON.parse(options.body);
        return Promise.resolve(response({ ...existing, ...changes }));
      }
      if (url === `/api/library/${LIBRARY_ID}` && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => null });
      if (url.startsWith('/api/media/search')) return Promise.resolve(response(searchPayload()));
      return Promise.resolve(response(searchPayload([])));
    }));
    render(<App />);
    selectView('Account');

    const authForm = document.querySelector('.auth-form');
    fireEvent.change(within(authForm).getByLabelText('Email'), { target: { value: USER.email } });
    fireEvent.change(within(authForm).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(authForm);

    expect(await screen.findByText('42')).toBeInTheDocument();
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(await screen.findByRole('button', { name: 'Saved to library' })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/library' && options?.method === 'POST' && options.body.includes('"providerId":"43"'))).toBe(true);

    selectView('My Library');
    openTracking();
    const existingStatus = screen.getByLabelText('Library status for TMDB movie 42');
    fireEvent.change(existingStatus, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(existingStatus).toHaveValue('COMPLETED'));
    const existingFavorite = screen.getByRole('checkbox', { name: 'Favorite TMDB movie 42' });
    fireEvent.click(existingFavorite);
    await waitFor(() => expect(existingFavorite).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: /Remove TMDB movie 42/ }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: '42' })).not.toBeInTheDocument());
    expect(fetch.mock.calls.filter(([url, options]) => url === `/api/library/${LIBRARY_ID}` && options?.method === 'PATCH')).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(`/api/library/${LIBRARY_ID}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('renders a safe library loading failure with retry', async () => {
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/login') return Promise.resolve(response(USER));
      if (url.startsWith('/api/library?') && options.method === 'GET') return Promise.resolve(response({ error: { code: 'LIBRARY_UNAVAILABLE', message: 'Library storage is currently unavailable.', details: [] } }, 503));
      return Promise.resolve(response(searchPayload([])));
    }));
    render(<App />);
    selectView('Account');

    const authForm = document.querySelector('.auth-form');
    fireEvent.change(within(authForm).getByLabelText('Email'), { target: { value: USER.email } });
    fireEvent.change(within(authForm).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(authForm);

    selectView('My Library');
    expect(await screen.findByRole('heading', { name: 'The library signal did not come through.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry library' })).toBeInTheDocument();
  });
});
