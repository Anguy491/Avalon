import { describe, expect, it } from 'vitest';

import { sanitizeSentryEvent } from './sentry-sanitizer';

describe('NFR-008/NFR-014 Sentry allowlist', () => {
  it('removes tokens, user data, request bodies, breadcrumbs, and messages', () => {
    const canary = 'MERLIN-token-vote-nickname';
    const sanitized = sanitizeSentryEvent({
      event_id: 'event',
      message: canary,
      user: { id: canary },
      request: { data: canary, headers: { Authorization: canary } },
      breadcrumbs: [{ message: canary }],
      contexts: {
        app: { app_version: '0.1.0' },
        os: { name: 'iOS' },
        game: { role: canary },
      },
      exception: {
        values: [
          {
            type: 'TypeError',
            value: canary,
            stacktrace: {
              frames: [
                {
                  filename: 'app.js',
                  function: 'render',
                  vars: { token: canary },
                },
              ],
            },
          },
        ],
      },
    });

    expect(JSON.stringify(sanitized)).not.toContain(canary);
    expect(sanitized.contexts).toEqual({
      app: { app_version: '0.1.0' },
      os: { name: 'iOS' },
    });
    expect(sanitized.exception?.values?.[0]).toMatchObject({
      type: 'TypeError',
      stacktrace: { frames: [{ filename: 'app.js', function: 'render' }] },
    });
  });
});
