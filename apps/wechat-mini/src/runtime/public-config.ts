function requiredBuildValue(value: string | undefined, name: string): string {
  if (value === undefined || value.trim().length === 0) {
    throw new Error(`Missing compiled public configuration: ${name}`);
  }
  return value.trim();
}

export const WECHAT_API_ORIGIN = requiredBuildValue(
  process.env.TARO_APP_API_URL,
  'API URL',
).replace(/\/$/, '');

export const WECHAT_JOIN_HOST = requiredBuildValue(
  process.env.TARO_APP_JOIN_HOST,
  'join host',
);

export const WECHAT_APP_VERSION = requiredBuildValue(
  process.env.TARO_APP_VERSION,
  'app version',
);
