import sentryMetro from '@sentry/react-native/metro.js';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const { getSentryExpoConfig } = sentryMetro;
const projectRoot = dirname(fileURLToPath(import.meta.url));

export default getSentryExpoConfig(projectRoot, {
  includeWebReplay: false,
});
