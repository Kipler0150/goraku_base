import assert from 'node:assert/strict';
import sharp from 'sharp';
import { describe, it } from 'node:test';
import {
  normalizeProfileAvatar,
  PROFILE_AVATAR_MAX_BYTES
} from '../server/profile.js';

describe('profile avatar processing', () => {
  it('validates, center-crops, resizes, and re-encodes supported images', async () => {
    const source = await sharp({
      create: {
        width: 480,
        height: 320,
        channels: 3,
        background: { r: 176, g: 167, b: 255 }
      }
    }).png().toBuffer();

    const avatar = await normalizeProfileAvatar({ data: source, contentType: 'image/png' });
    const metadata = await sharp(avatar.data).metadata();

    assert.equal(avatar.contentType, 'image/webp');
    assert.equal(metadata.format, 'webp');
    assert.equal(metadata.width, 256);
    assert.equal(metadata.height, 256);
    assert.equal(metadata.hasProfile, false);
  });

  it('rejects oversized, mismatched, and unsupported payloads safely', async () => {
    await assert.rejects(
      normalizeProfileAvatar({ data: Buffer.alloc(PROFILE_AVATAR_MAX_BYTES + 1), contentType: 'image/png' }),
      (error) => error.code === 'VALIDATION_ERROR' && error.details[0].field === 'avatar'
    );
    await assert.rejects(
      normalizeProfileAvatar({ data: Buffer.from('not-an-image'), contentType: 'image/png' }),
      (error) => error.code === 'VALIDATION_ERROR'
    );
  });
});
