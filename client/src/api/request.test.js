import { afterEach, describe, expect, it, vi } from 'vitest';
import { requestJson } from './request.js';

describe('requestJson', () => {
  afterEach(() => vi.useRealTimers());

  it('aborts a request after its bounded duration', async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const pending = requestJson('/api/health', { timeoutMs: 20, fetchImplementation });

    vi.advanceTimersByTime(20);

    await expect(pending).rejects.toMatchObject({ code: 'TIMEOUT' });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it('passes caller cancellation through without reporting a timeout', async () => {
    const externalController = new AbortController();
    const fetchImplementation = vi.fn((_url, { signal }) => new Promise((_resolve, reject) => {
      signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
    }));
    const pending = requestJson('/api/health', { signal: externalController.signal, fetchImplementation });

    externalController.abort();

    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('does not start a request when the caller is already aborted', async () => {
    const externalController = new AbortController();
    externalController.abort();
    const fetchImplementation = vi.fn();

    await expect(requestJson('/api/health', {
      signal: externalController.signal,
      fetchImplementation
    })).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetchImplementation).not.toHaveBeenCalled();
  });
});
