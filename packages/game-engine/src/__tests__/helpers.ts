import {
  createInitialGameState,
  executeCommand,
  expandPreset,
  requiredTeamSize,
  type EnginePorts,
  type GameCommand,
  type GameState,
  type Player,
  type PlayerCount,
  type QuestChoice,
  type RoleId,
  type RoomConfig,
  type TeamVote,
} from '../index.js';

export const PLAYER_IDS = Array.from(
  { length: 10 },
  (_, index) => `player-${String(index + 1)}`,
);

export function players(count: PlayerCount): readonly Player[] {
  return PLAYER_IDS.slice(0, count).map((playerId, seat) => ({
    playerId,
    nickname: `Player ${String(seat + 1)}`,
    seat,
    isHost: seat === 0,
    ready: true,
    connected: true,
  }));
}

export function config(
  count: PlayerCount,
  roleIds: readonly RoleId[] = expandPreset(count, 'CLASSIC'),
): RoomConfig {
  return {
    rulesVersion: 'CLASSIC_AVALON_V1',
    playerCount: count,
    roleIds,
    locale: 'zh-CN',
    voicePackVersion: 'zh-CN-v1',
  };
}

export function fixedPorts(bytes: readonly number[] = [0]): EnginePorts {
  let byteIndex = 0;
  let idIndex = 0;
  return {
    random: {
      bytes: (length) =>
        Uint8Array.from(
          Array.from({ length }, () => {
            const value = bytes[byteIndex % bytes.length];
            byteIndex += 1;
            return value ?? 0;
          }),
        ),
    },
    clock: { nowIso: () => '2026-08-13T10:00:00.000Z' },
    ids: {
      nextId: () => {
        idIndex += 1;
        return `audio-${String(idIndex)}`;
      },
    },
  };
}

let commandSequence = 0;

export type TestCommandBody =
  | { readonly type: 'StartGame' }
  | { readonly type: 'ContinuePhase' }
  | { readonly type: 'AckRole' }
  | { readonly type: 'SubmitTeam'; readonly teamPlayerIds: readonly string[] }
  | { readonly type: 'SubmitTeamVote'; readonly vote: TeamVote }
  | { readonly type: 'SubmitQuestChoice'; readonly choice: QuestChoice }
  | { readonly type: 'SelectMerlinTarget'; readonly targetPlayerId: string }
  | { readonly type: 'PauseGame' }
  | { readonly type: 'ResumeGame' }
  | { readonly type: 'ReplayAudioCue'; readonly audioCueId: string };

export function command(
  state: GameState,
  actorPlayerId: string,
  body: TestCommandBody,
  overrides: Partial<
    Pick<GameCommand, 'commandId' | 'requestDigest' | 'expectedStateVersion'>
  > = {},
): GameCommand {
  commandSequence += 1;
  return {
    ...body,
    commandId: overrides.commandId ?? `command-${String(commandSequence)}`,
    requestDigest:
      overrides.requestDigest ?? `digest-${String(commandSequence)}`,
    expectedStateVersion: overrides.expectedStateVersion ?? state.stateVersion,
    actorPlayerId,
  } as GameCommand;
}

export function accepted(
  state: GameState,
  actorPlayerId: string,
  body: TestCommandBody,
  ports: EnginePorts,
): GameState {
  const transition = executeCommand(
    state,
    command(state, actorPlayerId, body),
    ports,
  );
  if (!transition.result.accepted) {
    throw new Error(`Command rejected: ${transition.result.errorCode}`);
  }
  return transition.state;
}

export function startAndAcknowledge(
  count: PlayerCount,
  ports: EnginePorts,
  roleIds?: readonly RoleId[],
): GameState {
  const gamePlayers = players(count);
  let state = createInitialGameState(config(count, roleIds), gamePlayers);
  state = accepted(
    state,
    gamePlayers[0]?.playerId ?? '',
    { type: 'StartGame' },
    ports,
  );
  state = accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
  for (const player of gamePlayers) {
    state = accepted(state, player.playerId, { type: 'AckRole' }, ports);
  }
  return state;
}

export function playerWithRole(state: GameState, roleId: RoleId): string {
  const playerId = Object.entries(state.roleAssignments).find(
    ([, role]) => role === roleId,
  )?.[0];
  if (playerId === undefined) throw new Error(`Missing role ${roleId}`);
  return playerId;
}

function currentLeader(state: GameState): string {
  const leader = state.players.find(
    (player) => player.seat === state.leaderSeatIndex,
  );
  if (leader === undefined) throw new Error('Missing leader');
  return leader.playerId;
}

export function approveTeam(
  state: GameState,
  team: readonly string[],
  ports: EnginePorts,
): GameState {
  let next = accepted(
    state,
    state.hostPlayerId,
    { type: 'ContinuePhase' },
    ports,
  );
  next = accepted(
    next,
    currentLeader(next),
    { type: 'SubmitTeam', teamPlayerIds: team },
    ports,
  );
  next = accepted(next, next.hostPlayerId, { type: 'ContinuePhase' }, ports);
  for (const player of next.players) {
    next = accepted(
      next,
      player.playerId,
      { type: 'SubmitTeamVote', vote: 'APPROVE' },
      ports,
    );
  }
  return accepted(next, next.hostPlayerId, { type: 'ContinuePhase' }, ports);
}

export function settleQuest(
  state: GameState,
  team: readonly string[],
  failingPlayers: ReadonlySet<string>,
  ports: EnginePorts,
): GameState {
  let next = approveTeam(state, team, ports);
  next = accepted(next, next.hostPlayerId, { type: 'ContinuePhase' }, ports);
  for (const playerId of team) {
    next = accepted(
      next,
      playerId,
      {
        type: 'SubmitQuestChoice',
        choice: failingPlayers.has(playerId) ? 'FAIL' : 'SUCCESS',
      },
      ports,
    );
  }
  return next;
}

export function teamForQuest(
  state: GameState,
  preferred: readonly string[] = [],
): readonly string[] {
  const official = requiredTeamSize(state.config.playerCount, state.questIndex);
  const ordered = [
    ...preferred,
    ...state.players.map((player) => player.playerId),
  ];
  return [...new Set(ordered)].slice(0, official);
}
