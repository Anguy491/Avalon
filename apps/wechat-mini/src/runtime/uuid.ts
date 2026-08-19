import Taro from '@tarojs/taro';

import { formatUuidV4 } from './uuid-format';

export function secureUuid(): Promise<string> {
  return new Promise((resolve, reject) => {
    Taro.getUserCryptoManager().getRandomValues({
      length: 16,
      success: ({ randomValues }) => {
        resolve(formatUuidV4(new Uint8Array(randomValues)));
      },
      fail: (error) => {
        reject(new Error(`Secure random generation failed: ${error.errMsg}`));
      },
    });
  });
}
