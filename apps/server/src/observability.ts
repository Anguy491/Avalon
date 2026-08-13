import type { FastifyServerOptions } from 'fastify';

import type { ServerConfig } from './config.js';

export function createLoggerOptions(
  config: Pick<ServerConfig, 'logLevel'>,
): Exclude<FastifyServerOptions['logger'], boolean | undefined> {
  return {
    level: config.logLevel,
    base: { service: 'avalon-server' },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'request.headers.authorization',
        'request.headers.cookie',
        '*.sessionToken',
        '*.roleAssignments',
        '*.privateKnowledge',
        '*.selfRole',
        '*.selfAlignment',
        '*.knownPlayers',
        '*.allowedQuestChoices',
        '*.questChoices',
        '*.teamVotes',
      ],
      censor: '[REDACTED]',
    },
    serializers: {
      req(request) {
        return {
          method: request.method,
          url: request.url,
          requestId: request.id,
        };
      },
    },
  };
}
