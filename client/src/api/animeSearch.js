import { isValidMediaSearchPayload, searchMedia } from './mediaSearch.js';

const ANIME_PROVIDERS = new Set(['anilist', 'myanimelist']);

export function isValidAnimeSearchPayload(payload) {
  return isValidMediaSearchPayload(payload) && ANIME_PROVIDERS.has(payload.source);
}

export async function searchAnime(options = {}) {
  const payload = await searchMedia({ ...options, type: 'anime' });
  if (!isValidAnimeSearchPayload(payload)) {
    const error = new Error('The API returned an invalid anime search payload.');
    error.code = 'INVALID_PAYLOAD';
    throw error;
  }
  return payload;
}
