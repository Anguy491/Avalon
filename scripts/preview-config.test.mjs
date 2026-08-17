import assert from 'node:assert/strict';
import test from 'node:test';

import { validatePreviewEnvironment } from './preview-config.mjs';

const valid = {
  EXPO_PUBLIC_APP_NAME: 'Avalon Preview',
  EXPO_PUBLIC_APP_SLUG: 'avalon-preview',
  EXPO_PUBLIC_APP_SCHEME: 'avalon-preview',
  EXPO_PUBLIC_BUNDLE_ID: 'com.avalonco.avalon.preview',
  EXPO_PUBLIC_JOIN_HOST: 'join.preview.avalonco.net',
  EXPO_PUBLIC_API_URL: 'https://api.preview.avalonco.net',
  REALTIME_PUBLIC_URL: 'wss://api.preview.avalonco.net/game-v2',
  EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS: '1',
  EXPO_APP_LINKS_VERIFIED: '1',
  EXPO_PUBLIC_EAS_PROJECT_ID: '10000000-0000-4000-8000-000000000001',
  SENTRY_REVIEWED: '1',
  EXPO_PUBLIC_SENTRY_DSN:
    'https://public@example.ingest.de.sentry.io/1000000000000000',
};

test('M7 preview validator accepts a complete reviewed fixture', () => {
  assert.deepEqual(validatePreviewEnvironment(valid), []);
});

test('M7 preview validator rejects placeholders, insecure transports, and US Sentry', () => {
  const failures = validatePreviewEnvironment({
    ...valid,
    EXPO_PUBLIC_APP_NAME: 'Avalon（开发占位）',
    EXPO_PUBLIC_API_URL: 'http://api.example.invalid',
    REALTIME_PUBLIC_URL: 'ws://api.example.invalid/game-v2',
    EXPO_PUBLIC_SENTRY_DSN: 'https://public@o1.ingest.us.sentry.io/1',
  });
  assert.ok(failures.length >= 4);
});
