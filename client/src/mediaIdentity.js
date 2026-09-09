export function mediaIdentity(media) {
  return `${media.provider ?? 'unknown'}:${media.type ?? 'unknown'}:${media.providerId ?? media.id}`;
}
