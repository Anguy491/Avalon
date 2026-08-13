import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
} from 'node:crypto';

import type { RandomPort } from './runtime-ports.js';

const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
const BIDI_OR_CONTROL = /[\p{Cc}\p{Cf}]/u;

export interface EncryptedJson {
  readonly ciphertext: Uint8Array;
  readonly iv: Uint8Array;
  readonly tag: Uint8Array;
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== 'object' || value === null) return value;
  return Object.fromEntries(
    Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function sha256Digest(value: unknown): string {
  return createHash('sha256').update(stableJson(value)).digest('hex');
}

export function tokenDigest(token: string, pepper: string): string {
  return createHmac('sha256', pepper).update(token).digest('hex');
}

export function issueSessionToken(random: RandomPort): string {
  return Buffer.from(random.bytes(32)).toString('base64url');
}

export function issueRoomCode(random: RandomPort): string {
  const bytes = random.bytes(6);
  if (bytes.length !== 6) throw new Error('Random port returned wrong length');
  return [...bytes].map((value) => ROOM_CODE_ALPHABET[value & 31]).join('');
}

function encryptionKey(secret: string): Buffer {
  return createHash('sha256').update(secret).digest();
}

export function encryptJson(
  value: unknown,
  secret: string,
  random: RandomPort,
): EncryptedJson {
  const iv = Buffer.from(random.bytes(12));
  if (iv.length !== 12) throw new Error('Random port returned wrong IV length');
  const cipher = createCipheriv('aes-256-gcm', encryptionKey(secret), iv);
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(value), 'utf8'),
    cipher.final(),
  ]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

export function decryptJson(encrypted: EncryptedJson, secret: string): unknown {
  const decipher = createDecipheriv(
    'aes-256-gcm',
    encryptionKey(secret),
    encrypted.iv,
  );
  decipher.setAuthTag(encrypted.tag);
  const plaintext = Buffer.concat([
    decipher.update(encrypted.ciphertext),
    decipher.final(),
  ]).toString('utf8');
  return JSON.parse(plaintext) as unknown;
}

export type NicknameResult =
  | {
      readonly ok: true;
      readonly nickname: string;
      readonly comparison: string;
    }
  | { readonly ok: false };

export function normalizeNickname(input: string): NicknameResult {
  if (BIDI_OR_CONTROL.test(input)) return { ok: false };
  const nickname = input.normalize('NFC').trim();
  if (nickname.length === 0) return { ok: false };
  const graphemes = [
    ...new Intl.Segmenter('zh-CN', { granularity: 'grapheme' }).segment(
      nickname,
    ),
  ];
  if (graphemes.length < 1 || graphemes.length > 16) return { ok: false };
  return {
    ok: true,
    nickname,
    comparison: nickname.toLocaleLowerCase('zh-CN'),
  };
}

export function addSeconds(date: Date, seconds: number): Date {
  return new Date(date.getTime() + seconds * 1_000);
}
