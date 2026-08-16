export interface AudioPreferenceStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
}

// TypeScript and unit tests resolve this neutral in-memory implementation.
// Metro selects the `.native` or `.web` sibling for platform builds.
const memory = new Map<string, string>();

export const audioPreferenceStore: AudioPreferenceStore = {
  getItem: (key) => Promise.resolve(memory.get(key) ?? null),
  setItem: (key, value) => {
    memory.set(key, value);
    return Promise.resolve();
  },
};
