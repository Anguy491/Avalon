import Taro from '@tarojs/taro';

import type { SecureKeyValueStore } from '@avalon/client-core';

export const wechatSessionStore: SecureKeyValueStore = {
  async getItem(key) {
    try {
      const value = await Taro.getStorage<string>({ key });
      return typeof value.data === 'string' ? value.data : null;
    } catch {
      return null;
    }
  },
  async setItem(key, value) {
    await Taro.setStorage({ key, data: value });
  },
  async deleteItem(key) {
    try {
      await Taro.removeStorage({ key });
    } catch {
      // Removing an absent key is already the desired state.
    }
  },
};
