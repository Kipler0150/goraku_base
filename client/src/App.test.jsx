import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

describe('welcome page connectivity feedback', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
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

    expect(screen.getByRole('status')).toHaveTextContent('Checking backend connection');
    expect(await screen.findByRole('status')).toHaveTextContent('Backend connected');
    expect(screen.queryByRole('button', { name: 'Retry connection' })).not.toBeInTheDocument();
  });

  it('treats invalid payloads as unavailable', async () => {
    fetch.mockResolvedValue({ ok: true, json: async () => ({ status: 'ok', service: 'wrong-service' }) });

    render(<App />);

    expect(await screen.findByRole('status')).toHaveTextContent('Backend unavailable');
    expect(screen.getByRole('button', { name: 'Retry connection' })).toBeInTheDocument();
  });

  it('treats failed HTTP responses as unavailable', async () => {
    fetch.mockResolvedValue({ ok: false, status: 503, json: async () => ({ status: 'ok' }) });

    render(<App />);

    expect(await screen.findByRole('status')).toHaveTextContent('Backend unavailable');
  });

  it('allows a keyboard user to retry after the backend recovers', async () => {
    fetch
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ status: 'ok', service: 'goraku-base-api' })
      });
    const user = userEvent.setup();

    render(<App />);

    const retryButton = await screen.findByRole('button', { name: 'Retry connection' });
    retryButton.focus();
    await user.keyboard('{Enter}');

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Backend connected'));
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('shows TMDB credits with the approved logo and required disclaimer', () => {
    render(<App />);

    const logo = screen.getByRole('img', { name: 'TMDB' });
    expect(logo).toHaveAttribute('src', 'https://www.themoviedb.org/assets/2/v4/logos/primary-green.svg');
    expect(screen.getByRole('link', { name: 'TMDB' })).toHaveAttribute('href', 'https://www.themoviedb.org/');
    expect(screen.getByRole('contentinfo')).toHaveTextContent(
      'This product uses the TMDB API but is not endorsed or certified by TMDB.'
    );
  });
});
