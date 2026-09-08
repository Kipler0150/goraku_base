export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export class ApiRequestError extends Error {
  constructor(message, code = 'REQUEST_FAILED') {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
  }
}

export async function requestJson(url, {
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImplementation = fetch
} = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const abortRequest = () => controller.abort();
  if (signal?.aborted) {
    clearTimeout(timeoutId);
    throw new DOMException('The request was aborted.', 'AbortError');
  }
  signal?.addEventListener('abort', abortRequest, { once: true });

  try {
    const response = await fetchImplementation(url, {
      headers: { Accept: 'application/json' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new ApiRequestError(`Request failed with HTTP ${response.status}.`, 'HTTP_ERROR');
    }

    try {
      return await response.json();
    } catch {
      throw new ApiRequestError('The API returned invalid JSON.', 'INVALID_JSON');
    }
  } catch (error) {
    if (error?.name === 'AbortError') {
      if (signal?.aborted) throw error;
      throw new ApiRequestError('The request took too long.', 'TIMEOUT');
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
    signal?.removeEventListener('abort', abortRequest);
  }
}
