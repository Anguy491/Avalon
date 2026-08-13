import { describe, expect, it } from 'vitest';

import {
  decryptJson,
  encryptJson,
  issueRoomCode,
  issueSessionToken,
  normalizeNickname,
  sha256Digest,
  tokenDigest,
} from './security.js';

const fixedRandom = {
  bytes: (length: number) => Uint8Array.from({ length }, (_, index) => index),
};

describe('M2-002/M2-003 nickname, room code, and token security', () => {
  it('normalizes NFC/whitespace and counts grapheme clusters', () => {
    expect(normalizeNickname('  A\u0301瑟  ')).toEqual({
      ok: true,
      nickname: 'Á瑟',
      comparison: 'á瑟',
    });
    expect(normalizeNickname('a'.repeat(17))).toEqual({ ok: false });
    expect(normalizeNickname('玩家\u202E')).toEqual({ ok: false });
    expect(normalizeNickname('玩家\n')).toEqual({ ok: false });
  });

  it('issues a 30-bit room code and 256-bit opaque token', () => {
    expect(issueRoomCode(fixedRandom)).toMatch(
      /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/,
    );
    const token = issueSessionToken(fixedRandom);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(
      tokenDigest(token, 'independent-pepper-material-0000001'),
    ).toHaveLength(64);
  });

  it('canonicalizes request digests and encrypts replay responses', () => {
    expect(sha256Digest({ b: 2, a: 1 })).toBe(sha256Digest({ a: 1, b: 2 }));
    const encrypted = encryptJson(
      { sessionToken: 'M2_test_token_only' },
      'independent-encryption-material-00001',
      fixedRandom,
    );
    expect(Buffer.from(encrypted.ciphertext).toString()).not.toContain(
      'M2_test_token_only',
    );
    expect(
      decryptJson(encrypted, 'independent-encryption-material-00001'),
    ).toEqual({ sessionToken: 'M2_test_token_only' });
  });
});
