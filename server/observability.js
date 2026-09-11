const DEFAULT_MAX_EVENTS = 1_024;
const SAFE_CACHE_EVENT_TYPES = new Set(['hit', 'miss', 'in-flight-hit', 'store', 'policy-denied']);
const SAFE_OPERATIONS = new Set(['search', 'details', 'trending', 'popular', 'latest', 'recommendations']);
const SAFE_PROVIDERS = new Set(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg', 'combined']);

function emitSafely(onEvent, event) {
  try {
    onEvent(event);
  } catch {
    // Runtime signals must never change application behavior.
  }
}

function finiteDuration(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

function safeOperation(value) {
  return typeof value === 'string' && SAFE_OPERATIONS.has(value) ? value : undefined;
}

function safeProvider(value) {
  return typeof value === 'string' && SAFE_PROVIDERS.has(value) ? value : undefined;
}

/**
 * Create bounded aggregate runtime signals for the public Media boundary.
 * No request query, caller key, credential, Session, Library Item, or
 * tracking value is accepted into an emitted or retained signal.
 */
export function createRuntimeSignals({
  now = Date.now,
  maxEvents = DEFAULT_MAX_EVENTS,
  onEvent = () => {}
} = {}) {
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (!Number.isInteger(maxEvents) || maxEvents < 1) throw new RangeError('maxEvents must be a positive integer.');
  if (typeof onEvent !== 'function') throw new TypeError('onEvent must be a function.');

  const events = [];
  const stats = {
    cacheHits: 0,
    cacheMisses: 0,
    providerRequests: 0,
    rateLimitRejections: 0,
    requestCount: 0,
    requestDurationMs: {
      count: 0,
      total: 0,
      max: 0
    }
  };

  const record = (event) => {
    events.push(event);
    if (events.length > maxEvents) events.shift();
    emitSafely(onEvent, event);
  };

  const recordCacheEvent = (event = {}) => {
    const type = SAFE_CACHE_EVENT_TYPES.has(event.type) ? event.type : 'cache-event';
    if (type === 'hit') stats.cacheHits += 1;
    if (type === 'miss') stats.cacheMisses += 1;
    const safeEvent = {
      type,
      operation: safeOperation(event.operation),
      provider: safeProvider(event.provider)
    };
    record(Object.fromEntries(Object.entries(safeEvent).filter(([, value]) => value !== undefined)));
  };

  const recordProviderRequest = ({ provider, operation } = {}) => {
    stats.providerRequests += 1;
    const safeEvent = {
      type: 'provider-request',
      operation: safeOperation(operation),
      provider: safeProvider(provider)
    };
    record(Object.fromEntries(Object.entries(safeEvent).filter(([, value]) => value !== undefined)));
  };

  const recordRateLimitRejection = () => {
    stats.rateLimitRejections += 1;
    record({ type: 'rate-limit-rejection' });
  };

  const recordRequest = ({ method, httpStatus, durationMs } = {}) => {
    const duration = finiteDuration(durationMs);
    stats.requestCount += 1;
    stats.requestDurationMs.count += 1;
    stats.requestDurationMs.total += duration;
    stats.requestDurationMs.max = Math.max(stats.requestDurationMs.max, duration);

    const safeEvent = {
      type: 'request',
      method: typeof method === 'string' && method.length <= 16 ? method : undefined,
      httpStatus: Number.isInteger(httpStatus) ? httpStatus : undefined,
      durationMs: duration
    };
    record(Object.fromEntries(Object.entries(safeEvent).filter(([, value]) => value !== undefined)));
  };

  const startRequest = ({ method } = {}) => {
    const startedAt = now();
    return (httpStatus) => {
      const finishedAt = now();
      recordRequest({ method, httpStatus, durationMs: finishedAt - startedAt });
    };
  };

  const requestMiddleware = (request, response, next) => {
    const finish = startRequest({ method: request.method });
    response.once('finish', () => finish(response.statusCode));
    next();
  };

  const getStats = () => ({
    ...stats,
    requestDurationMs: { ...stats.requestDurationMs }
  });

  return {
    recordCacheEvent,
    recordProviderRequest,
    recordRateLimitRejection,
    recordRequest,
    startRequest,
    requestMiddleware,
    getStats,
    getEvents() {
      return events.map((event) => ({ ...event }));
    },
    reset() {
      stats.cacheHits = 0;
      stats.cacheMisses = 0;
      stats.providerRequests = 0;
      stats.rateLimitRejections = 0;
      stats.requestCount = 0;
      stats.requestDurationMs.count = 0;
      stats.requestDurationMs.total = 0;
      stats.requestDurationMs.max = 0;
      events.length = 0;
    }
  };
}
