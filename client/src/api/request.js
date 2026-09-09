export const DEFAULT_REQUEST_TIMEOUT_MS = 5000;

export class ApiRequestError extends Error {
  constructor(message, code = 'REQUEST_FAILED', { status, details = [] } = {}) {
    super(message);
    this.name = 'ApiRequestError';
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export async function requestJson(url, {
  method = 'GET',
  headers = {},
  body,
  credentials = 'same-origin',
  signal,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
  fetchImplementation = fetch,
  allowEmpty = false
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
    const requestHeaders = { Accept: 'application/json', ...headers };
    if (body !== undefined && !Object.keys(requestHeaders).some((name) => name.toLowerCase() === 'content-type')) {
      requestHeaders['Content-Type'] = 'application/json';
    }
    const requestOptions = {
      method,
      headers: requestHeaders,
      credentials,
      signal: controller.signal
    };
    if (body !== undefined) requestOptions.body = body;

    const response = await fetchImplementation(url, requestOptions);

    if (!response.ok) {
      let errorPayload;
      if (typeof response.json === 'function') {
        try {
          errorPayload = await response.json();
        } catch {
          // Keep the generic HTTP message when an unavailable service returns no JSON.
        }
      }
      const apiError = errorPayload?.error;
      throw new ApiRequestError(
        typeof apiError?.message === 'string' ? apiError.message : `Request failed with HTTP ${response.status}.`,
        typeof apiError?.code === 'string' ? apiError.code : 'HTTP_ERROR',
        { status: response.status, details: Array.isArray(apiError?.details) ? apiError.details : [] }
      );
    }

    if (response.status === 204 && allowEmpty) {
      return null;
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
