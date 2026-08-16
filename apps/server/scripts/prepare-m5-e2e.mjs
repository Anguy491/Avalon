import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';

import postgres from 'postgres';
import { createClient } from 'redis';

const apiOrigin = process.env.M5_E2E_API_ORIGIN ?? 'http://127.0.0.1:3000';
const expectedRealtimeUrl =
  process.env.M5_E2E_REALTIME_URL ?? 'wss://localhost:3443/game-v1';
const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;

if ((process.env.NODE_ENV ?? 'development') === 'production') {
  throw new Error('M5 verification fixtures must never run in production');
}
if (databaseUrl === undefined) {
  throw new Error('DATABASE_URL is required');
}
if (redisUrl === undefined) {
  throw new Error('REDIS_URL is required');
}

const client = {
  protocolVersion: 1,
  platform: 'IOS',
  appVersion: '0.1.0',
  installationId: randomUUID(),
  voicePackVersions: ['zh-CN-v1'],
};
const sql = postgres(databaseUrl, { max: 1, onnotice: () => undefined });

await sql`
  delete from avalon_runtime.rooms
   where room_id in (
     select room_id
       from avalon_runtime.players
      where nickname in ('M5Sim', 'Arthur')
   )
`;

async function request(path, body) {
  const response = await fetch(`${apiOrigin}${path}`, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Idempotency-Key': randomUUID(),
      'X-Protocol-Version': '1',
    },
    body: JSON.stringify(body),
  });
  if (!response.ok) {
    throw new Error(
      `Fixture request failed with status ${String(response.status)}`,
    );
  }
  return response.json();
}

const created = await request('/v1/rooms', {
  nickname: 'BotMerlin',
  config: {
    rulesVersion: 'CLASSIC_AVALON_V1',
    playerCount: 5,
    roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
    locale: 'zh-CN',
  },
  client,
});
if (created.realtimeUrl !== expectedRealtimeUrl) {
  throw new Error(
    `Start the local server with REALTIME_PUBLIC_URL=${expectedRealtimeUrl}`,
  );
}

for (const [index, nickname] of [
  'BotLoyal1',
  'BotLoyal2',
  'BotMinion',
].entries()) {
  await request(`/v1/rooms/${created.roomCode}/players`, {
    nickname,
    client: {
      ...client,
      installationId: randomUUID(),
      platform: index % 2 ? 'ANDROID' : 'IOS',
    },
  });
}

process.stdout.write(`M5_E2E_ROOM_CODE=${created.roomCode}\n`);
process.stdout.write('Waiting for simulator player M5Sim...\n');

const redis = createClient({ url: redisUrl });
try {
  let row;
  for (let attempt = 0; attempt < 240; attempt += 1) {
    const [candidate] = await sql`
      select room_id, state_version, aggregate
        from avalon_runtime.rooms
       where room_code = ${created.roomCode}
    `;
    const aggregate =
      typeof candidate?.aggregate === 'string'
        ? JSON.parse(candidate.aggregate)
        : candidate?.aggregate;
    if (
      candidate !== undefined &&
      aggregate?.players?.some((player) => player.nickname === 'M5Sim')
    ) {
      row = { ...candidate, aggregate };
      break;
    }
    await delay(250);
  }
  if (row === undefined) throw new Error('Timed out waiting for M5Sim');

  await delay(1_000);
  const players = [...row.aggregate.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const byName = new Map(players.map((player) => [player.nickname, player]));
  const merlin = byName.get('BotMerlin');
  const loyal1 = byName.get('BotLoyal1');
  const loyal2 = byName.get('BotLoyal2');
  const minion = byName.get('BotMinion');
  const assassin = byName.get('M5Sim');
  if (
    [merlin, loyal1, loyal2, minion, assassin].some(
      (player) => player === undefined,
    )
  ) {
    throw new Error('Fixture roster is incomplete');
  }

  const [simulatorSession] = await sql`
    select session_id
      from avalon_runtime.sessions
     where room_id = ${row.room_id}
       and player_id = ${assassin.playerId}
       and revoked_at is null
  `;
  if (simulatorSession === undefined) {
    throw new Error('Simulator session is missing');
  }
  await redis.connect();
  let realtimeReady = false;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const rawLease = await redis.get(
      `avalon:session-presence:${simulatorSession.session_id}`,
    );
    let lease;
    try {
      lease = rawLease === null ? undefined : JSON.parse(rawLease);
    } catch {
      lease = undefined;
    }
    if (
      lease?.roomId === row.room_id &&
      lease?.sessionId === simulatorSession.session_id
    ) {
      realtimeReady = true;
      break;
    }
    await delay(250);
  }
  if (!realtimeReady)
    throw new Error('Timed out waiting for simulator realtime');

  // The presence lease is written before ConnectionService persists the
  // connected player and advances the room version. Wait for that authority
  // update so this fixture cannot reuse its version and have the injected
  // projection superseded by the normal connection projection.
  let connectedRow;
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const [candidate] = await sql`
      select room_id, state_version, aggregate
        from avalon_runtime.rooms
       where room_id = ${row.room_id}
    `;
    const aggregate =
      typeof candidate?.aggregate === 'string'
        ? JSON.parse(candidate.aggregate)
        : candidate?.aggregate;
    if (
      candidate !== undefined &&
      aggregate?.players?.some(
        (player) =>
          player.playerId === assassin.playerId && player.connected === true,
      )
    ) {
      connectedRow = { ...candidate, aggregate };
      break;
    }
    await delay(250);
  }
  if (connectedRow === undefined) {
    throw new Error('Timed out waiting for connected room authority');
  }
  row = connectedRow;

  const roleAssignments = {
    [merlin.playerId]: 'MERLIN',
    [loyal1.playerId]: 'LOYAL_SERVANT',
    [loyal2.playerId]: 'LOYAL_SERVANT',
    [minion.playerId]: 'MINION',
    [assassin.playerId]: 'ASSASSIN',
  };
  const privateKnowledge = Object.fromEntries(
    players.map((player) => {
      const knownPlayers =
        player.playerId === merlin.playerId
          ? [
              { playerId: minion.playerId, knowledgeLabel: 'EVIL_PLAYER' },
              { playerId: assassin.playerId, knowledgeLabel: 'EVIL_PLAYER' },
            ]
          : player.playerId === assassin.playerId
            ? [
                {
                  playerId: minion.playerId,
                  knowledgeLabel: 'KNOWN_EVIL_ALLY',
                },
              ]
            : player.playerId === minion.playerId
              ? [
                  {
                    playerId: assassin.playerId,
                    knowledgeLabel: 'KNOWN_EVIL_ALLY',
                  },
                ]
              : [];
      return [player.playerId, { playerId: player.playerId, knownPlayers }];
    }),
  );
  const votes = Object.fromEntries(
    players.map((player) => [player.playerId, 'APPROVE']),
  );
  const teamIds = [merlin.playerId, loyal1.playerId];
  const proposalHistory = [1, 2, 3].map((questIndex) => ({
    questIndex,
    proposalAttempt: 1,
    leaderPlayerId: players[(questIndex - 1) % players.length].playerId,
    teamPlayerIds: teamIds,
    votes,
    approveCount: 5,
    rejectCount: 0,
    approved: true,
  }));
  const questHistory = [1, 2, 3].map((questIndex) => ({
    questIndex,
    leaderPlayerId: players[(questIndex - 1) % players.length].playerId,
    teamPlayerIds: teamIds,
    successChoices: 2,
    failChoices: 0,
    requiredFails: 1,
    result: 'SUCCESS',
  }));
  const nextVersion = row.state_version + 1;
  const aggregate = {
    ...row.aggregate,
    stateVersion: nextVersion,
    players: players.map((player) => ({
      ...player,
      ready: true,
      connected: true,
    })),
    phase: 'ASSASSINATION',
    phaseStage: 'COLLECTING',
    leaderSeatIndex: 2,
    questIndex: 3,
    proposalAttempt: 1,
    proposedTeam: [],
    teamVotes: {},
    questChoices: {},
    roleAcknowledgements: [],
    proposalHistory,
    questHistory,
    successCount: 3,
    failureCount: 0,
    roleAssignments,
    privateKnowledge,
    pendingTransition: undefined,
    gameOutcome: undefined,
    resumePoint: undefined,
    pauseReasons: [],
    currentAudioCue: undefined,
  };
  const outboxId = randomUUID();
  const eventId = randomUUID();
  const now = new Date();
  await sql.begin(async (transaction) => {
    await transaction`
      update avalon_runtime.rooms
         set state_version = ${nextVersion}, phase = 'ASSASSINATION',
             aggregate = ${transaction.json(aggregate)},
             terminal_published_at = null, cleanup_after = null
       where room_id = ${row.room_id}
    `;
    await transaction`
      insert into avalon_runtime.outbox
        (outbox_id, event_id, room_id, state_version, event_type,
         created_at, available_at)
      values
        (${outboxId}, ${eventId}, ${row.room_id}, ${nextVersion},
         'ROOM_VIEW_CHANGED', ${now}, ${now})
    `;
  });
  process.stdout.write('M5_E2E_ASSASSINATION_READY=1\n');
} finally {
  if (redis.isOpen) await redis.quit();
  await sql.end({ timeout: 2 });
}
