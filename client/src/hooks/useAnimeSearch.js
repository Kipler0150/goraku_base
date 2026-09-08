import { useMediaSearch } from './useMediaSearch.js';

export function useAnimeSearch() {
  return useMediaSearch({ type: 'anime' });
}
