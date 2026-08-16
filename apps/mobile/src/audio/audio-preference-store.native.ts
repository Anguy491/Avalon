import * as SecureStore from 'expo-secure-store';

import type { AudioPreferenceStore } from './audio-preference-store';

const options: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export const audioPreferenceStore: AudioPreferenceStore = {
  getItem: (key) => SecureStore.getItemAsync(key, options),
  setItem: (key, value) => SecureStore.setItemAsync(key, value, options),
};
