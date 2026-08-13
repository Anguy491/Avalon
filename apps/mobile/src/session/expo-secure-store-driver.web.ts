import type { SecureKeyValueStore } from './secure-session-store';

// Web preview is not an M2 release target. Keep tokens in memory only rather
// than falling back to localStorage or another ordinary browser store.
const memory = new Map<string, string>();

export const expoSecureStore: SecureKeyValueStore = {
  getItem: (key) => Promise.resolve(memory.get(key) ?? null),
  setItem: (key, value) => {
    memory.set(key, value);
    return Promise.resolve();
  },
  deleteItem: (key) => {
    memory.delete(key);
    return Promise.resolve();
  },
};
