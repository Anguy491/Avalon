import { randomUUID } from 'node:crypto';
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
import { parentPort, workerData } from 'node:worker_threads';
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers';

import { io } from 'socket.io-client';

const { baseUrl, roomOffset, roomCount, durationMs, rampMs } = workerData;
const forbidden = new Set([
  'sessionToken',
  'roleAssignments',
  'privateKnowledge',
  'questChoices',
  'teamVotes',
]);
const sockets = [];
const timers = [];
const timings = {
  create: [],
  join: [],
  connect: [],
  command: [],
  projection: [],
};
const errors = [];
const resourceSamples = [];
let commands = 0;
let projections = 0;

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function findForbidden(value) {
  if (Array.isArray(value)) return value.some(findForbidden);
  if (typeof value !== 'object' || value === null) return false;
  return Object.entries(value).some(
    ([key, nested]) => forbidden.has(key) || findForbidden(nested),
  );
}

async function post(path, body) {
  const started = performance.now();
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'idempotency-key': randomUUID(),
      'x-protocol-version': '1',
    },
    body: JSON.stringify({
      ...body,
      client: {
        protocolVersion: 1,
        platform: 'ANDROID',
        appVersion: 'm7-load',
        installationId: randomUUID(),
        voicePackVersions: ['zh-CN-v1'],
      },
    }),
  });
  const elapsed = performance.now() - started;
  if (response.status !== 201) {
    throw new Error(`${path} returned ${String(response.status)}`);
  }
  return { body: await response.json(), elapsed };
}

function inspect(member, view) {
  if (
    view?.public?.roomId !== member.roomId ||
    view?.private?.playerId !== member.playerId ||
    findForbidden(view?.public)
  ) {
    errors.push('projection recipient or secret invariant failed');
    return;
  }
  if (view.public.stateVersion < member.stateVersion) {
    errors.push('projection version regressed');
    return;
  }
  member.stateVersion = view.public.stateVersion;
  member.view = view;
  projections += 1;
}

function connect(bootstrap) {
  return new Promise((resolve, reject) => {
    const member = {
      playerId: bootstrap.playerId,
      roomId: bootstrap.roomView.public.roomId,
      token: bootstrap.sessionToken,
      stateVersion: bootstrap.roomView.public.stateVersion,
      view: bootstrap.roomView,
      socket: undefined,
      pendingProjectionStarted: undefined,
    };
    inspect(member, bootstrap.roomView);
    const socket = io(`${baseUrl}/game-v1`, {
      autoConnect: false,
      forceNew: true,
      reconnection: false,
      transports: ['websocket'],
      auth: {
        protocolVersion: 1,
        sessionToken: member.token,
        lastStateVersion: member.stateVersion,
      },
    });
    member.socket = socket;
    sockets.push(socket);
    const started = performance.now();
    const timeout = setTimeout(
      () => reject(new Error('session.ready timeout')),
      10_000,
    );
    socket.on('room.view', (message) => {
      inspect(member, message?.roomView);
      if (member.pendingProjectionStarted !== undefined) {
        timings.projection.push(
          performance.now() - member.pendingProjectionStarted,
        );
        member.pendingProjectionStarted = undefined;
      }
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.once('session.ready', (message) => {
      clearTimeout(timeout);
      inspect(member, message?.roomView);
      timings.connect.push(performance.now() - started);
      const heartbeat = setInterval(() => {
        if (socket.connected) {
          socket.emit('session.ping', { protocolVersion: 1 });
        }
      }, 2_000);
      heartbeat.unref();
      timers.push(heartbeat);
      socket.on('connect_error', () => {
        errors.push('reconnect failed');
      });
      resolve(member);
    });
    socket.connect();
  });
}

function emit(member, command) {
  return new Promise((resolve, reject) => {
    const started = performance.now();
    const timeout = setTimeout(
      () => reject(new Error('command timeout')),
      10_000,
    );
    member.socket.emit('command.submit', command, (result) => {
      clearTimeout(timeout);
      timings.command.push(performance.now() - started);
      commands += 1;
      if (result?.accepted !== true) {
        reject(
          new Error(`command rejected: ${result?.error?.code ?? 'unknown'}`),
        );
        return;
      }
      resolve(result);
    });
  });
}

async function waitView(member, version) {
  const started = performance.now();
  while (performance.now() - started < 10_000) {
    if (member.stateVersion >= version) return member.view;
    await sleep(20);
  }
  throw new Error('projection convergence timeout');
}

async function setupRoom(room, globalIndex) {
  const host = room.members[0];
  if (host === undefined) throw new Error('room has no host');
  let version = Math.max(...room.members.map((member) => member.stateVersion));
  const submit = async (member, type, payload = {}, replay) => {
    const command = replay ?? {
      commandId: randomUUID(),
      roomId: room.roomId,
      expectedStateVersion: version,
      type,
      payload,
      sentAt: new Date().toISOString(),
    };
    if (replay === undefined) {
      member.pendingProjectionStarted = performance.now();
    }
    const result = await emit(member, command);
    version = result.stateVersion;
    return command;
  };
  const scenario = globalIndex % 7;
  if (scenario === 0) return;
  for (const member of room.members) {
    await submit(member, 'SetReady', { ready: true });
  }
  const startCommand = await submit(host, 'StartGame');
  await submit(host, 'StartGame', {}, startCommand);
  if (scenario === 1) return;
  await submit(host, 'ContinuePhase');
  for (const member of room.members) await submit(member, 'AckRole');
  if (scenario === 2) return;
  // Keep the release harness within the production per-session command bucket.
  await sleep(5_100);
  if (scenario === 4) {
    await submit(host, 'PauseGame', { reason: '容量演练' });
    return;
  }
  await submit(host, 'ContinuePhase');
  const view = await waitView(host, version);
  const leader = room.members.find(
    (member) => member.playerId === view.public.leaderPlayerId,
  );
  if (leader === undefined) throw new Error('leader missing');
  await submit(leader, 'SubmitTeam', {
    teamPlayerIds: room.members
      .slice(0, view.public.requiredTeamSize)
      .map((member) => member.playerId),
  });
  await submit(host, 'ContinuePhase');
  if (scenario === 3) return;
  for (const member of room.members) {
    await submit(member, 'SubmitTeamVote', { vote: 'APPROVE' });
  }
  await submit(host, 'ContinuePhase');
  await submit(host, 'ContinuePhase');
  if (scenario === 5) return;
  const questView = await waitView(host, version);
  const questTeam = new Set(questView.public.proposedTeamPlayerIds);
  for (const member of room.members) {
    if (questTeam.has(member.playerId)) {
      await submit(member, 'SubmitQuestChoice', { choice: 'SUCCESS' });
    }
  }
}

async function run() {
  const eventLoop = monitorEventLoopDelay({ resolution: 20 });
  eventLoop.enable();
  const sampleResources = () => {
    resourceSamples.push({
      elapsedMinutes: resourceSamples.length,
      memoryRss: process.memoryUsage().rss,
      eventLoopP99Ms: eventLoop.percentile(99) / 1_000_000,
    });
    eventLoop.reset();
  };
  const sampler = setInterval(sampleResources, 60_000);
  sampler.unref();
  timers.push(sampler);
  const rooms = [];
  const perRoomRamp = Math.max(0, rampMs / Math.max(1, roomCount) - 5_100);
  for (let local = 0; local < roomCount; local += 1) {
    const globalIndex = roomOffset + local;
    const created = await post('/v1/rooms', {
      nickname: `M7H${String(globalIndex)}`,
      config: {
        rulesVersion: 'CLASSIC_AVALON_V1',
        playerCount: 10,
        roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
        locale: 'zh-CN',
      },
    });
    timings.create.push(created.elapsed);
    const joined = [];
    for (let player = 1; player < 10; player += 1) {
      const result = await post(`/v1/rooms/${created.body.roomCode}/players`, {
        nickname: `M7P${String(globalIndex)}_${String(player)}`,
      });
      timings.join.push(result.elapsed);
      joined.push(result.body);
    }
    const members = await Promise.all([created.body, ...joined].map(connect));
    const room = { roomId: created.body.roomView.public.roomId, members };
    rooms.push(room);
    await setupRoom(room, globalIndex);
    if (perRoomRamp > 0) await sleep(perRoomRamp);
  }

  const jitter = setInterval(() => {
    const simultaneous = Math.max(1, Math.floor(sockets.length * 0.01));
    const staggered = Math.max(1, Math.floor(sockets.length * 0.04));
    for (let index = 0; index < simultaneous + staggered; index += 1) {
      const socket = sockets[(index * 37 + Date.now()) % sockets.length];
      if (socket === undefined) continue;
      socket.disconnect();
      setTimeout(
        () => socket.connect(),
        index < simultaneous ? 0 : 250 + (index % 20) * 25,
      );
    }
  }, 60_000);
  jitter.unref();
  timers.push(jitter);
  await sleep(durationMs);
  sampleResources();
  eventLoop.disable();

  return {
    timings,
    errors,
    commands,
    projections,
    connections: sockets.length,
    resourceSamples,
  };
}

try {
  parentPort.postMessage({ ok: true, result: await run() });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: error instanceof Error ? error.message : String(error),
  });
} finally {
  for (const timer of timers) clearInterval(timer);
  for (const socket of sockets) socket.disconnect();
}
