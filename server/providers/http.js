import { ProviderError, PROVIDER_ERROR_CODES } from './errors.js';

/**
 * Run one bounded Provider request and decode its JSON response.
 * Provider adapters still own status mapping and response normalization.
 */
export async function requestProviderJson({
  request,
  url,
  options = {},
  timeoutMs,
  invalidResponse,
  errorForStatus
}) {
  const controller = new AbortController();
  let timedOut = false;
  let timeoutHandle;
  const timeoutPromise = new Promise((_, reject) => {
    timeoutHandle = setTimeout(() => {
      timedOut = true;
      controller.abort();
      reject(new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT));
    }, timeoutMs);
  });

  try {
    const response = await Promise.race([
      Promise.resolve().then(() => request(url, { ...options, signal: controller.signal })),
      timeoutPromise
    ]);

    if (!response || typeof response !== 'object') throw invalidResponse();
    const status = response.status;
    if ((status !== undefined && (status < 200 || status >= 300)) || response.ok === false) {
      throw errorForStatus(status);
    }
    if (typeof response.json !== 'function') throw invalidResponse();

    try {
      return await response.json();
    } catch {
      throw invalidResponse();
    }
  } catch (error) {
    if (error instanceof ProviderError) throw error;
    if (timedOut || error?.name === 'AbortError') throw new ProviderError(PROVIDER_ERROR_CODES.TIMEOUT);
    throw new ProviderError(PROVIDER_ERROR_CODES.ERROR);
  } finally {
    clearTimeout(timeoutHandle);
  }
}
