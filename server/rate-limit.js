const ONE_MINUTE_MS = 60_000;

export const DEFAULT_APPLICATION_RATE_LIMIT = Object.freeze({
  tokensPerMinute: 60,
  burstCapacity: 10
});

export const APPLICATION_RATE_LIMIT_ERROR = Object.freeze({
  code: 'APPLICATION_RATE_LIMITED',
  message: 'Too many media requests. Please retry later.',
  details: []
});

const ENVIRONMENT_FIELDS = Object.freeze({
  tokensPerMinute: 'MEDIA_RATE_LIMIT_PER_MINUTE',
  burstCapacity: 'MEDIA_RATE_LIMIT_BURST'
});

function positiveFiniteNumber(value, field) {
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(number) || number <= 0) {
    throw new RangeError(`${field} must be a positive finite number.`);
  }
  return number;
}

function positiveInteger(value, field) {
  const number = positiveFiniteNumber(value, field);
  if (!Number.isInteger(number)) throw new RangeError(`${field} must be a positive integer.`);
  return number;
}

function environmentValue(environment, name) {
  const value = environment?.[name];
  return value === '' ? undefined : value;
}

/**
 * Read the public media Application Rate Limit from server-only environment
 * configuration.
 */
export function readApplicationRateLimitConfig(environment = process.env) {
  const tokensPerMinute = environmentValue(environment, ENVIRONMENT_FIELDS.tokensPerMinute);
  const burstCapacity = environmentValue(environment, ENVIRONMENT_FIELDS.burstCapacity);
  return {
    tokensPerMinute: tokensPerMinute === undefined
      ? DEFAULT_APPLICATION_RATE_LIMIT.tokensPerMinute
      : positiveFiniteNumber(tokensPerMinute, 'tokensPerMinute'),
    burstCapacity: burstCapacity === undefined
      ? DEFAULT_APPLICATION_RATE_LIMIT.burstCapacity
      : positiveInteger(burstCapacity, 'burstCapacity')
  };
}

function normalizeRateLimitOptions(options = {}) {
  const tokensPerMinute = options.tokensPerMinute ?? DEFAULT_APPLICATION_RATE_LIMIT.tokensPerMinute;
  const burstCapacity = options.burstCapacity ?? DEFAULT_APPLICATION_RATE_LIMIT.burstCapacity;

  return {
    tokensPerMinute: positiveFiniteNumber(tokensPerMinute, 'tokensPerMinute'),
    burstCapacity: positiveInteger(burstCapacity, 'burstCapacity')
  };
}

function defaultKeyResolver(request) {
  const remoteAddress = request?.socket?.remoteAddress ?? request?.connection?.remoteAddress;
  return typeof remoteAddress === 'string' && remoteAddress ? remoteAddress : 'unknown';
}

function defaultNow() {
  return Date.now();
}

function retryAfterSeconds(tokensNeeded, tokensPerMinute) {
  const tokensPerMillisecond = tokensPerMinute / ONE_MINUTE_MS;
  return Math.max(1, Math.ceil(tokensNeeded / tokensPerMillisecond / 1_000));
}

/**
 * Create a deterministic process-local token bucket.
 *
 * The bucket is keyed by an already-resolved caller key. HTTP concerns such
 * as proxy trust and the response envelope belong to the middleware below.
 */
export function createTokenBucket({
  tokensPerMinute,
  burstCapacity,
  now = defaultNow,
  resolveKey = defaultKeyResolver
} = {}) {
  const config = normalizeRateLimitOptions({
    tokensPerMinute,
    burstCapacity
  });
  if (typeof now !== 'function') throw new TypeError('now must be a function.');
  if (typeof resolveKey !== 'function') throw new TypeError('resolveKey must be a function.');

  const buckets = new Map();
  const refillRatePerMillisecond = config.tokensPerMinute / ONE_MINUTE_MS;

  function currentTime() {
    const value = now();
    if (!Number.isFinite(value)) throw new TypeError('now must return a finite number.');
    return value;
  }

  function consume(key, amount = 1) {
    if (typeof key !== 'string' || !key) throw new TypeError('key must be a non-empty string.');
    const requested = positiveFiniteNumber(amount, 'amount');
    if (requested > config.burstCapacity) {
      throw new RangeError('amount cannot exceed burstCapacity.');
    }

    const time = currentTime();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = { tokens: config.burstCapacity, updatedAt: time };
      buckets.set(key, bucket);
    } else {
      const elapsed = Math.max(0, time - bucket.updatedAt);
      bucket.tokens = Math.min(config.burstCapacity, bucket.tokens + elapsed * refillRatePerMillisecond);
      bucket.updatedAt = Math.max(bucket.updatedAt, time);
    }

    if (bucket.tokens < requested) {
      const retryAfter = retryAfterSeconds(requested - bucket.tokens, config.tokensPerMinute);
      return {
        allowed: false,
        remaining: bucket.tokens,
        retryAfter
      };
    }

    bucket.tokens -= requested;
    return {
      allowed: true,
      remaining: bucket.tokens,
      retryAfter: 0
    };
  }

  return {
    consume,
    get size() {
      return buckets.size;
    },
    clear() {
      buckets.clear();
    },
    getConfig() {
      return { ...config };
    }
  };
}

/**
 * Resolve the caller address after Express has applied its configured trust
 * proxy policy. With the default false policy, forwarded headers are ignored
 * and the socket address is used directly.
 */
export function resolveClientIp(request) {
  const trustProxy = request?.app?.get?.('trust proxy');
  if (trustProxy) {
    const forwardedAddress = request?.ip;
    if (typeof forwardedAddress === 'string' && forwardedAddress) return forwardedAddress;
  }
  return defaultKeyResolver(request);
}

/**
 * Create the HTTP-facing Application Rate Limit middleware.
 */
export function createApplicationRateLimiter({
  tokensPerMinute,
  burstCapacity,
  now = defaultNow,
  resolveKey = resolveClientIp,
  onRejection = () => {},
  error = APPLICATION_RATE_LIMIT_ERROR
} = {}) {
  const bucket = createTokenBucket({
    tokensPerMinute,
    burstCapacity,
    now,
    resolveKey
  });
  if (typeof onRejection !== 'function') throw new TypeError('onRejection must be a function.');

  const middleware = (request, response, next) => {
    let key;
    try {
      key = resolveKey(request);
      const result = bucket.consume(key);
      if (result.allowed) {
        next();
        return;
      }

      response.set('Retry-After', String(result.retryAfter));
      response.status(429).json({
        error: {
          code: error.code,
          message: error.message,
          details: []
        }
      });
      try {
        onRejection({ type: 'rate-limit-rejection' });
      } catch {
        // Runtime signals must never change request behavior.
      }
    } catch (rateLimitError) {
      next(rateLimitError);
    }
  };

  return {
    middleware,
    consume(request, amount = 1) {
      return bucket.consume(resolveKey(request), amount);
    },
    clear() {
      bucket.clear();
    },
    get size() {
      return bucket.size;
    },
    getConfig() {
      return bucket.getConfig();
    }
  };
}
