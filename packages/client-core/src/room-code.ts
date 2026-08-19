export const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/;

export function normalizeRoomCode(value: string): string {
  return value
    .toUpperCase()
    .replace(/[^23456789ABCDEFGHJKLMNPQRSTUVWXYZ]/g, '')
    .slice(0, 6);
}

export function parseJoinLink(
  value: string,
  allowedHosts: readonly string[],
): string | undefined {
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      !allowedHosts.includes(url.hostname) ||
      url.username.length > 0 ||
      url.password.length > 0 ||
      url.search.length > 0 ||
      url.hash.length > 0
    ) {
      return undefined;
    }
    const match = /^\/join\/([^/]+)$/.exec(url.pathname);
    if (match?.[1] === undefined) return undefined;
    const code = match[1].toUpperCase();
    return ROOM_CODE_PATTERN.test(code) ? code : undefined;
  } catch {
    return undefined;
  }
}
