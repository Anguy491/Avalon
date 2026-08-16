import type { AudioPreferenceStore } from './audio-preference-store';

// Mute and volume are non-sensitive preferences. Session tokens continue to
// use the separate in-memory-only web session driver and are never persisted.
export const audioPreferenceStore: AudioPreferenceStore = {
  getItem: (key) => {
    try {
      return Promise.resolve(globalThis.localStorage.getItem(key));
    } catch {
      return Promise.resolve(null);
    }
  },
  setItem: (key, value) => {
    try {
      globalThis.localStorage.setItem(key, value);
    } catch {
      // Preferences may be unavailable in restricted/private browser modes.
    }
    return Promise.resolve();
  },
};
