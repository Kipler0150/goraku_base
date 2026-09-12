import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import App from './App.jsx';

describe('compact navigation and authentication actions', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('shows auth actions and hides the About workspace', async () => {
    const user = userEvent.setup();
    fetch.mockResolvedValue({
      ok: true,
      json: async () => ({ status: 'ok', service: 'goraku-base-api' })
    });

    render(<App />);

    expect(screen.queryByRole('button', { name: 'About & status' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: 'Sign up' }).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeInTheDocument();
    expect(screen.queryByText('Connected')).not.toBeInTheDocument();
    expect(screen.queryByText('API status')).not.toBeInTheDocument();
    expect(screen.queryByText('Your media space')).not.toBeInTheDocument();
    expect(screen.queryByText('Save your library')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Account' }));
    expect(screen.getByLabelText('Email or username')).toBeInTheDocument();
    expect(screen.queryByText('Sign in to your signal.')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Register', exact: true })).not.toBeInTheDocument();
    expect(screen.getByText("Don't have an account?")).toBeInTheDocument();
    const authForm = document.querySelector('.auth-form');
    expect(authForm.querySelector('.auth-brand')).not.toBeNull();
    expect(authForm.querySelector('.auth-mode-prompt')).not.toBeNull();
  });

  it('switches themes and persists the selected presentation mode', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(document.documentElement).toHaveAttribute('data-theme', 'dark');
    await user.click(screen.getByRole('button', { name: 'Switch to light mode' }));

    expect(document.documentElement).toHaveAttribute('data-theme', 'light');
    expect(document.documentElement).toHaveClass('theme-transition');
    expect(window.localStorage.getItem('goraku-base-theme')).toBe('light');
    expect(screen.getByRole('button', { name: 'Switch to dark mode' })).toBeInTheDocument();
  });
});
