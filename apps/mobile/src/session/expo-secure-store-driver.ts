import type { SecureKeyValueStore } from './secure-session-store';

// TypeScript resolves this neutral implementation while Metro selects the
// `.native` or `.web` sibling first for each target platform.
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
