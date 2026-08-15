import { URL } from 'node:url';

const PLACEHOLDER_PATTERN =
  /(?:example|placeholder|invalid|开发占位|avalon-dev)/iu;

function validHttps(value) {
  try {
    return new URL(value).protocol === 'https:' && !value.includes('.invalid');
  } catch {
    return false;
  }
}

function validWss(value) {
  try {
    return new URL(value).protocol === 'wss:' && !value.includes('.invalid');
  } catch {
    return false;
  }
}

export function validatePreviewEnvironment(environment) {
  const failures = [];
  const requiredText = [
    ['EXPO_PUBLIC_APP_NAME', environment.EXPO_PUBLIC_APP_NAME],
    ['EXPO_PUBLIC_APP_SLUG', environment.EXPO_PUBLIC_APP_SLUG],
    ['EXPO_PUBLIC_APP_SCHEME', environment.EXPO_PUBLIC_APP_SCHEME],
    ['EXPO_PUBLIC_BUNDLE_ID', environment.EXPO_PUBLIC_BUNDLE_ID],
    ['EXPO_PUBLIC_JOIN_HOST', environment.EXPO_PUBLIC_JOIN_HOST],
  ];
  for (const [name, value] of requiredText) {
    if (
      typeof value !== 'string' ||
      value.length === 0 ||
      PLACEHOLDER_PATTERN.test(value)
    ) {
      failures.push(`${name} must be a reviewed non-placeholder value`);
    }
  }
  if (!validHttps(environment.EXPO_PUBLIC_API_URL)) {
    failures.push('EXPO_PUBLIC_API_URL must be a real HTTPS origin');
  }
  if (!validWss(environment.REALTIME_PUBLIC_URL)) {
    failures.push('REALTIME_PUBLIC_URL must be a real WSS URL');
  }
  if (
    environment.EXPO_ENABLE_IOS_ASSOCIATED_DOMAINS !== '1' ||
    environment.EXPO_APP_LINKS_VERIFIED !== '1'
  ) {
    failures.push('App Links must be enabled and independently verified');
  }
  if (
    !/^[0-9a-f]{8}-[0-9a-f-]{27}$/iu.test(
      environment.EXPO_PUBLIC_EAS_PROJECT_ID ?? '',
    )
  ) {
    failures.push(
      'EXPO_PUBLIC_EAS_PROJECT_ID must identify a real EAS project',
    );
  }
  if (
    environment.SENTRY_REVIEWED !== '1' ||
    !/^https:\/\/[^@]+@[^/]*\.ingest\.de\.sentry\.io\//u.test(
      environment.EXPO_PUBLIC_SENTRY_DSN ?? '',
    )
  ) {
    failures.push('Sentry must be reviewed and use the DE ingest region');
  }
  return failures;
}
