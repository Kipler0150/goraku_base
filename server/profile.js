import sharp from 'sharp';

export const PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const PROFILE_AVATAR_SIZE = 256;
export const PROFILE_AVATAR_CONTENT_TYPES = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const SIGNATURES = Object.freeze([
  { contentType: 'image/jpeg', matches: (data) => data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff },
  { contentType: 'image/png', matches: (data) => data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { contentType: 'image/webp', matches: (data) => data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP' }
]);

export class ProfileValidationError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'ProfileValidationError';
    this.code = 'VALIDATION_ERROR';
    this.details = details;
  }
}

function profileValidationError(field, message) {
  return new ProfileValidationError('The profile picture is invalid.', [{ field, message }]);
}

function detectContentType(data) {
  return SIGNATURES.find((signature) => signature.matches(data))?.contentType ?? null;
}

/**
 * Validate and normalize an uploaded profile picture. The decoded image is
 * rotated according to its EXIF orientation, center-cropped to a square, and
 * re-encoded as metadata-free WebP so the storage boundary stays bounded.
 *
 * @param {{ data?: Buffer, contentType?: string }} options
 * @returns {Promise<{ data: Buffer, contentType: string }>}
 */
export async function normalizeProfileAvatar({ data, contentType } = {}) {
  if (!Buffer.isBuffer(data) || data.length === 0) {
    throw profileValidationError('avatar', 'Choose a JPG, PNG, or WebP image.');
  }
  if (data.length > PROFILE_AVATAR_MAX_BYTES) {
    throw profileValidationError('avatar', 'Profile pictures must be 2 MB or smaller.');
  }

  const detectedContentType = detectContentType(data);
  if (!detectedContentType || (contentType && contentType !== detectedContentType)) {
    throw profileValidationError('avatar', 'Choose a valid JPG, PNG, or WebP image.');
  }

  try {
    const image = sharp(data, { limitInputPixels: 25_000_000, sequentialRead: true });
    const metadata = await image.metadata();
    if (metadata.pages && metadata.pages > 1) {
      throw profileValidationError('avatar', 'Animated profile pictures are not supported.');
    }

    const normalized = await image
      .rotate()
      .resize(PROFILE_AVATAR_SIZE, PROFILE_AVATAR_SIZE, { fit: 'cover', position: 'centre' })
      .webp({ quality: 85 })
      .toBuffer();

    return { data: normalized, contentType: 'image/webp' };
  } catch (error) {
    if (error instanceof ProfileValidationError) throw error;
    throw profileValidationError('avatar', 'This image could not be processed. Choose another image.');
  }
}
