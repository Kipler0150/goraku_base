import { createMedia } from './media.js';

// Synthetic examples only: these do not represent verified provider records.
export const mediaExamples = Object.freeze({
  anime: createMedia({
    provider: 'synthetic-anime', providerId: 'anime-001', type: 'ANIME',
    title: 'Synthetic Moon Archive', releaseDate: { year: 2024, month: 4 },
    providerRating: { value: 87, max: 100 }, releaseStatus: 'ONGOING',
    metadata: { episodeCount: 12, episodeDurationMinutes: 24 }
  }),
  movie: createMedia({
    provider: 'synthetic-film', providerId: 'movie-001', type: 'MOVIE',
    title: 'The Quiet Signal', releaseDate: { year: 2023 },
    providerRating: { value: 4, max: 5 }, releaseStatus: 'RELEASED',
    metadata: { runtimeMinutes: 108 }
  }),
  tv: createMedia({
    provider: 'synthetic-tv', providerId: 'tv-001', type: 'TV', title: 'Northbound',
    releaseStatus: 'ANNOUNCED', metadata: { seasonCount: null, episodeCount: null }
  }),
  game: createMedia({
    provider: 'synthetic-game', providerId: 'game-001', type: 'GAME', title: 'Lantern District',
    releaseStatus: 'UNKNOWN', metadata: { platforms: ['PC', 'Console'], developers: ['Synthetic Studio'], publishers: [] }
  })
});
