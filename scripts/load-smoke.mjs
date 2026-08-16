import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers';

import {
  commandEnvelope,
  createProtocolTestClient,
  inspectProjection,
} from './lib/protocol-test-client.mjs';

const baseUrl = process.env.LOAD_BASE_URL ?? 'http://127.0.0.1:3000';
const roomCount = Number.parseInt(process.env.LOAD_ROOM_COUNT ?? '20', 10);
const fixedPlayerCount =
  process.env.LOAD_PLAYERS_PER_ROOM === undefined
    ? undefined
    : Number.parseInt(process.env.LOAD_PLAYERS_PER_ROOM, 10);
const playerCountForRoom = (roomIndex) =>
  fixedPlayerCount ?? 5 + (roomIndex % 6);
const maximumHttpP95Milliseconds = 2_000;
const maximumRealtimeP95Milliseconds = 1_000;
const realtimeTimeoutMilliseconds = 10_000;
const protocol = createProtocolTestClient({
  apiOrigin: baseUrl,
  realtimeUrl: `${baseUrl}/game-v1`,
  appVersion: '0.1.0-load',
});

if (!Number.isInteger(roomCount) || roomCount < 1 || roomCount > 1_000) {
  throw new Error('LOAD_ROOM_COUNT must be an integer between 1 and 1000');
}
if (
  fixedPlayerCount !== undefined &&
  (!Number.isInteger(fixedPlayerCount) ||
    fixedPlayerCount < 5 ||
    fixedPlayerCount > 10)
) {
  throw new Error('LOAD_PLAYERS_PER_ROOM must be an integer between 5 and 10');
}

async function timedRequest(path, body, platform) {
  return protocol.request(path, body, platform);
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

function connectMember(bootstrap) {
  return protocol.connectMember(bootstrap);
}

function emitCommand(member, command) {
  return protocol.emitCommand(member, command);
}

async function waitForFinalProjection(room, stateVersion) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < realtimeTimeoutMilliseconds) {
    if (
      room.members.every(
        (member) =>
          member.lastView?.public?.stateVersion >= stateVersion &&
          member.lastView?.public?.phase === 'QUEST_RESOLUTION' &&
          member.lastView?.public?.phaseStage === 'RESOLVED' &&
          member.lastView?.public?.questHistory?.length === 5,
      )
    ) {
      return performance.now() - startedAt;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('final M4 personalized projections timed out');
}

async function throttleHostCommands() {
  await new Promise((resolve) => setTimeout(resolve, 1_200));
}

async function waitForMemberProjection(member, stateVersion) {
  const startedAt = performance.now();
  while (performance.now() - startedAt < realtimeTimeoutMilliseconds) {
    if ((member.lastView?.public?.stateVersion ?? -1) >= stateVersion) {
      return member.lastView;
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('member projection timed out');
}

async function playFiveQuests(room, initialStateVersion, commandTimings) {
  const host = room.members[0];
  if (host === undefined) throw new Error('load room had no host');
  let stateVersion = initialStateVersion;
  const desiredFailures = [false, true, false, true, false];

  // Start/role acknowledgement is intentionally bursty. Let the per-session
  // five-second sustained command window clear before the host begins the
  // longer gameplay loop, then pace host-only phase gates below the limit.
  await new Promise((resolve) => setTimeout(resolve, 5_200));

  const submit = async (member, type, payload = {}) => {
    const result = await emitCommand(
      member,
      commandEnvelope(room.roomId, stateVersion, type, payload),
    );
    commandTimings.push(result.elapsed);
    stateVersion = result.result.stateVersion;
  };

  for (let questOffset = 0; questOffset < 5; questOffset += 1) {
    let hostView = await waitForMemberProjection(host, stateVersion);
    if (hostView.public.phase === 'QUEST_RESOLUTION') {
      await submit(host, 'ContinuePhase');
      await throttleHostCommands();
      hostView = await waitForMemberProjection(host, stateVersion);
    }
    if (
      hostView.public.phase !== 'TEAM_PROPOSAL' ||
      hostView.public.phaseStage !== 'HOST_HELD'
    ) {
      throw new Error('quest did not begin at the proposal host gate');
    }

    await submit(host, 'ContinuePhase');
    await throttleHostCommands();
    hostView = await waitForMemberProjection(host, stateVersion);
    const leader = room.members.find(
      (current) => current.playerId === hostView.public.leaderPlayerId,
    );
    if (leader === undefined) throw new Error('proposal leader was missing');
    const requiredTeamSize = hostView.public.requiredTeamSize;
    const requiredQuestFails = hostView.public.requiredQuestFails;
    if (
      !Number.isInteger(requiredTeamSize) ||
      !Number.isInteger(requiredQuestFails)
    ) {
      throw new Error('quest rule projection was incomplete');
    }

    const memberViews = await Promise.all(
      room.members.map(async (current) => ({
        member: current,
        view: await waitForMemberProjection(current, stateVersion),
      })),
    );
    const evilMembers = memberViews
      .filter(({ view }) => view.private.selfAlignment === 'EVIL')
      .map(({ member }) => member);
    const failQuest = desiredFailures[questOffset] === true;
    const evilNeeded = failQuest ? requiredQuestFails : 0;
    const team = evilMembers.slice(0, evilNeeded);
    for (const current of room.members) {
      if (team.length >= requiredTeamSize) break;
      if (!team.some((selected) => selected.playerId === current.playerId)) {
        team.push(current);
      }
    }
    if (team.length !== requiredTeamSize || evilMembers.length < evilNeeded) {
      throw new Error('could not build deterministic quest team');
    }

    await submit(leader, 'SubmitTeam', {
      teamPlayerIds: team.map((current) => current.playerId),
    });
    await submit(host, 'ContinuePhase');
    await throttleHostCommands();
    for (const current of room.members) {
      await submit(current, 'SubmitTeamVote', { vote: 'APPROVE' });
    }
    await submit(host, 'ContinuePhase');
    await throttleHostCommands();
    await submit(host, 'ContinuePhase');
    await throttleHostCommands();

    const failingIds = new Set(
      evilMembers.slice(0, evilNeeded).map((current) => current.playerId),
    );
    for (const current of team) {
      await submit(current, 'SubmitQuestChoice', {
        choice: failingIds.has(current.playerId) ? 'FAIL' : 'SUCCESS',
      });
    }
    const resolved = await waitForMemberProjection(host, stateVersion);
    const latestQuest = resolved.public.questHistory?.at(-1);
    if (
      resolved.public.phase !== 'QUEST_RESOLUTION' ||
      latestQuest?.questIndex !== questOffset + 1 ||
      latestQuest.result !== (failQuest ? 'FAILURE' : 'SUCCESS')
    ) {
      throw new Error('quest result diverged from the deterministic script');
    }
  }
  return stateVersion;
}

try {
  const createdRooms = await Promise.all(
    Array.from({ length: roomCount }, (_, roomIndex) =>
      timedRequest(
        '/v1/rooms',
        {
          nickname: `LoadHost${String(roomIndex)}`,
          config: {
            rulesVersion: 'CLASSIC_AVALON_V1',
            playerCount: playerCountForRoom(roomIndex),
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
        Array.from(
          { length: playerCountForRoom(roomIndex) - 1 },
          (_, playerIndex) =>
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
    playerCount: playerCountForRoom(roomIndex),
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
      .slice(connectionIndex, connectionIndex + room.playerCount)
      .map(({ member }) => member);
    connectionIndex += room.playerCount;
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

      stateVersion = await playFiveQuests(room, stateVersion, commandTimings);
      projectionTimings.push(await waitForFinalProjection(room, stateVersion));
      const authoritative = await protocol.readCurrentView(host.sessionToken);
      inspectProjection(host, authoritative);
      if (
        authoritative.public.roomId !== room.roomId ||
        authoritative.public.players.length !== room.playerCount ||
        authoritative.public.phase !== 'QUEST_RESOLUTION' ||
        authoritative.public.phaseStage !== 'RESOLVED' ||
        authoritative.public.questHistory.length !== 5
      ) {
        throw new Error('room did not finish the M4 five-quest flow');
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
      'M4 multi-room five-quest load smoke (zero request/command errors)',
      `rooms=${String(roomCount)}, connections=${String(rooms.reduce((total, room) => total + room.playerCount, 0))}, playerCounts=${fixedPlayerCount === undefined ? '5-10' : String(fixedPlayerCount)}, projectionIsolation=passed, publicSecretScan=passed`,
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
  protocol.closeAll();
}
