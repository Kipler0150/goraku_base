import { ProviderError, PROVIDER_ERROR_CODES } from './providers/errors.js';
import { filteredProviderForType, hasSearchFilters } from './media-filters.js';

export const PROVIDERS_UNAVAILABLE_CODE = 'PROVIDERS_UNAVAILABLE';
export const MIN_PROVIDER_QUERY_LENGTH = 3;
export const MEDIA_SEARCH_TYPES = Object.freeze(['anime', 'movie', 'tv', 'game', 'all']);

const PROVIDER_CODES = new Set(Object.values(PROVIDER_ERROR_CODES));
const PROVIDER_LABELS = Object.freeze({ anilist: 'AniList', myanimelist: 'MyAnimeList', tmdb: 'TMDB', thegamesdb: 'TheGamesDB', rawg: 'RAWG' });
const DEFAULT_PROVIDERS = Object.freeze({ anime: 'myanimelist', movie: 'tmdb', tv: 'tmdb', game: 'thegamesdb' });
const COMBINED_LANE_TYPES = Object.freeze(['anime', 'movie', 'tv', 'game']);
const COMBINED_LANE_CONFIG = Object.freeze({
  anime: Object.freeze({ provider: 'myanimelist', perPage: 12 }),
  movie: Object.freeze({ provider: 'tmdb', perPage: 20 }),
  tv: Object.freeze({ provider: 'tmdb', perPage: 20 }),
  game: Object.freeze({ provider: 'thegamesdb', perPage: 20 })
});
const PROVIDER_SOURCES = new Set(['anilist', 'myanimelist', 'tmdb', 'thegamesdb', 'rawg']);
const DEFAULT_LATEST_PROVIDERS = Object.freeze({ anime: 'myanimelist', movie: 'tmdb', tv: 'tmdb', game: 'rawg' });

export function formatProviderFailure(error, provider) {
  const code = error instanceof ProviderError && PROVIDER_CODES.has(error.code)
    ? error.code
    : PROVIDER_ERROR_CODES.ERROR;
  const label = PROVIDER_LABELS[provider] ?? 'Provider';
  const messages = {
    [PROVIDER_ERROR_CODES.TIMEOUT]: `${label} did not respond within the allowed time.`,
    [PROVIDER_ERROR_CODES.RATE_LIMITED]: `${label} rate limit reached.`,
    [PROVIDER_ERROR_CODES.INVALID_RESPONSE]: `${label} returned an invalid response.`,
    [PROVIDER_ERROR_CODES.UNAVAILABLE]: `${label} is currently unavailable.`,
    [PROVIDER_ERROR_CODES.NOT_FOUND]: `${label} media was not found.`,
    [PROVIDER_ERROR_CODES.ERROR]: `${label} request failed.`
  };
  return { code, message: messages[code] };
}

export function providersUnavailable(type = 'anime') {
  if (type === 'all') {
    return {
      code: PROVIDERS_UNAVAILABLE_CODE,
      message: 'The configured providers are currently unavailable.'
    };
  }
  const label = type === 'anime' ? 'anime' : type === 'movie' ? 'movie' : type === 'game' ? 'game' : 'TV';
  return {
    code: PROVIDERS_UNAVAILABLE_CODE,
    message: `The configured ${label} providers are currently unavailable.`
  };
}

function providerFailureEntry(error, provider) {
  const failure = formatProviderFailure(error, provider);
  return { provider, code: failure.code, message: failure.message };
}

function failureRecord(error, provider) {
  return { provider, code: providerFailureEntry(error, provider).code };
}

function failureRecords(error, providers) {
  return providers.map((provider) => failureRecord(error, provider));
}

function mergeFailureRecords(...groups) {
  const records = [];
  const seen = new Set();
  for (const group of groups) {
    for (const record of group ?? []) {
      const key = `${record.provider}:${record.code}`;
      if (seen.has(key)) continue;
      seen.add(key);
      records.push(record);
    }
  }
  return records;
}

function publicFailureEntries(records) {
  return records.map((record) => {
    const failure = formatProviderFailure(new ProviderError(record.code), record.provider);
    return { provider: record.provider, code: failure.code, message: failure.message };
  });
}

function isProviderUnavailable(error) {
  return error instanceof ProviderError && error.code === PROVIDER_ERROR_CODES.UNAVAILABLE;
}

function isDisabled(adapter) {
  return adapter?.enabled === false;
}

async function callProvider(adapter, validated, provider = validated.provider, onProviderRequest = () => {}) {
  if (isDisabled(adapter)) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  const {
    provider: _provider,
    type,
    cursor: _cursor,
    retryProvider: _retryProvider,
    filters: validatedFilters,
    ...sharedOptions
  } = validated;
  if (hasSearchFilters(validatedFilters)) sharedOptions.filters = validatedFilters;
  const providerOptions = provider === 'tmdb' ? { type, ...sharedOptions } : sharedOptions;
  const search = adapter?.searchMedia ?? adapter?.searchAnime;
  if (typeof search !== 'function') throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  try {
    onProviderRequest({ provider, operation: 'search' });
  } catch {
    // Observability must never change Provider behavior.
  }
  return search.call(adapter, providerOptions);
}

async function callLatestProvider(adapter, validated, provider, onProviderRequest = () => {}) {
  if (isDisabled(adapter)) throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  const {
    provider: _provider,
    type,
    query: _query,
    cursor: _cursor,
    retryProvider: _retryProvider,
    filters: _filters,
    ...sharedOptions
  } = validated;
  const latest = adapter?.getLatest ?? adapter?.getLatestMedia;
  if (typeof latest !== 'function') throw new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE);
  const providerOptions = provider === 'tmdb' ? { type, ...sharedOptions } : sharedOptions;
  try {
    onProviderRequest({ provider, operation: 'latest' });
  } catch {
    // Observability must never change Provider behavior.
  }
  return latest.call(adapter, providerOptions);
}

function normalizeSearchResponse(result, source, providerErrors = []) {
  if (!result || typeof result !== 'object' || Array.isArray(result) || !Array.isArray(result.results)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!result.pagination || typeof result.pagination !== 'object' || Array.isArray(result.pagination)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  const { page, perPage, hasMore } = result.pagination;
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(perPage) || perPage < 1 || typeof hasMore !== 'boolean') {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  if (!PROVIDER_SOURCES.has(source)) {
    throw new ProviderError(PROVIDER_ERROR_CODES.INVALID_RESPONSE);
  }
  return {
    results: result.results,
    source,
    pagination: { page, perPage, hasMore },
    providerErrors
  };
}

function combinedFailure(type = 'anime') {
  return Object.assign(new Error(providersUnavailable(type).message), { combined: true, mediaType: type });
}

function combinedValidationError(message, field = 'cursor') {
  return Object.assign(new Error(message), {
    validationDetails: [{ field, message }]
  });
}

function initialLaneState({ provider, perPage }) {
  return {
    provider,
    nextPage: 1,
    lastPage: null,
    perPage,
    hasMore: true,
    failed: false,
    failures: []
  };
}

function createInitialCombinedState(validated) {
  return {
    version: 1,
    query: validated.query,
    includeAdult: validated.includeAdult,
    perPage: validated.perPage,
    page: 1,
    lanes: Object.fromEntries(
      COMBINED_LANE_TYPES.map((type) => [type, initialLaneState(COMBINED_LANE_CONFIG[type])])
    )
  };
}

function encodeContinuation(state) {
  return Buffer.from(JSON.stringify(state), 'utf8').toString('base64url');
}

function isPositiveInteger(value) {
  return Number.isInteger(value) && value >= 1;
}

function decodeContinuation(cursor) {
  if (typeof cursor !== 'string' || !cursor || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw combinedValidationError('cursor must be a valid continuation value.');
  }

  let state;
  try {
    state = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw combinedValidationError('cursor must be a valid continuation value.');
  }

  if (!state || typeof state !== 'object' || Array.isArray(state) || state.version !== 1 ||
      typeof state.query !== 'string' || typeof state.includeAdult !== 'boolean' ||
      !isPositiveInteger(state.perPage) || !isPositiveInteger(state.page) ||
      !state.lanes || typeof state.lanes !== 'object' || Array.isArray(state.lanes)) {
    throw combinedValidationError('cursor must be a valid continuation value.');
  }

  for (const type of COMBINED_LANE_TYPES) {
    const lane = state.lanes[type];
    const allowedProviders = type === 'anime'
      ? ['anilist', 'myanimelist']
      : type === 'game' ? ['thegamesdb', 'rawg'] : [COMBINED_LANE_CONFIG[type].provider];
    if (!lane || typeof lane !== 'object' || Array.isArray(lane) || !allowedProviders.includes(lane.provider) ||
        !isPositiveInteger(lane.nextPage) || (lane.lastPage !== null && !isPositiveInteger(lane.lastPage)) ||
        !isPositiveInteger(lane.perPage) || typeof lane.hasMore !== 'boolean' ||
        typeof lane.failed !== 'boolean' || !Array.isArray(lane.failures) ||
        lane.failures.some((failure) => !failure || !allowedProviders.includes(failure.provider) || !PROVIDER_CODES.has(failure.code))) {
      throw combinedValidationError('cursor must be a valid continuation value.');
    }
  }

  return state;
}

function validateCombinedCursor(validated) {
  if (!validated.cursor) {
    if (validated.page !== 1) throw combinedValidationError('page must be 1 when cursor is not supplied.', 'page');
    if (validated.retryProvider) throw combinedValidationError('retryProvider requires a cursor.', 'retryProvider');
    return createInitialCombinedState(validated);
  }

  const state = decodeContinuation(validated.cursor);
  if (state.query !== validated.query || state.includeAdult !== validated.includeAdult || state.perPage !== validated.perPage) {
    throw combinedValidationError('cursor does not match the current search options.');
  }
  if (state.page !== validated.page) {
    throw combinedValidationError('page does not match the continuation cursor.', 'page');
  }
  return state;
}

async function searchAnimeLane(validated, laneState, adapters, onProviderRequest) {
  const selectedProvider = validated.retryProvider && laneState.failed
    ? validated.retryProvider
    : laneState.provider;
  if (selectedProvider === 'anilist') {
    try {
      const result = await callProvider(
        adapters.anilist,
        { ...validated, type: 'anime', provider: 'anilist', page: laneState.nextPage, perPage: 12 },
        'anilist',
        onProviderRequest
      );
      return {
        success: true,
        response: normalizeSearchResponse(result, 'anilist'),
        failures: [],
        attemptedProviders: ['anilist']
      };
    } catch (error) {
      return { success: false, failures: [failureRecord(error, 'anilist')], attemptedProviders: ['anilist'] };
    }
  }

  try {
    const result = await callProvider(
      adapters.myanimelist,
      { ...validated, type: 'anime', provider: 'myanimelist', page: laneState.nextPage, perPage: 12 },
      'myanimelist',
      onProviderRequest
    );
    return {
      success: true,
      response: normalizeSearchResponse(result, 'myanimelist'),
      failures: [],
      attemptedProviders: ['myanimelist']
    };
  } catch (myanimelistError) {
    if (!isProviderUnavailable(myanimelistError) || isDisabled(adapters.anilist)) {
      return { success: false, failures: [failureRecord(myanimelistError, 'myanimelist')], attemptedProviders: ['myanimelist'] };
    }

    try {
      const result = await callProvider(
        adapters.anilist,
        { ...validated, type: 'anime', provider: 'anilist', page: laneState.nextPage, perPage: 12 },
        'anilist',
        onProviderRequest
      );
      return {
        success: true,
        response: normalizeSearchResponse(result, 'anilist'),
        failures: [failureRecord(myanimelistError, 'myanimelist')],
        attemptedProviders: ['myanimelist', 'anilist']
      };
    } catch (anilistError) {
      return {
        success: false,
        failures: failureRecords(myanimelistError, ['myanimelist']).concat(failureRecord(anilistError, 'anilist')),
        attemptedProviders: ['myanimelist', 'anilist']
      };
    }
  }
}

async function searchGameLane(validated, laneState, adapters, onProviderRequest) {
  const selectedProvider = validated.retryProvider && laneState.failed
    ? validated.retryProvider
    : laneState.provider;
  if (selectedProvider === 'rawg') {
    try {
      const result = await callProvider(
        adapters.rawg,
        { ...validated, type: 'game', provider: 'rawg', page: laneState.nextPage, perPage: 20 },
        'rawg',
        onProviderRequest
      );
      return {
        success: true,
        response: normalizeSearchResponse(result, 'rawg'),
        failures: [],
        attemptedProviders: ['rawg']
      };
    } catch (error) {
      return { success: false, failures: [failureRecord(error, 'rawg')], attemptedProviders: ['rawg'] };
    }
  }

  try {
    const result = await callProvider(
      adapters.thegamesdb,
      { ...validated, type: 'game', provider: 'thegamesdb', page: laneState.nextPage, perPage: 20 },
      'thegamesdb',
      onProviderRequest
    );
    return {
      success: true,
      response: normalizeSearchResponse(result, 'thegamesdb'),
      failures: [],
      attemptedProviders: ['thegamesdb']
    };
  } catch (theGamesDBError) {
    if (!isProviderUnavailable(theGamesDBError) || isDisabled(adapters.rawg)) {
      return { success: false, failures: [failureRecord(theGamesDBError, 'thegamesdb')], attemptedProviders: ['thegamesdb'] };
    }

    try {
      const result = await callProvider(
        adapters.rawg,
        { ...validated, type: 'game', provider: 'rawg', page: laneState.nextPage, perPage: 20 },
        'rawg',
        onProviderRequest
      );
      return {
        success: true,
        response: normalizeSearchResponse(result, 'rawg'),
        failures: [failureRecord(theGamesDBError, 'thegamesdb')],
        attemptedProviders: ['thegamesdb', 'rawg']
      };
    } catch (rawgError) {
      return {
        success: false,
        failures: [failureRecord(theGamesDBError, 'thegamesdb'), failureRecord(rawgError, 'rawg')],
        attemptedProviders: ['thegamesdb', 'rawg']
      };
    }
  }
}

async function latestCombinedLane(type, validated, laneState, adapters, onProviderRequest) {
  const preferredProvider = type === 'game' && laneState.provider === 'thegamesdb' ? 'rawg' : laneState.provider;
  const latestOptions = {
    ...validated,
    type,
    provider: preferredProvider,
    page: laneState.nextPage,
    perPage: COMBINED_LANE_CONFIG[type].perPage
  };
  try {
    const result = await callLatestProvider(adapters[preferredProvider], latestOptions, preferredProvider, onProviderRequest);
    return {
      success: true,
      response: normalizeSearchResponse(result, preferredProvider),
      failures: [],
      attemptedProviders: [preferredProvider]
    };
  } catch (preferredError) {
    if (type !== 'anime' || preferredProvider !== 'myanimelist' || isDisabled(adapters.anilist) || !isProviderUnavailable(preferredError)) {
      return { success: false, failures: [failureRecord(preferredError, preferredProvider)], attemptedProviders: [preferredProvider] };
    }
    try {
      const result = await callLatestProvider(
        adapters.anilist,
        { ...latestOptions, provider: 'anilist' },
        'anilist',
        onProviderRequest
      );
      return {
        success: true,
        response: normalizeSearchResponse(result, 'anilist'),
        failures: [failureRecord(preferredError, 'myanimelist')],
        attemptedProviders: ['myanimelist', 'anilist']
      };
    } catch (fallbackError) {
      return {
        success: false,
        failures: [failureRecord(preferredError, 'myanimelist'), failureRecord(fallbackError, 'anilist')],
        attemptedProviders: ['myanimelist', 'anilist']
      };
    }
  }
}

async function searchCombinedLane(type, validated, laneState, adapters, onProviderRequest) {
  if (!validated.query) return latestCombinedLane(type, validated, laneState, adapters, onProviderRequest);
  if (type === 'anime') return searchAnimeLane(validated, laneState, adapters, onProviderRequest);
  if (type === 'game') return searchGameLane(validated, laneState, adapters, onProviderRequest);

  const provider = COMBINED_LANE_CONFIG[type].provider;
  try {
    const result = await callProvider(
      adapters[provider],
      {
        ...validated,
        type,
        provider,
        page: laneState.nextPage,
        perPage: COMBINED_LANE_CONFIG[type].perPage
      },
      provider,
      onProviderRequest
    );
    return {
      success: true,
      response: normalizeSearchResponse(result, provider),
      failures: [],
      attemptedProviders: [provider]
    };
  } catch (error) {
    return { success: false, failures: [failureRecord(error, provider)], attemptedProviders: [provider] };
  }
}

function updateLaneState(laneState, outcome) {
  if (!outcome.success) {
    return {
      ...laneState,
      failed: true,
      failures: mergeFailureRecords(laneState.failures, outcome.failures)
    };
  }

  const { response } = outcome;
  const retainedFailures = laneState.failures.filter((failure) => !outcome.attemptedProviders.includes(failure.provider));
  return {
    ...laneState,
    provider: response.source,
    nextPage: response.pagination.hasMore ? response.pagination.page + 1 : response.pagination.page,
    lastPage: response.pagination.page,
    perPage: response.pagination.perPage,
    hasMore: response.pagination.hasMore,
    failed: false,
    failures: mergeFailureRecords(retainedFailures, outcome.failures)
  };
}

function combinedProviderPagination(state) {
  const providers = {};
  for (const type of COMBINED_LANE_TYPES) {
    const lane = state.lanes[type];
    if (lane.lastPage === null) continue;
    const current = {
      page: lane.lastPage,
      perPage: lane.perPage,
      hasMore: lane.hasMore
    };
    const existing = providers[lane.provider];
    providers[lane.provider] = existing
      ? {
        page: Math.max(existing.page, current.page),
        perPage: current.perPage,
        hasMore: existing.hasMore || current.hasMore
      }
      : current;
  }
  return providers;
}

function combinedResponse(results, state, page) {
  const providerErrors = publicFailureEntries(
    mergeFailureRecords(...COMBINED_LANE_TYPES.map((type) => state.lanes[type].failures))
  );
  const hasMore = COMBINED_LANE_TYPES.some((type) => state.lanes[type].hasMore || state.lanes[type].failed);
  const continuationState = { ...state, page: page + 1 };
  return {
    results,
    source: 'combined',
    pagination: {
      page,
      hasMore,
      providers: combinedProviderPagination(state),
      continuation: hasMore ? encodeContinuation(continuationState) : null
    },
    providerErrors
  };
}

async function searchCombined(validated, adapters, onProviderRequest) {
  const state = validateCombinedCursor(validated);
  if (validated.query.length > 0 && validated.query.length < MIN_PROVIDER_QUERY_LENGTH && !validated.cursor) {
    for (const type of COMBINED_LANE_TYPES) {
      const lane = state.lanes[type];
      lane.lastPage = 1;
      lane.nextPage = 1;
      lane.hasMore = false;
    }
    return combinedResponse([], state, 1);
  }

  const retryProvider = validated.retryProvider;
  const laneTypes = retryProvider
    ? COMBINED_LANE_TYPES.filter((type) => state.lanes[type].failed && state.lanes[type].failures.some((failure) => failure.provider === retryProvider))
    : validated.cursor
      ? COMBINED_LANE_TYPES.filter((type) => state.lanes[type].hasMore)
      : COMBINED_LANE_TYPES;

  if (retryProvider && laneTypes.length === 0) {
    throw combinedValidationError('retryProvider does not identify a failed lane in the continuation cursor.');
  }

  const settled = await Promise.allSettled(
    laneTypes.map(async (type) => ({ type, outcome: await searchCombinedLane(type, validated, state.lanes[type], adapters, onProviderRequest) }))
  );
  const outcomes = new Map();
  for (const [index, result] of settled.entries()) {
    if (result.status === 'fulfilled') {
      outcomes.set(result.value.type, result.value.outcome);
      continue;
    }
    const type = laneTypes[index];
    const provider = state.lanes[type].provider;
    outcomes.set(type, { success: false, failures: [{ provider, code: PROVIDER_ERROR_CODES.ERROR }] });
  }

  const results = [];
  for (const type of COMBINED_LANE_TYPES) {
    const outcome = outcomes.get(type);
    if (!outcome) continue;
    state.lanes[type] = updateLaneState(state.lanes[type], outcome);
    if (outcome.success) results.push(...outcome.response.results);
  }
  state.page = validated.page;

  if (COMBINED_LANE_TYPES.every((type) => state.lanes[type].failed)) throw combinedFailure('all');
  return combinedResponse(results, state, validated.page);
}

/**
 * Coordinate provider-owned typed pages and independent Combined Search lanes.
 * HTTP status and error-envelope concerns stay in the Express route layer.
 */
export function createMediaSearchService({
  anilistAdapter,
  myanimelistAdapter,
  tmdbAdapter,
  thegamesdbAdapter,
  rawgAdapter,
  onProviderRequest = () => {}
}) {
  const adapters = {
    anilist: anilistAdapter,
    myanimelist: myanimelistAdapter,
    tmdb: tmdbAdapter,
    thegamesdb: thegamesdbAdapter,
    rawg: rawgAdapter
  };

  return {
    async search(validated) {
      const type = validated.type ?? 'anime';
      if (type === 'all') return searchCombined(validated, adapters, onProviderRequest);

      if (hasSearchFilters(validated.filters)) {
        const provider = filteredProviderForType(type);
        if (!provider || isDisabled(adapters[provider])) {
          throw Object.assign(new ProviderError(PROVIDER_ERROR_CODES.UNAVAILABLE), { provider });
        }
        if (type !== 'movie' && type !== 'tv' && validated.query.length > 0 && validated.query.length < MIN_PROVIDER_QUERY_LENGTH) {
          return normalizeSearchResponse({
            results: [],
            pagination: { page: validated.page, perPage: validated.perPage, hasMore: false }
          }, provider);
        }
        try {
          return normalizeSearchResponse(
            await callProvider(adapters[provider], { ...validated, provider }, provider, onProviderRequest),
            provider
          );
        } catch (error) {
          throw Object.assign(error, { provider });
        }
      }

      const defaultProvider = DEFAULT_PROVIDERS[type] ?? 'myanimelist';

      if (!validated.query) {
        const provider = validated.provider ?? DEFAULT_LATEST_PROVIDERS[type] ?? defaultProvider;
        if (type === 'anime' && !validated.provider) {
          try {
            return normalizeSearchResponse(
              await callLatestProvider(myanimelistAdapter, { ...validated, provider }, provider, onProviderRequest),
              provider
            );
          } catch (myanimelistError) {
            if (!isProviderUnavailable(myanimelistError) || isDisabled(anilistAdapter)) {
              if (isProviderUnavailable(myanimelistError)) throw combinedFailure(type);
              throw Object.assign(myanimelistError, { provider });
            }
            try {
              return normalizeSearchResponse(
                await callLatestProvider(anilistAdapter, { ...validated, provider: 'anilist' }, 'anilist', onProviderRequest),
                'anilist',
                [providerFailureEntry(myanimelistError, 'myanimelist')]
              );
            } catch (anilistError) {
              if (isProviderUnavailable(anilistError)) throw combinedFailure(type);
              throw Object.assign(anilistError, { provider: 'anilist' });
            }
          }
        }
        try {
          return normalizeSearchResponse(
            await callLatestProvider(adapters[provider], { ...validated, provider }, provider, onProviderRequest),
            provider
          );
        } catch (error) {
          throw Object.assign(error, { provider });
        }
      }

      if (validated.query.length < MIN_PROVIDER_QUERY_LENGTH) {
        return normalizeSearchResponse({
          results: [],
          pagination: { page: validated.page, perPage: validated.perPage, hasMore: false }
        }, validated.provider ?? defaultProvider);
      }

      if (type === 'game' && !validated.provider) {
        try {
          return normalizeSearchResponse(
            await callProvider(adapters.thegamesdb, validated, 'thegamesdb', onProviderRequest),
            'thegamesdb'
          );
        } catch (theGamesDBError) {
          if (!isProviderUnavailable(theGamesDBError) || isDisabled(adapters.rawg)) {
            throw Object.assign(theGamesDBError, { provider: 'thegamesdb' });
          }
          try {
            return normalizeSearchResponse(
              await callProvider(adapters.rawg, { ...validated, provider: 'rawg' }, 'rawg', onProviderRequest),
              'rawg',
              [providerFailureEntry(theGamesDBError, 'thegamesdb')]
            );
          } catch (rawgError) {
            throw Object.assign(rawgError, { provider: 'rawg' });
          }
        }
      }

      if (type !== 'anime') {
        const provider = validated.provider ?? defaultProvider;
        try {
          return normalizeSearchResponse(await callProvider(adapters[provider], validated, provider, onProviderRequest), provider);
        } catch (error) {
          throw Object.assign(error, { provider });
        }
      }

      if (validated.provider) {
        const adapter = adapters[validated.provider];
        try {
          return normalizeSearchResponse(await callProvider(adapter, validated, validated.provider, onProviderRequest), validated.provider);
        } catch {
          throw combinedFailure(type);
        }
      }

      try {
        return normalizeSearchResponse(await callProvider(myanimelistAdapter, validated, 'myanimelist', onProviderRequest), 'myanimelist');
      } catch (myanimelistError) {
        if (!isProviderUnavailable(myanimelistError) || isDisabled(anilistAdapter)) {
          if (isProviderUnavailable(myanimelistError)) throw combinedFailure(type);
          throw Object.assign(myanimelistError, { provider: 'myanimelist' });
        }

        try {
          return normalizeSearchResponse(
            await callProvider(anilistAdapter, { ...validated, provider: 'anilist' }, 'anilist', onProviderRequest),
            'anilist',
            [providerFailureEntry(myanimelistError, 'myanimelist')]
          );
        } catch (anilistError) {
          if (isProviderUnavailable(anilistError)) throw combinedFailure(type);
          throw Object.assign(anilistError, { provider: 'anilist' });
        }
      }
    }
  };
}
