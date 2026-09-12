import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView, openTracking } from './test-navigation.js';

const USER = { id: 'user-1', username: 'reader', email: 'reader@example.com' };
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

    fireEvent.click(within(document.querySelector('.auth-mode-prompt')).getByRole('button', { name: 'Sign up', exact: true }));
    const form = document.querySelector('.auth-form');
    fireEvent.change(within(form).getByLabelText('Username'), { target: { value: USER.username } });
    fireEvent.change(within(form).getByLabelText('Email'), { target: { value: USER.email } });
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'short' } });
    fireEvent.submit(form);

    expect(await screen.findByRole('alert')).toHaveTextContent('Password is too short.');
    fireEvent.change(within(form).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(form);

    expect(await screen.findByRole('heading', { name: USER.username })).toBeInTheDocument();
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

    expect(await screen.findByRole('heading', { name: USER.username })).toBeInTheDocument();
    selectView('My Library');
    expect(await screen.findByRole('heading', { name: 'Loading your library.' })).toBeInTheDocument();
    resolveLibrary(response({ results: [], pagination: { page: 1, perPage: 20, hasMore: false } }));
    expect(await screen.findByRole('heading', { name: 'Your library is clear.' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/me', expect.objectContaining({ credentials: 'same-origin' }));
  });

  it('uses the Goraku logo by default and lets an authenticated User save or remove a profile picture', async () => {
    let currentUser = { ...USER, avatarUpdatedAt: null };
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/me') return Promise.resolve(response(currentUser));
      if (url.startsWith('/api/library?')) return Promise.resolve(response({ results: [], pagination: { page: 1, perPage: 20, hasMore: false } }));
      if (url === '/api/auth/avatar' && options.method === 'PUT') {
        currentUser = { ...currentUser, avatarUpdatedAt: '2026-09-12T00:00:00.000Z' };
        return Promise.resolve(response(currentUser));
      }
      if (url === '/api/auth/avatar' && options.method === 'DELETE') {
        currentUser = { ...currentUser, avatarUpdatedAt: null };
        return Promise.resolve(response(currentUser));
      }
      return Promise.resolve(response(searchPayload([])));
    }));
    render(<App />);
    selectView('Account');

    expect(await screen.findByRole('heading', { name: USER.username })).toBeInTheDocument();
    expect(document.querySelector('.account-profile img')).toHaveAttribute('src', '/mainIcon.svg');
    expect(document.querySelector('.account-profile')?.nextElementSibling).toHaveClass('account-logout');
    expect(screen.queryByText('Your signal is saved.')).not.toBeInTheDocument();

    const file = new File(['image-bytes'], 'avatar.png', { type: 'image/png' });
    fireEvent.click(screen.getByRole('button', { name: 'Edit profile picture' }));
    fireEvent.change(screen.getByLabelText('Choose profile picture'), { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Save photo' }));
    expect(await screen.findByRole('button', { name: 'Use Goraku logo' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/avatar', expect.objectContaining({ method: 'PUT', body: file }));

    fireEvent.click(screen.getByRole('button', { name: 'Use Goraku logo' }));
    expect(await screen.findByRole('button', { name: 'Edit profile picture' })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith('/api/auth/avatar', expect.objectContaining({ method: 'DELETE' }));
    expect(document.querySelector('.account-profile img')).toHaveAttribute('src', '/mainIcon.svg');
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
    fireEvent.change(within(authForm).getByLabelText('Email or username'), { target: { value: USER.username } });
    fireEvent.change(within(authForm).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(authForm);

    expect(await screen.findByText('42')).toBeInTheDocument();
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Save to library' }));
    expect(await screen.findByRole('button', { name: 'Remove from library' })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/library' && options?.method === 'POST' && options.body.includes('"providerId":"43"'))).toBe(true);

    selectView('My Library');
    openTracking();
    const existingStatus = screen.getByLabelText('Library Status for TMDB movie 42');
    fireEvent.change(existingStatus, { target: { value: 'COMPLETED' } });
    await waitFor(() => expect(existingStatus).toHaveValue('COMPLETED'));
    const existingFavorite = screen.getByRole('checkbox', { name: 'Favorite TMDB movie 42' });
    fireEvent.click(existingFavorite);
    await waitFor(() => expect(existingFavorite).toBeChecked());
    fireEvent.click(screen.getByRole('button', { name: /Remove 42/ }));

    await waitFor(() => expect(screen.queryByRole('heading', { name: '42' })).not.toBeInTheDocument());
    expect(fetch.mock.calls.filter(([url, options]) => url === `/api/library/${LIBRARY_ID}` && options?.method === 'PATCH')).toHaveLength(2);
    expect(fetch).toHaveBeenCalledWith(`/api/library/${LIBRARY_ID}`, expect.objectContaining({ method: 'DELETE' }));
  });

  it('offers existing Tags and Collections as direct save destinations', async () => {
    const tag = { id: 'tag-1', name: 'Favorites', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' };
    const collection = { id: 'collection-1', name: 'Weekend queue', createdAt: '2026-09-09T00:00:00.000Z', updatedAt: '2026-09-09T00:00:00.000Z' };
    const existing = libraryItem();
    const saved = libraryItem({ id: '00000000-0000-4000-8000-000000000002', providerId: '43' });
    vi.stubGlobal('fetch', vi.fn((url, options = {}) => {
      if (url === '/api/health') return Promise.resolve(response({ status: 'ok', service: 'goraku-base-api' }));
      if (url === '/api/auth/login') return Promise.resolve(response(USER));
      if (url.startsWith('/api/library?') && options.method === 'GET') return Promise.resolve(response({ results: [existing], pagination: { page: 1, perPage: 20, hasMore: false } }));
      if (url === '/api/tags?page=1&perPage=50') return Promise.resolve(response({ results: [tag], pagination: { page: 1, perPage: 50, hasMore: false } }));
      if (url === '/api/collections?page=1&perPage=50') return Promise.resolve(response({ results: [collection], pagination: { page: 1, perPage: 50, hasMore: false } }));
      if (url === '/api/library' && options.method === 'POST') return Promise.resolve(response(saved, 201));
      if (url === `/api/library/${saved.id}/tags/${tag.id}` && options.method === 'PUT') return Promise.resolve(response(null, 204));
      if (url === `/api/library/${saved.id}/collections/${collection.id}` && options.method === 'PUT') return Promise.resolve(response(null, 204));
      if (url === `/api/library/${saved.id}` && options.method === 'DELETE') return Promise.resolve({ ok: true, status: 204, json: async () => null });
      if (url.startsWith('/api/media/search')) return Promise.resolve(response(searchPayload()));
      return Promise.resolve(response(searchPayload([])));
    }));
    render(<App />);
    selectView('Account');

    const authForm = document.querySelector('.auth-form');
    fireEvent.change(within(authForm).getByLabelText('Email or username'), { target: { value: USER.username } });
    fireEvent.change(within(authForm).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(authForm);

    expect(await screen.findByText('42')).toBeInTheDocument();
    selectView('Search');
    const input = screen.getByRole('searchbox', { name: 'Search anime by title' });
    fireEvent.change(input, { target: { value: 'arrival' } });
    fireEvent.submit(input.closest('form'));
    expect(await screen.findByRole('heading', { name: 'Arrival' })).toBeInTheDocument();

    fireEvent.click(await screen.findByRole('button', { name: 'Save to library' }));
    const dialog = await screen.findByRole('dialog', { name: 'Save Arrival' });
    const saveMode = within(dialog).getByRole('combobox', { name: 'Save method' });
    expect(within(saveMode).getByRole('option', { name: 'Save to Library Only' })).toBeInTheDocument();
    expect(within(saveMode).getByRole('option', { name: 'Save to Tags' })).toBeInTheDocument();
    expect(within(saveMode).getByRole('option', { name: 'Save to Collection' })).toBeInTheDocument();
    expect(within(saveMode).getByRole('option', { name: 'Save to Tags and Collection' })).toBeInTheDocument();
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/library' && options?.method === 'POST')).toBe(false);

    fireEvent.change(saveMode, { target: { value: 'tag-collection' } });
    const tagSelect = within(dialog).getByRole('combobox', { name: 'Tag' });
    const collectionSelect = within(dialog).getByRole('combobox', { name: 'Collection' });
    fireEvent.change(tagSelect, { target: { value: tag.id } });
    expect(fetch.mock.calls.some(([url, options]) => url === '/api/library' && options?.method === 'POST')).toBe(false);
    fireEvent.change(collectionSelect, { target: { value: collection.id } });
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/library/${saved.id}/tags/${tag.id}`, expect.objectContaining({ method: 'PUT' })));
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/library/${saved.id}/collections/${collection.id}`, expect.objectContaining({ method: 'PUT' })));
    const savedButton = await screen.findByRole('button', { name: 'Remove from library' });
    expect(savedButton).toBeInTheDocument();
    expect(screen.queryByRole('dialog', { name: 'Save Arrival' })).not.toBeInTheDocument();

    fireEvent.click(savedButton);
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(`/api/library/${saved.id}`, expect.objectContaining({ method: 'DELETE' })));
    expect(await screen.findByRole('button', { name: 'Save to library' })).toBeInTheDocument();
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
    fireEvent.change(within(authForm).getByLabelText('Email or username'), { target: { value: USER.username } });
    fireEvent.change(within(authForm).getByLabelText('Password'), { target: { value: 'correct horse!' } });
    fireEvent.submit(authForm);

    selectView('My Library');
    expect(await screen.findByRole('heading', { name: 'The library signal did not come through.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry library' })).toBeInTheDocument();
  });
});
