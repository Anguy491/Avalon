import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import {
  clearInterval,
  clearTimeout,
  setInterval,
  setTimeout,
} from 'node:timers';

import { io } from 'socket.io-client';

export const DEFAULT_PROTOCOL_TIMEOUT_MS = 10_000;

export class ProtocolCommandRejectedError extends Error {
  constructor(commandType, result) {
    const code = result?.error?.code ?? 'UNKNOWN';
    super(`${commandType} was rejected with ${code}`);
    this.name = 'ProtocolCommandRejectedError';
    this.code = code;
    this.result = result;
  }
}

export const FORBIDDEN_PUBLIC_KEYS = new Set([
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

const sleep = (milliseconds) =>
  new Promise((resolve) => setTimeout(resolve, milliseconds));

function assertBootstrap(payload) {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof payload.roomCode !== 'string' ||
    typeof payload.playerId !== 'string' ||
    typeof payload.sessionToken !== 'string' ||
    typeof payload.realtimeUrl !== 'string' ||
    typeof payload.roomView !== 'object' ||
    payload.roomView === null
  ) {
    throw new Error('Session bootstrap was incomplete');
  }
  return payload;
}

export function findForbiddenPublicKey(value, path = 'public') {
  if (Array.isArray(value)) {
    for (const [index, item] of value.entries()) {
      const found = findForbiddenPublicKey(item, `${path}[${String(index)}]`);
      if (found !== undefined) return found;
    }
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  for (const [key, nested] of Object.entries(value)) {
    if (FORBIDDEN_PUBLIC_KEYS.has(key)) return `${path}.${key}`;
    const found = findForbiddenPublicKey(nested, `${path}.${key}`);
    if (found !== undefined) return found;
  }
  return undefined;
}

export function inspectProjection(member, roomView) {
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

export function commandEnvelope(
  roomId,
  expectedStateVersion,
  type,
  payload = {},
) {
  return {
    commandId: randomUUID(),
    roomId,
    expectedStateVersion,
    type,
    payload,
    sentAt: new Date().toISOString(),
  };
}

export function createProtocolTestClient({
  apiOrigin,
  realtimeUrl,
  appVersion = '0.1.0-test-client',
  timeoutMs = DEFAULT_PROTOCOL_TIMEOUT_MS,
  reconnect = false,
} = {}) {
  const normalizedApiOrigin = (apiOrigin ?? 'http://127.0.0.1:3000').replace(
    /\/$/u,
    '',
  );
  const members = new Set();

  const capabilities = (platform = 'IOS') => ({
    protocolVersion: 2,
    platform,
    appVersion,
    installationId: randomUUID(),
    voicePackVersions: ['zh-CN-v1'],
  });

  async function request(path, body, platform = 'IOS') {
    const startedAt = performance.now();
    const response = await fetch(`${normalizedApiOrigin}${path}`, {
      method: 'POST',
      headers: {
        accept: 'application/json',
        'content-type': 'application/json',
        'idempotency-key': randomUUID(),
        'x-protocol-version': '2',
      },
      body: JSON.stringify({
        ...body,
        client: capabilities(platform),
      }),
    });
    const elapsed = performance.now() - startedAt;
    const payload = await response.json().catch(() => undefined);
    if (response.status !== 201) {
      const code = payload?.error?.code ?? 'UNKNOWN';
      throw new Error(
        `${path} received HTTP ${String(response.status)} (${String(code)})`,
      );
    }
    return { elapsed, payload: assertBootstrap(payload) };
  }

  const createRoom = (body, platform) => request('/v2/rooms', body, platform);
  const joinRoom = (roomCode, nickname, platform) =>
    request(`/v2/rooms/${roomCode}/players`, { nickname }, platform);

  async function readCurrentView(sessionToken) {
    const response = await fetch(
      `${normalizedApiOrigin}/v2/rooms/current/view`,
      {
        headers: {
          accept: 'application/json',
          authorization: `Bearer ${sessionToken}`,
          'x-protocol-version': '2',
        },
      },
    );
    if (response.status !== 200) {
      throw new Error(`current view received HTTP ${String(response.status)}`);
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

  async function refreshMember(member) {
    const roomView = await readCurrentView(member.sessionToken);
    inspectProjection(member, roomView);
    return roomView;
  }

  function stopConnection(member) {
    if (member.heartbeat !== undefined) clearInterval(member.heartbeat);
    member.heartbeat = undefined;
    const socket = member.socket;
    member.socket = undefined;
    if (socket !== undefined) {
      socket.removeAllListeners();
      socket.disconnect();
    }
  }

  function openConnection(member, socketUrl) {
    stopConnection(member);
    return new Promise((resolve, reject) => {
      const startedAt = performance.now();
      const socket = io(socketUrl, {
        autoConnect: false,
        auth: {
          protocolVersion: 2,
          sessionToken: member.sessionToken,
          lastStateVersion: member.lastView?.public?.stateVersion ?? 0,
        },
        forceNew: true,
        reconnection: reconnect,
        transports: ['websocket'],
      });
      member.socket = socket;
      const timer = setTimeout(() => {
        stopConnection(member);
        reject(new Error('realtime session.ready timed out'));
      }, timeoutMs);
      socket.on('room.view', (message) => {
        if (typeof message === 'object' && message !== null) {
          inspectProjection(member, message.roomView);
        } else {
          member.projectionErrors.push('malformed room.view message');
        }
      });
      socket.on('session.revoked', () => {
        member.projectionErrors.push('session was revoked');
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        stopConnection(member);
        reject(
          new Error(
            `realtime connection was rejected: ${
              error instanceof Error ? error.message : 'unknown'
            }`,
          ),
        );
      });
      socket.once('session.ready', (message) => {
        clearTimeout(timer);
        if (
          typeof message !== 'object' ||
          message === null ||
          typeof message.roomView !== 'object' ||
          message.roomView === null
        ) {
          stopConnection(member);
          reject(new Error('session.ready was malformed'));
          return;
        }
        inspectProjection(member, message.roomView);
        member.heartbeat = setInterval(() => {
          if (socket.connected) {
            socket.emit('session.ping', { protocolVersion: 2 }, (pong) => {
              if (
                typeof pong !== 'object' ||
                pong === null ||
                typeof pong.serverTime !== 'string' ||
                typeof pong.sessionExpiresAt !== 'string'
              ) {
                member.projectionErrors.push('malformed session.pong');
              }
            });
          }
        }, 2_000);
        member.heartbeat.unref();
        resolve({ member, elapsed: performance.now() - startedAt });
      });
      socket.connect();
    });
  }

  async function connectMember(bootstrap) {
    const member = {
      playerId: bootstrap.playerId,
      sessionToken: bootstrap.sessionToken,
      roomId: bootstrap.roomView.public.roomId,
      realtimeUrl: realtimeUrl ?? bootstrap.realtimeUrl,
      socket: undefined,
      heartbeat: undefined,
      lastView: bootstrap.roomView,
      projectionErrors: [],
    };
    inspectProjection(member, bootstrap.roomView);
    members.add(member);
    return openConnection(member, member.realtimeUrl);
  }

  const reconnectMember = (member) =>
    openConnection(member, member.realtimeUrl);

  function emitCommand(member, command) {
    return new Promise((resolve, reject) => {
      if (member.socket === undefined || !member.socket.connected) {
        reject(new Error(`${command.type} cannot use a disconnected member`));
        return;
      }
      const startedAt = performance.now();
      const timer = setTimeout(() => {
        reject(new Error(`${command.type} ack timed out`));
      }, timeoutMs);
      member.socket.emit('command.submit', command, (result) => {
        clearTimeout(timer);
        const elapsed = performance.now() - startedAt;
        if (typeof result !== 'object' || result === null) {
          reject(new Error(`${command.type} returned a malformed ack`));
          return;
        }
        if (
          result.accepted !== true ||
          typeof result.stateVersion !== 'number'
        ) {
          reject(new ProtocolCommandRejectedError(command.type, result));
          return;
        }
        resolve({ elapsed, result });
      });
    });
  }

  async function submit(member, type, payload = {}, expectedStateVersion) {
    const version =
      expectedStateVersion ?? member.lastView?.public?.stateVersion ?? 0;
    return emitCommand(
      member,
      commandEnvelope(member.roomId, version, type, payload),
    );
  }

  async function waitForProjection(member, predicate, label = 'projection') {
    const startedAt = performance.now();
    while (performance.now() - startedAt < timeoutMs) {
      if (member.lastView !== undefined && predicate(member.lastView)) {
        return member.lastView;
      }
      await sleep(20);
    }
    throw new Error(`${label} timed out`);
  }

  const waitForVersion = (member, stateVersion) =>
    waitForProjection(
      member,
      (view) => view.public.stateVersion >= stateVersion,
      `stateVersion ${String(stateVersion)} projection`,
    );

  function closeMember(member) {
    stopConnection(member);
    members.delete(member);
  }

  function closeAll() {
    for (const member of members) stopConnection(member);
    members.clear();
  }

  return {
    apiOrigin: normalizedApiOrigin,
    closeAll,
    closeMember,
    connectMember,
    createRoom,
    emitCommand,
    joinRoom,
    readCurrentView,
    reconnectMember,
    refreshMember,
    request,
    stopConnection,
    submit,
    waitForProjection,
    waitForVersion,
  };
}
