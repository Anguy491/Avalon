import { describe, expect, it } from 'vitest';

import { IdempotencyKeys } from './idempotency';

describe('IdempotencyKeys', () => {
  it('reuses a key for retries and changes it when payload changes or succeeds', () => {
    const keys = new IdempotencyKeys();
    let sequence = 0;
    const createId = () => `key-${String(++sequence)}`;

    expect(keys.acquire('same-payload', createId)).toBe('key-1');
    expect(keys.acquire('same-payload', createId)).toBe('key-1');
    expect(keys.acquire('changed-payload', createId)).toBe('key-2');
    keys.complete('changed-payload');
    expect(keys.acquire('changed-payload', createId)).toBe('key-3');
  });
});
