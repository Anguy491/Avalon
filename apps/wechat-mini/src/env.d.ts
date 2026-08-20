declare namespace NodeJS {
  interface ProcessEnv {
    readonly NODE_ENV: 'development' | 'production' | 'test';
    readonly TARO_APP_API_URL?: string;
    readonly TARO_APP_JOIN_HOST?: string;
    readonly TARO_APP_VERSION?: string;
  }
}
