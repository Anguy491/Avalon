import { describe, expect, it } from 'vitest';

import {
  INSTALLATION_STORAGE_KEY,
  SESSION_STORAGE_KEY,
  beginResume,
  clearStoredSession,
  getOrCreateInstallationId,
  loadStoredSession,
  saveBootstrap,
  type SecureKeyValueStore,
} from './secure-session-store';

class MemorySecureStore implements SecureKeyValueStore {
  readonly values = new Map<string, string>();

  getItem(key: string) {
    return Promise.resolve(this.values.get(key) ?? null);
  }

  setItem(key: string, value: string) {
    this.values.set(key, value);
    return Promise.resolve();
  }

  deleteItem(key: string) {
    this.values.delete(key);
    return Promise.resolve();
  }
}

const firstBootstrap = {
  protocolVersion: 1 as const,
  roomCode: 'ABC234',
  playerId: '00000000-0000-4000-8000-000000000001',
  sessionToken: '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefg',
  sessionExpiresAt: '2026-08-13T12:30:00.000Z',
  realtimeUrl: 'wss://example.test/game-v1',
  roomView: {} as never,
};

describe('secure session persistence', () => {
  it('stores the opaque token only in the injected secure store', async () => {
    const store = new MemorySecureStore();
    await saveBootstrap(store, firstBootstrap);

    expect(store.values.size).toBe(1);
    expect(store.values.get(SESSION_STORAGE_KEY)).toContain(
      firstBootstrap.sessionToken,
    );
    expect(await loadStoredSession(store)).toMatchObject({
      sessionToken: firstBootstrap.sessionToken,
      roomCode: 'ABC234',
    });
  });

  it('persists one resume key across a crash and atomically replaces rotation state', async () => {
    const store = new MemorySecureStore();
    const original = await saveBootstrap(store, firstBootstrap);
    const pending = await beginResume(store, original, () => 'resume-id');
    const afterRestart = await loadStoredSession(store);
    expect(afterRestart).not.toBeNull();
    if (afterRestart === null) throw new Error('missing session after restart');
    const retry = await beginResume(store, afterRestart, () => 'wrong-id');

    expect(pending.pendingResumeIdempotencyKey).toBe('resume-id');
    expect(retry.pendingResumeIdempotencyKey).toBe('resume-id');

    await saveBootstrap(store, {
      ...firstBootstrap,
      sessionToken: 'gfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA9876543210',
    });
    expect(await loadStoredSession(store)).toMatchObject({
      sessionToken: 'gfedcbaZYXWVUTSRQPONMLKJIHGFEDCBA9876543210',
    });
    expect(
      (await loadStoredSession(store))?.pendingResumeIdempotencyKey,
    ).toBeUndefined();
  });

  it('keeps an installation id independent and clears only the session', async () => {
    const store = new MemorySecureStore();
    const installationId = await getOrCreateInstallationId(
      store,
      () => '00000000-0000-4000-8000-000000000099',
    );
    await saveBootstrap(store, firstBootstrap);
    await clearStoredSession(store);

    expect(await loadStoredSession(store)).toBeNull();
    expect(store.values.get(INSTALLATION_STORAGE_KEY)).toBe(installationId);
  });
});
