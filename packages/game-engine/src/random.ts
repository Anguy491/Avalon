import type { RandomBytesPort } from './types.js';

const BYTE_RANGE = 256;

/** Unbiased bounded integer using rejection sampling over injected random bytes. */
export function randomIndex(limit: number, random: RandomBytesPort): number {
  if (!Number.isInteger(limit) || limit <= 0 || limit > BYTE_RANGE) {
    throw new RangeError('Random index limit must be an integer from 1 to 256');
  }
  const acceptanceCeiling = Math.floor(BYTE_RANGE / limit) * limit;
  for (;;) {
    const bytes = random.bytes(1);
    if (bytes.length !== 1) {
      throw new RangeError('RandomBytesPort returned an unexpected byte count');
    }
    const value = bytes[0];
    if (value === undefined) {
      throw new RangeError('RandomBytesPort returned no byte');
    }
    if (value < acceptanceCeiling) return value % limit;
  }
}

export function shuffle<T>(
  values: readonly T[],
  random: RandomBytesPort,
): readonly T[] {
  const shuffled = [...values];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const target = randomIndex(index + 1, random);
    const currentValue = shuffled[index];
    const targetValue = shuffled[target];
    if (currentValue === undefined || targetValue === undefined) {
      throw new RangeError('Shuffle index out of range');
    }
    shuffled[index] = targetValue;
    shuffled[target] = currentValue;
  }
  return shuffled;
}
