import type { SessionBootstrap } from '@avalon/protocol/mobile';

export const SESSION_STORAGE_KEY = 'avalon.session.v1';
export const INSTALLATION_STORAGE_KEY = 'avalon.installation.v1';

export interface SecureKeyValueStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  deleteItem(key: string): Promise<void>;
}

export type KeyValueStore = SecureKeyValueStore;

export interface StoredSession {
  readonly sessionToken: string;
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionExpiresAt: string;
  readonly realtimeUrl: string;
  readonly pendingResumeIdempotencyKey?: string;
}

function isStoredSession(value: unknown): value is StoredSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.sessionToken === 'string' &&
    typeof candidate.roomCode === 'string' &&
    typeof candidate.playerId === 'string' &&
    typeof candidate.sessionExpiresAt === 'string' &&
    typeof candidate.realtimeUrl === 'string' &&
    (candidate.pendingResumeIdempotencyKey === undefined ||
      typeof candidate.pendingResumeIdempotencyKey === 'string')
  );
}

export async function loadStoredSession(
  store: KeyValueStore,
): Promise<StoredSession | null> {
  const serialized = await store.getItem(SESSION_STORAGE_KEY);
  if (serialized === null) return null;
  try {
    const parsed = JSON.parse(serialized) as unknown;
    if (isStoredSession(parsed)) return parsed;
  } catch {
    // Corrupt credentials are deleted rather than partially recovered.
  }
  await store.deleteItem(SESSION_STORAGE_KEY);
  return null;
}

export async function saveBootstrap(
  store: KeyValueStore,
  bootstrap: SessionBootstrap,
): Promise<StoredSession> {
  const session: StoredSession = {
    sessionToken: bootstrap.sessionToken,
    roomCode: bootstrap.roomCode,
    playerId: bootstrap.playerId,
    sessionExpiresAt: bootstrap.sessionExpiresAt,
    realtimeUrl: bootstrap.realtimeUrl,
  };
  await store.setItem(SESSION_STORAGE_KEY, JSON.stringify(session));
  return session;
}

export async function updateSessionExpiry(
  store: KeyValueStore,
  session: StoredSession,
  sessionExpiresAt: string,
): Promise<StoredSession> {
  const updated = { ...session, sessionExpiresAt };
  await store.setItem(SESSION_STORAGE_KEY, JSON.stringify(updated));
  return updated;
}

export async function beginResume(
  store: KeyValueStore,
  session: StoredSession,
  createId: () => string,
): Promise<StoredSession> {
  if (session.pendingResumeIdempotencyKey !== undefined) return session;
  const pending: StoredSession = {
    ...session,
    pendingResumeIdempotencyKey: createId(),
  };
  await store.setItem(SESSION_STORAGE_KEY, JSON.stringify(pending));
  return pending;
}

export async function clearStoredSession(store: KeyValueStore): Promise<void> {
  await store.deleteItem(SESSION_STORAGE_KEY);
}

export async function getOrCreateInstallationId(
  store: KeyValueStore,
  createId: () => string,
): Promise<string> {
  const existing = await store.getItem(INSTALLATION_STORAGE_KEY);
  if (existing !== null) return existing;
  const installationId = createId();
  await store.setItem(INSTALLATION_STORAGE_KEY, installationId);
  return installationId;
}
