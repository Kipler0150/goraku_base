import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, login, logout, register } from './auth.js';

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('authentication API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends credential mutations as same-origin JSON and returns the public User', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ id: 'user-1', email: 'reader@example.com' }, true, 201)));

    await expect(register({ email: 'reader@example.com', password: 'correct horse!' })).resolves.toEqual({
      id: 'user-1',
      email: 'reader@example.com'
    });
    expect(fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ email: 'reader@example.com', password: 'correct horse!' })
    }));
  });

  it('loads the current User, logs in, and accepts an empty logout response', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ id: 'user-1', email: 'reader@example.com' }))
      .mockResolvedValueOnce(response({ id: 'user-1', email: 'reader@example.com' }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));

    await expect(getCurrentUser()).resolves.toMatchObject({ id: 'user-1' });
    await expect(login({ email: 'reader@example.com', password: 'correct horse!' })).resolves.toMatchObject({ email: 'reader@example.com' });
    await expect(logout()).resolves.toBeNull();
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });
});
