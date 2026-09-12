import { requestJson } from './request.js';

function isDate(value) {
  return value === null || (
    value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.year) && value.year >= 1
    && (value.month === null || (Number.isInteger(value.month) && value.month >= 1 && value.month <= 12))
    && (value.day === null || (Number.isInteger(value.day) && value.day >= 1 && value.day <= 31))
  );
}

function isValidEpisode(episode) {
  return Boolean(
    episode && typeof episode === 'object' && !Array.isArray(episode)
    && Number.isInteger(episode.number) && episode.number >= 1
    && typeof episode.title === 'string' && episode.title.length > 0
    && isDate(episode.airDate)
    && (episode.runtimeMinutes === null || (Number.isInteger(episode.runtimeMinutes) && episode.runtimeMinutes >= 0))
    && (episode.image === null || typeof episode.image === 'string')
  );
}

const EPISODE_PROVIDER_TYPES = Object.freeze({ tmdb: 'TV', anilist: 'ANIME', myanimelist: 'ANIME' });

function invalidEpisodePayload() {
  const error = new Error('The API returned an invalid episode payload.');
  error.code = 'INVALID_PAYLOAD';
  return error;
}

export function isValidMediaEpisodesPayload(payload) {
  return Boolean(
    payload && typeof payload === 'object' && !Array.isArray(payload)
    && EPISODE_PROVIDER_TYPES[payload.provider] === payload.type
    && typeof payload.providerId === 'string'
    && Number.isInteger(payload.season) && payload.season >= 1
    && Array.isArray(payload.episodes)
    && payload.episodes.every(isValidEpisode)
  );
}

function isValidWatchedEpisode(value) {
  return Boolean(
    value && typeof value === 'object' && !Array.isArray(value)
    && Number.isInteger(value.season) && value.season >= 1
    && Number.isInteger(value.episode) && value.episode >= 1
  );
}

function validateWatchedPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) ||
      !Array.isArray(payload.watched) || !payload.watched.every(isValidWatchedEpisode)) {
    throw invalidEpisodePayload();
  }
  return payload;
}

export async function listMediaEpisodes({
  provider = 'tmdb',
  type = 'tv',
  providerId,
  season = 1,
  signal
} = {}) {
  const params = new URLSearchParams({ season: String(season) });
  const payload = await requestJson(
    `/api/media/${encodeURIComponent(provider)}/${encodeURIComponent(type)}/${encodeURIComponent(providerId)}/episodes?${params.toString()}`,
    { signal }
  );
  if (!isValidMediaEpisodesPayload(payload)) throw invalidEpisodePayload();
  return payload;
}

export async function listWatchedEpisodes(libraryItemId, { signal } = {}) {
  const payload = await requestJson(`/api/library/${encodeURIComponent(libraryItemId)}/episodes`, { signal });
  return validateWatchedPayload(payload);
}

export async function setWatchedEpisodes(libraryItemId, episodes, { signal } = {}) {
  const payload = await requestJson(`/api/library/${encodeURIComponent(libraryItemId)}/episodes`, {
    method: 'PUT',
    body: JSON.stringify({ episodes }),
    signal
  });
  return validateWatchedPayload(payload);
}
