export const PROVIDER_ERROR_CODES = Object.freeze({
  TIMEOUT: 'PROVIDER_TIMEOUT',
  RATE_LIMITED: 'PROVIDER_RATE_LIMITED',
  INVALID_RESPONSE: 'PROVIDER_INVALID_RESPONSE',
  UNAVAILABLE: 'PROVIDER_UNAVAILABLE',
  NOT_FOUND: 'PROVIDER_NOT_FOUND',
  ERROR: 'PROVIDER_ERROR'
});

/**
 * A safe, stable error raised by a provider adapter.
 */
export class ProviderError extends Error {
  /**
   * @param {keyof typeof PROVIDER_ERROR_CODES|string} code
   * @param {string|undefined} message
   */
  constructor(code, message = undefined) {
    super(message ?? 'The provider request failed.');
    this.name = 'ProviderError';
    this.code = code;
  }
}
