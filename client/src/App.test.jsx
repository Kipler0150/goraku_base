import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';
import { selectView } from './test-navigation.js';

describe('welcome page connectivity feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows loading and then connected for a valid health payload', async () => {
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', service: 'goraku-base-api' })
    });

    render(<App />);
    selectView('About & status');

    expect(screen.getByRole('status')).toHaveTextContent('Checking backend connection');
    expect(await screen.findByRole('status')).toHaveTextContent('Backend connected');
    expect(screen.queryByRole('button', { name: 'Retry connection' })).not.toBeInTheDocument();
  });

  it('treats invalid payloads as unavailable', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', service: 'wrong-service' }) });

    render(<App />);
    selectView('About & status');

    expect(await screen.findByRole('status')).toHaveTextContent('Backend unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
  });

  it('treats failed HTTP responses as unavailable', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ status: 'ok' }) });

    render(<App />);
    selectView('About & status');

    expect(await screen.findByRole('status')).toHaveTextContent('Backend unavailable');
  });

  it('allows a keyboard user to retry after the backend recovers', async () => {
    fetch
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({
        ok: false,
        status: 401,
        json: async () => ({ error: { code: 'AUTHENTICATION_REQUIRED', message: 'Authentication is required.', details: [] } })
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', service: 'goraku-base-api' })
      });
    const user = userEvent.setup();

    render(<App />);
    selectView('About & status');

    const retryButton = await screen.findByRole('button', { name: 'Retry connection' });
    retryButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backend connected'));
    expect(fetch).toHaveBeenCalledTimes(3);
  });

  it('shows TMDB credits with the approved logo and required disclaimer', () => {
    render(<App />);
    selectView('About & status');

    const logo = screen.getByRole('img', { name: 'TMDB' });
    expect(logo).toHaveAttribute('src', 'https://www.themoviedb.org/assets/2/v4/logos/primary-green.svg');
    expect(screen.getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'This product uses the TMDB API but is not endorsed or certified by TMDB.'
    );
  });

  it('switches themes and persists the selected presentation mode', async () => {
    const user = userEvent.setup();
    render(<App />);
    selectView('About & status');

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(window.localStorage.getItem('goraku-base-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});
