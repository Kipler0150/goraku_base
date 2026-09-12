import { afterEach, describe, expect, it, vi } from 'vitest';
import { getCurrentUser, login, logout, register, removeAvatar, uploadAvatar } from './auth.js';

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

describe('authentication API', () => {
  afterEach(() => vi.restoreAllMocks());

  it('sends credential mutations as same-origin JSON and returns the public User', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response({ id: 'user-1', username: 'reader', email: 'reader@example.com' }, true, 201)));

    await expect(register({ username: 'reader', email: 'reader@example.com', password: 'correct horse!' })).resolves.toEqual({
      id: 'user-1',
      username: 'reader',
      email: 'reader@example.com'
    });
    expect(fetch).toHaveBeenCalledWith('/api/auth/register', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ username: 'reader', email: 'reader@example.com', password: 'correct horse!' })
    }));
  });

  it('loads the current User, logs in, and accepts an empty logout response', async () => {
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ id: 'user-1', username: 'reader', email: 'reader@example.com' }))
      .mockResolvedValueOnce(response({ id: 'user-1', username: 'reader', email: 'reader@example.com' }))
      .mockResolvedValueOnce({ ok: true, status: 204, json: async () => { throw new Error('no body'); } }));

    await expect(getCurrentUser()).resolves.toMatchObject({ id: 'user-1' });
    await expect(login({ identifier: 'reader', password: 'correct horse!' })).resolves.toMatchObject({ email: 'reader@example.com' });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/login', expect.objectContaining({
      method: 'POST',
      credentials: 'same-origin',
      body: JSON.stringify({ identifier: 'reader', password: 'correct horse!' })
    }));
    await expect(logout()).resolves.toBeNull();
    expect(fetch).toHaveBeenNthCalledWith(3, '/api/auth/logout', expect.objectContaining({ method: 'POST' }));
  });

  it('uploads and removes a profile avatar through the authenticated User boundary', async () => {
    const file = new File(['image-bytes'], 'avatar.png', { type: 'image/png' });
    vi.stubGlobal('fetch', vi.fn()
      .mockResolvedValueOnce(response({ id: 'user-1', username: 'reader', email: 'reader@example.com', avatarUpdatedAt: '2026-09-12T00:00:00.000Z' }))
      .mockResolvedValueOnce(response({ id: 'user-1', username: 'reader', email: 'reader@example.com', avatarUpdatedAt: null })));

    await expect(uploadAvatar(file)).resolves.toMatchObject({ avatarUpdatedAt: '2026-09-12T00:00:00.000Z' });
    expect(fetch).toHaveBeenNthCalledWith(1, '/api/auth/avatar', expect.objectContaining({
      method: 'PUT',
      credentials: 'same-origin',
      body: file,
      headers: expect.objectContaining({ 'Content-Type': 'image/png' })
    }));

    await expect(removeAvatar()).resolves.toMatchObject({ avatarUpdatedAt: null });
    expect(fetch).toHaveBeenNthCalledWith(2, '/api/auth/avatar', expect.objectContaining({
      method: 'DELETE',
      credentials: 'same-origin'
    }));
  });
});
