import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const roomCount = Number.parseInt(process.env.LOAD_ROOM_COUNT ?? '20', 10);
const playersPerRoom = 10;
const maximumP95Milliseconds = 2_000;

if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 1_000) {
  throw new Error('LOAD_ROOM_COUNT must be an integer between 1 and 1000');
}

const client = (platform, installationId) => ({
  protocolVersion: 1,
  platform,
  appVersion: '0.1.0-load',
  installationId,
  voicePackVersions: ['zh-CN-v1'],
});

async function timedRequest(path, body, platform) {
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      accept: 'application/json',
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      'x-protocol-version': '1',
    },
    body: JSON.stringify({
      ...body,
      client: client(platform, randomUUID()),
    }),
  });
  const elapsed = performance.now() - startedAt;
  if (response.status !== 201) {
    throw new Error(`${path} received HTTP ${response.status}`);
  }

  return { elapsed, payload: await response.json() };
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted[Math.ceil(sorted.length * fraction) - 1];
  if (value === undefined) throw new Error('Load scenario produced no samples');
  return value;
}

function summarize(label, timings) {
  const p50 = percentile(timings, 0.5);
  const p95 = percentile(timings, 0.95);
  const p99 = percentile(timings, 0.99);
  if (p95 > maximumP95Milliseconds) {
    throw new Error(
      `${label} p95 ${p95.toFixed(1)}ms exceeded ${maximumP95Milliseconds}ms`,
    );
  }

  return `${label}: n=${timings.length}, p50=${p50.toFixed(1)}ms, p95=${p95.toFixed(1)}ms, p99=${p99.toFixed(1)}ms`;
}

const createdRooms = await Promise.all(
  Array.from({ length: roomCount }, (_, roomIndex) =>
    timedRequest(
      '/v1/rooms',
      {
        nickname: `LoadHost${roomIndex}`,
        config: {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount: playersPerRoom,
          roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
          locale: 'zh-CN',
        },
      },
      roomIndex % 2 === 0 ? 'IOS' : 'ANDROID',
    ),
  ),
);

const joins = await Promise.all(
  createdRooms.flatMap(({ payload }, roomIndex) => {
    if (
      typeof payload !== 'object' ||
      payload === null ||
      !('roomCode' in payload) ||
      typeof payload.roomCode !== 'string'
    ) {
      throw new Error('Create response did not contain a room code');
    }

    return Array.from({ length: playersPerRoom - 1 }, (_, playerIndex) =>
      timedRequest(
        `/v1/rooms/${payload.roomCode}/players`,
        { nickname: `LoadP${roomIndex}_${playerIndex}` },
        playerIndex % 2 === 0 ? 'ANDROID' : 'IOS',
      ),
    );
  }),
);

process.stdout.write(
  [
    'M2 create/join load smoke (zero HTTP errors)',
    summarize(
      'create',
      createdRooms.map(({ elapsed }) => elapsed),
    ),
    summarize(
      'join',
      joins.map(({ elapsed }) => elapsed),
    ),
  ].join('\n') + '\n',
);
