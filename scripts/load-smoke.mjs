import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { clearTimeout, setTimeout } from 'node:timers';

import { io } from 'socket.io-client';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const roomCount = Number.parseInt(process.env.LOAD_ROOM_COUNT ?? '20', 10);
const playersPerRoom = 10;
const maximumHttpP95Milliseconds = 2_000;
const maximumRealtimeP95Milliseconds = 1_000;
const realtimeTimeoutMilliseconds = 10_000;
const forbiddenPublicKeys = new Set([
  'sessionToken',
  'roleAssignments',
  'privateKnowledge',
  'selfRole',
  'selfAlignment',
  'knownPlayers',
  'allowedQuestChoices',
  'questChoices',
  'teamVotes',
]);

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

function assertBootstrap(payload) {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.roomCode !== 'string' ||
    typeof payload.playerId !== 'string' ||
    typeof payload.sessionToken !== 'string' ||
    typeof payload.roomView !== 'object' ||
    payload.roomView === null
  ) {
    throw new Error('Session bootstrap was incomplete');
  }
  return payload;
}

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

  return { elapsed, payload: assertBootstrap(await response.json()) };
}

async function readCurrentView(sessionToken) {
  const response = await fetch(`${baseUrl}/v1/rooms/current/view`, {
    headers: {
      accept: 'application/json',
      authorization: `Bearer ${sessionToken}`,
      'x-protocol-version': '1',
    },
  });
  if (response.status !== 200) {
    throw new Error(`current view received HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.roomView !== 'object' ||
    payload.roomView === null
  ) {
    throw new Error('Current view response was incomplete');
  }
  return payload.roomView;
}

function percentile(values, fraction) {
  const sorted = [...values].sort((left, right) => left - right);
  const value = sorted[Math.ceil(sorted.length * fraction) - 1];
  if (value === undefined) throw new Error('Load scenario produced no samples');
  return value;
}

function summarize(label, timings, maximumP95Milliseconds) {
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

function findForbiddenPublicKey(value, path = 'public') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenPublicKey(item, `${path}[${String(index)}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (forbiddenPublicKeys.has(key)) return `${path}.${key}`;
    const found = findForbiddenPublicKey(nested, `${path}.${key}`);
    if (found !== undefined) return found;
  }
  return undefined;
}

function inspectProjection(member, roomView) {
  if (
    typeof roomView !== 'object' ||
    roomView === null ||
    typeof roomView.public !== 'object' ||
    roomView.public === null ||
    typeof roomView.private !== 'object' ||
    roomView.private === null
  ) {
    member.projectionErrors.push('malformed room view');
    return;
  }
  if (roomView.public.roomId !== member.roomId) {
    member.projectionErrors.push('cross-room public projection');
  }
  if (roomView.private.playerId !== member.playerId) {
    member.projectionErrors.push('cross-player private projection');
  }
  const forbidden = findForbiddenPublicKey(roomView.public);
  if (forbidden !== undefined) {
    member.projectionErrors.push(`forbidden public field at ${forbidden}`);
  }
  const currentVersion = member.lastView?.public?.stateVersion ?? -1;
  if (
    typeof roomView.public.stateVersion === 'number' &&
    roomView.public.stateVersion >= currentVersion
  ) {
    member.lastView = roomView;
  }
}

function connectMember(bootstrap) {
  const member = {
    playerId: bootstrap.playerId,
    sessionToken: bootstrap.sessionToken,
    roomId: bootstrap.roomView.public.roomId,
    socket: undefined,
    lastView: bootstrap.roomView,
    projectionErrors: [],
  };
  inspectProjection(member, bootstrap.roomView);
  const socket = io(`${baseUrl}/game-v1`, {
    autoConnect: false,
    auth: {
      protocolVersion: 1,
      sessionToken: member.sessionToken,
      lastStateVersion: bootstrap.roomView.public.stateVersion,
    },
    forceNew: true,
    reconnection: false,
    transports: ['websocket'],
  });
  member.socket = socket;
  sockets.push(socket);
  socket.on('room.view', (message) => {
    if (typeof message === 'object' && message !== null) {
      inspectProjection(member, message.roomView);
    } else {
      member.projectionErrors.push('malformed room.view message');
    }
  });

  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timer = setTimeout(() => {
      socket.disconnect();
      reject(new Error('realtime session.ready timed out'));
    }, realtimeTimeoutMilliseconds);
    socket.once('connect_error', () => {
      clearTimeout(timer);
      socket.disconnect();
      reject(new Error('realtime connection was rejected'));
    });
    socket.once('session.ready', (message) => {
      clearTimeout(timer);
      if (
        typeof message !== 'object' ||
        message === null ||
        typeof message.roomView !== 'object' ||
        message.roomView === null
      ) {
        socket.disconnect();
        reject(new Error('session.ready was malformed'));
        return;
      }
      inspectProjection(member, message.roomView);
      resolve({ member, elapsed: performance.now() - startedAt });
    });
    socket.connect();
  });
}

function emitCommand(member, command) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const timer = setTimeout(() => {
      reject(new Error(`${command.type} ack timed out`));
    }, realtimeTimeoutMilliseconds);
    member.socket.emit('command.submit', command, (result) => {
      clearTimeout(timer);
      const elapsed = performance.now() - startedAt;
      if (typeof result !== 'object' || result === null) {
        reject(new Error(`${command.type} returned a malformed ack`));
        return;
      }
      if (result.accepted !== true || typeof result.stateVersion !== 'number') {
        const code = result.error?.code ?? 'UNKNOWN';
        reject(new Error(`${command.type} was rejected with ${code}`));
        return;
      }
      resolve({ elapsed, result });
    });
  });
}

function commandEnvelope(roomId, expectedStateVersion, type, payload = {}) {
  return {
    commandId: randomUUID(),
    roomId,
    expectedStateVersion,
    type,
    payload,
    sentAt: new Date().toISOString(),
  };
}

async function waitForFinalProjection(room, stateVersion) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < realtimeTimeoutMilliseconds) {
    if (
      room.members.every(
        (member) =>
          member.lastView?.public?.stateVersion >= stateVersion &&
          member.lastView?.public?.phase === 'TEAM_PROPOSAL' &&
          member.lastView?.public?.phaseStage === 'HOST_HELD',
      )
    ) {
      return performance.now() - startedAt;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('final personalized projections timed out');
}

const sockets = [];
try {
  const createdRooms = await Promise.all(
    Array.from({ length: roomCount }, (_, roomIndex) =>
      timedRequest(
        '/v1/rooms',
        {
          nickname: `LoadHost${String(roomIndex)}`,
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

  const joinGroups = await Promise.all(
    createdRooms.map(({ payload }, roomIndex) =>
      Promise.all(
        Array.from({ length: playersPerRoom - 1 }, (_, playerIndex) =>
          timedRequest(
            `/v1/rooms/${payload.roomCode}/players`,
            { nickname: `LoadP${String(roomIndex)}_${String(playerIndex)}` },
            playerIndex % 2 === 0 ? 'ANDROID' : 'IOS',
          ),
        ),
      ),
    ),
  );

  const rooms = createdRooms.map(({ payload }, roomIndex) => ({
    roomId: payload.roomView.public.roomId,
    bootstraps: [
      payload,
      ...(joinGroups[roomIndex] ?? []).map((joined) => joined.payload),
    ],
    members: [],
  }));
  const connected = await Promise.all(
    rooms.flatMap((room) => room.bootstraps.map(connectMember)),
  );
  let connectionIndex = 0;
  for (const room of rooms) {
    room.members = connected
      .slice(connectionIndex, connectionIndex + playersPerRoom)
      .map(({ member }) => member);
    connectionIndex += playersPerRoom;
  }

  const commandTimings = [];
  const projectionTimings = [];
  await Promise.all(
    rooms.map(async (room) => {
      let stateVersion = Math.max(
        ...room.members.map(
          (member) => member.lastView?.public?.stateVersion ?? -1,
        ),
      );
      for (const member of room.members) {
        const submitted = await emitCommand(
          member,
          commandEnvelope(room.roomId, stateVersion, 'SetReady', {
            ready: true,
          }),
        );
        commandTimings.push(submitted.elapsed);
        stateVersion = submitted.result.stateVersion;
      }

      const host = room.members[0];
      if (host === undefined) throw new Error('load room had no host');
      const startCommand = commandEnvelope(
        room.roomId,
        stateVersion,
        'StartGame',
      );
      const started = await emitCommand(host, startCommand);
      commandTimings.push(started.elapsed);
      stateVersion = started.result.stateVersion;
      const replayed = await emitCommand(host, startCommand);
      commandTimings.push(replayed.elapsed);
      if (replayed.result.stateVersion !== stateVersion) {
        throw new Error('StartGame idempotent replay changed stateVersion');
      }

      const continued = await emitCommand(
        host,
        commandEnvelope(room.roomId, stateVersion, 'ContinuePhase'),
      );
      commandTimings.push(continued.elapsed);
      stateVersion = continued.result.stateVersion;

      for (const member of room.members) {
        const acknowledged = await emitCommand(
          member,
          commandEnvelope(room.roomId, stateVersion, 'AckRole'),
        );
        commandTimings.push(acknowledged.elapsed);
        stateVersion = acknowledged.result.stateVersion;
      }

      projectionTimings.push(await waitForFinalProjection(room, stateVersion));
      const authoritative = await readCurrentView(host.sessionToken);
      inspectProjection(host, authoritative);
      if (
        authoritative.public.roomId !== room.roomId ||
        authoritative.public.players.length !== playersPerRoom ||
        authoritative.public.phase !== 'TEAM_PROPOSAL' ||
        authoritative.public.phaseStage !== 'HOST_HELD'
      ) {
        throw new Error('room did not finish the M3 identity flow');
      }
    }),
  );

  const projectionErrors = rooms.flatMap((room) =>
    room.members.flatMap((member) => member.projectionErrors),
  );
  if (projectionErrors.length > 0) {
    throw new Error(`projection isolation failed: ${projectionErrors[0]}`);
  }
  if (new Set(rooms.map((room) => room.roomId)).size !== roomCount) {
    throw new Error('load scenario observed duplicate room ids');
  }

  process.stdout.write(
    [
      'M3 multi-room identity load smoke (zero request/command errors)',
      `rooms=${String(roomCount)}, connections=${String(roomCount * playersPerRoom)}, projectionIsolation=passed, publicSecretScan=passed`,
      summarize(
        'create',
        createdRooms.map(({ elapsed }) => elapsed),
        maximumHttpP95Milliseconds,
      ),
      summarize(
        'join',
        joinGroups.flat().map(({ elapsed }) => elapsed),
        maximumHttpP95Milliseconds,
      ),
      summarize(
        'connect',
        connected.map(({ elapsed }) => elapsed),
        maximumHttpP95Milliseconds,
      ),
      summarize('command-ack', commandTimings, maximumRealtimeP95Milliseconds),
      summarize(
        'final-projection',
        projectionTimings,
        maximumRealtimeP95Milliseconds,
      ),
    ].join('\n') + '\n',
  );
} finally {
  for (const socket of sockets) socket.disconnect();
}
