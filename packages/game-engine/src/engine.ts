import { assertGameInvariants } from './invariants.js';
import { calculatePrivateKnowledge } from './knowledge.js';
import { randomIndex, shuffle } from './random.js';
import {
  alignmentForRole,
  requiredFails,
  requiredTeamSize,
  validateRoomConfig,
} from './rules.js';
import type {
  ActiveGamePhase,
  AudioCue,
  AudioCueKey,
  CommandResult,
  DomainEffect,
  EngineErrorCode,
  EnginePorts,
  EngineTransition,
  GameCommand,
  GameOutcome,
  GameState,
  PendingTransition,
  Player,
  ProposalAttempt,
  QuestIndex,
  QuestRecord,
  RoleId,
  RoomConfig,
  SystemTransition,
} from './types.js';

interface HandlerSuccess {
  readonly ok: true;
  readonly state: GameState;
  readonly effects: readonly DomainEffect[];
}

interface HandlerFailure {
  readonly ok: false;
  readonly errorCode: EngineErrorCode;
}

type HandlerResult = HandlerSuccess | HandlerFailure;

function failure(errorCode: EngineErrorCode): HandlerFailure {
  return { ok: false, errorCode };
}

function success(
  state: GameState,
  effects: readonly DomainEffect[] = [],
): HandlerSuccess {
  return { ok: true, state, effects };
}

function hostPlayerId(players: readonly Player[]): string {
  const hosts = players.filter((player) => player.isHost);
  if (hosts.length !== 1 || hosts[0] === undefined) {
    throw new RangeError('Exactly one host player is required');
  }
  return hosts[0].playerId;
}

export function createInitialGameState(
  config: RoomConfig,
  players: readonly Player[],
): GameState {
  const state: GameState = {
    stateVersion: 0,
    config,
    players: [...players].sort((left, right) => left.seat - right.seat),
    hostPlayerId: hostPlayerId(players),
    phase: 'LOBBY',
    phaseStage: 'HOST_HELD',
    leaderSeatIndex: 0,
    questIndex: 1,
    proposalAttempt: 1,
    proposedTeam: [],
    teamVotes: {},
    questChoices: {},
    roleAcknowledgements: [],
    proposalHistory: [],
    questHistory: [],
    successCount: 0,
    failureCount: 0,
    roleAssignments: {},
    privateKnowledge: {},
    pauseReasons: [],
    processedCommands: {},
  };
  assertGameInvariants(state);
  return state;
}

function nextLeaderSeat(state: GameState): number {
  return (state.leaderSeatIndex + 1) % state.players.length;
}

function leaderPlayerId(state: GameState): string {
  const leader = state.players.find(
    (player) => player.seat === state.leaderSeatIndex,
  );
  if (leader === undefined) throw new RangeError('Leader seat has no player');
  return leader.playerId;
}

function cue(
  state: GameState,
  phase: GameState['phase'],
  key: AudioCueKey,
  ports: EnginePorts,
  replayOf?: string,
): { readonly audioCue: AudioCue; readonly effect: DomainEffect } {
  const audioCue: AudioCue = {
    audioCueId: ports.ids.nextId(),
    audioCueKey: key,
    subtitleKey: key,
    voicePackVersion: state.config.voicePackVersion,
    phase,
    ...(replayOf === undefined ? {} : { replayOf }),
    createdAt: ports.clock.nowIso(),
  };
  return {
    audioCue,
    effect: { type: 'AUDIO_CUE_REQUESTED', cue: audioCue },
  };
}

function withCue(
  state: GameState,
  phase: GameState['phase'],
  key: AudioCueKey,
  ports: EnginePorts,
): HandlerSuccess {
  const created = cue(state, phase, key, ports);
  return success({ ...state, currentAudioCue: created.audioCue }, [
    created.effect,
  ]);
}

function assignRoles(
  state: GameState,
  ports: EnginePorts,
): Readonly<Record<string, RoleId>> {
  const shuffledRoles = shuffle(state.config.roleIds, ports.random);
  const assignments: Record<string, RoleId> = {};
  state.players.forEach((player, index) => {
    const roleId = shuffledRoles[index];
    if (roleId === undefined) throw new RangeError('Role deck is incomplete');
    assignments[player.playerId] = roleId;
  });
  return assignments;
}

function startGame(
  state: GameState,
  command: Extract<GameCommand, { type: 'StartGame' }>,
  ports: EnginePorts,
): HandlerResult {
  if (command.actorPlayerId !== state.hostPlayerId) return failure('NOT_HOST');
  if (state.phase !== 'LOBBY') return failure('INVALID_PHASE');
  if (!validateRoomConfig(state.config).ok) return failure('INVALID_CONFIG');
  if (state.players.length !== state.config.playerCount) {
    return failure('PLAYERS_NOT_READY');
  }
  if (state.players.some((player) => !player.ready)) {
    return failure('PLAYERS_NOT_READY');
  }
  if (state.players.some((player) => !player.connected)) {
    return failure('PLAYERS_OFFLINE');
  }

  const roleAssignments = assignRoles(state, ports);
  const started: GameState = {
    ...state,
    phase: 'ROLE_REVEAL',
    phaseStage: 'HOST_HELD',
    leaderSeatIndex: randomIndex(state.players.length, ports.random),
    roleAssignments,
    privateKnowledge: calculatePrivateKnowledge(state.players, roleAssignments),
  };
  return withCue(started, 'ROLE_REVEAL', 'game.role.reveal', ports);
}

function nextResolvedPhase(
  state: GameState,
  transition: PendingTransition,
  ports: EnginePorts,
): HandlerResult {
  switch (transition) {
    case 'NEXT_PROPOSAL':
    case 'NEXT_QUEST':
      return withCue(
        {
          ...state,
          phase: 'TEAM_PROPOSAL',
          phaseStage: 'HOST_HELD',
          proposedTeam: [],
          teamVotes: {},
          questChoices: {},
          pendingTransition: undefined,
        },
        'TEAM_PROPOSAL',
        'game.team.proposal',
        ports,
      );
    case 'QUEST_SUBMISSION':
      return withCue(
        {
          ...state,
          phase: 'QUEST_SUBMISSION',
          phaseStage: 'HOST_HELD',
          questChoices: {},
          pendingTransition: undefined,
        },
        'QUEST_SUBMISSION',
        'game.quest.submission',
        ports,
      );
    case 'ASSASSINATION':
      return withCue(
        {
          ...state,
          phase: 'ASSASSINATION',
          phaseStage: 'HOST_HELD',
          pendingTransition: undefined,
        },
        'ASSASSINATION',
        'game.assassination',
        ports,
      );
    case 'GAME_OVER': {
      const key: AudioCueKey =
        state.gameOutcome?.winner === 'GOOD'
          ? 'game.good.wins'
          : state.gameOutcome?.winner === 'EVIL'
            ? 'game.evil.wins'
            : 'game.aborted';
      return withCue(
        {
          ...state,
          phase: 'GAME_OVER',
          phaseStage: 'RESOLVED',
          pendingTransition: undefined,
        },
        'GAME_OVER',
        key,
        ports,
      );
    }
  }
}

function continuePhase(
  state: GameState,
  command: Extract<GameCommand, { type: 'ContinuePhase' }>,
  ports: EnginePorts,
): HandlerResult {
  if (command.actorPlayerId !== state.hostPlayerId) return failure('NOT_HOST');
  if (state.phase === 'PAUSED' || state.phase === 'LOBBY') {
    return failure('INVALID_PHASE');
  }
  if (state.phaseStage === 'HOST_HELD') {
    return success({ ...state, phaseStage: 'COLLECTING' });
  }
  if (
    state.phaseStage !== 'RESOLVED' ||
    state.pendingTransition === undefined
  ) {
    return failure('INVALID_PHASE_STAGE');
  }
  return nextResolvedPhase(state, state.pendingTransition, ports);
}

function acknowledgeRole(
  state: GameState,
  command: Extract<GameCommand, { type: 'AckRole' }>,
  ports: EnginePorts,
): HandlerResult {
  if (state.phase !== 'ROLE_REVEAL') return failure('INVALID_PHASE');
  if (state.phaseStage !== 'COLLECTING') return failure('INVALID_PHASE_STAGE');
  if (state.roleAcknowledgements.includes(command.actorPlayerId)) {
    return failure('ALREADY_SUBMITTED');
  }
  const roleAcknowledgements = [
    ...state.roleAcknowledgements,
    command.actorPlayerId,
  ];
  if (roleAcknowledgements.length < state.players.length) {
    return success({ ...state, roleAcknowledgements });
  }
  return withCue(
    {
      ...state,
      roleAcknowledgements: [],
      phase: 'TEAM_PROPOSAL',
      phaseStage: 'HOST_HELD',
    },
    'TEAM_PROPOSAL',
    'game.team.proposal',
    ports,
  );
}

function submitTeam(
  state: GameState,
  command: Extract<GameCommand, { type: 'SubmitTeam' }>,
  ports: EnginePorts,
): HandlerResult {
  if (state.phase !== 'TEAM_PROPOSAL') return failure('INVALID_PHASE');
  if (state.phaseStage !== 'COLLECTING') return failure('INVALID_PHASE_STAGE');
  if (command.actorPlayerId !== leaderPlayerId(state))
    return failure('NOT_LEADER');
  if (
    command.teamPlayerIds.length !==
    requiredTeamSize(state.config.playerCount, state.questIndex)
  ) {
    return failure('INVALID_TEAM_SIZE');
  }
  if (
    new Set(command.teamPlayerIds).size !== command.teamPlayerIds.length ||
    command.teamPlayerIds.some(
      (playerId) =>
        !state.players.some((player) => player.playerId === playerId),
    )
  ) {
    return failure('INVALID_TEAM_MEMBER');
  }
  return withCue(
    {
      ...state,
      proposedTeam: [...command.teamPlayerIds],
      teamVotes: {},
      phase: 'TEAM_VOTE',
      phaseStage: 'HOST_HELD',
    },
    'TEAM_VOTE',
    'game.team.vote',
    ports,
  );
}

function submitTeamVote(
  state: GameState,
  command: Extract<GameCommand, { type: 'SubmitTeamVote' }>,
  ports: EnginePorts,
): HandlerResult {
  if (state.phase !== 'TEAM_VOTE') return failure('INVALID_PHASE');
  if (state.phaseStage !== 'COLLECTING') return failure('INVALID_PHASE_STAGE');
  if (state.teamVotes[command.actorPlayerId] !== undefined) {
    return failure('ALREADY_SUBMITTED');
  }
  const teamVotes = {
    ...state.teamVotes,
    [command.actorPlayerId]: command.vote,
  };
  if (Object.keys(teamVotes).length < state.players.length) {
    return success({ ...state, teamVotes });
  }

  const approveCount = Object.values(teamVotes).filter(
    (vote) => vote === 'APPROVE',
  ).length;
  const rejectCount = state.players.length - approveCount;
  const approved = approveCount > Math.floor(state.players.length / 2);
  const proposalHistory = [
    ...state.proposalHistory,
    {
      questIndex: state.questIndex,
      proposalAttempt: state.proposalAttempt,
      leaderPlayerId: leaderPlayerId(state),
      teamPlayerIds: state.proposedTeam,
      votes: teamVotes,
      approveCount,
      rejectCount,
      approved,
    },
  ];

  let resolved: GameState;
  let key: AudioCueKey;
  if (approved) {
    resolved = {
      ...state,
      teamVotes,
      proposalHistory,
      phaseStage: 'RESOLVED',
      pendingTransition: 'QUEST_SUBMISSION',
    };
    key = 'game.team.approved';
  } else if (state.proposalAttempt === 5) {
    resolved = {
      ...state,
      teamVotes,
      proposalHistory,
      phaseStage: 'RESOLVED',
      pendingTransition: 'GAME_OVER',
      gameOutcome: { winner: 'EVIL', reason: 'FIVE_REJECTED_TEAMS' },
    };
    key = 'game.team.rejected';
  } else {
    resolved = {
      ...state,
      teamVotes,
      proposalHistory,
      leaderSeatIndex: nextLeaderSeat(state),
      proposalAttempt: (state.proposalAttempt + 1) as ProposalAttempt,
      phaseStage: 'RESOLVED',
      pendingTransition: 'NEXT_PROPOSAL',
    };
    key = 'game.team.rejected';
  }
  return withCue(resolved, 'TEAM_VOTE', key, ports);
}

function submitQuestChoice(
  state: GameState,
  command: Extract<GameCommand, { type: 'SubmitQuestChoice' }>,
  ports: EnginePorts,
): HandlerResult {
  if (state.phase !== 'QUEST_SUBMISSION') return failure('INVALID_PHASE');
  if (state.phaseStage !== 'COLLECTING') return failure('INVALID_PHASE_STAGE');
  if (!state.proposedTeam.includes(command.actorPlayerId)) {
    return failure('PLAYER_NOT_ON_TEAM');
  }
  if (state.questChoices[command.actorPlayerId] !== undefined) {
    return failure('ALREADY_SUBMITTED');
  }
  const roleId = state.roleAssignments[command.actorPlayerId];
  if (roleId === undefined) throw new RangeError('Quest player has no role');
  if (command.choice === 'FAIL' && alignmentForRole(roleId) === 'GOOD') {
    return failure('GOOD_CANNOT_FAIL');
  }

  const questChoices = {
    ...state.questChoices,
    [command.actorPlayerId]: command.choice,
  };
  if (Object.keys(questChoices).length < state.proposedTeam.length) {
    return success({ ...state, questChoices });
  }

  const failChoices = Object.values(questChoices).filter(
    (choice) => choice === 'FAIL',
  ).length;
  const successChoices = state.proposedTeam.length - failChoices;
  const failureThreshold = requiredFails(
    state.config.playerCount,
    state.questIndex,
  );
  const questSucceeded = failChoices < failureThreshold;
  const questRecord: QuestRecord = {
    questIndex: state.questIndex,
    leaderPlayerId: leaderPlayerId(state),
    teamPlayerIds: state.proposedTeam,
    successChoices,
    failChoices,
    requiredFails: failureThreshold,
    result: questSucceeded ? 'SUCCESS' : 'FAILURE',
  };
  const successCount = state.successCount + (questSucceeded ? 1 : 0);
  const failureCount = state.failureCount + (questSucceeded ? 0 : 1);

  let pendingTransition: PendingTransition;
  let gameOutcome: GameOutcome | undefined;
  let questIndex = state.questIndex;
  let proposalAttempt = state.proposalAttempt;
  let leaderSeatIndex = state.leaderSeatIndex;
  if (failureCount === 3) {
    pendingTransition = 'GAME_OVER';
    gameOutcome = { winner: 'EVIL', reason: 'THREE_QUEST_FAILURES' };
  } else if (successCount === 3) {
    pendingTransition = 'ASSASSINATION';
  } else {
    pendingTransition = 'NEXT_QUEST';
    questIndex = (state.questIndex + 1) as QuestIndex;
    proposalAttempt = 1;
    leaderSeatIndex = nextLeaderSeat(state);
  }

  const resolved: GameState = {
    ...state,
    phase: 'QUEST_RESOLUTION',
    phaseStage: 'RESOLVED',
    questChoices: {},
    questHistory: [...state.questHistory, questRecord],
    successCount,
    failureCount,
    questIndex,
    proposalAttempt,
    leaderSeatIndex,
    pendingTransition,
    ...(gameOutcome === undefined ? {} : { gameOutcome }),
  };
  return withCue(
    resolved,
    'QUEST_RESOLUTION',
    questSucceeded ? 'game.quest.success' : 'game.quest.failure',
    ports,
  );
}

function selectMerlinTarget(
  state: GameState,
  command: Extract<GameCommand, { type: 'SelectMerlinTarget' }>,
  ports: EnginePorts,
): HandlerResult {
  if (state.phase !== 'ASSASSINATION') return failure('INVALID_PHASE');
  if (state.phaseStage !== 'COLLECTING') return failure('INVALID_PHASE_STAGE');
  if (state.roleAssignments[command.actorPlayerId] !== 'ASSASSIN') {
    return failure('NOT_ASSASSIN');
  }
  if (
    command.targetPlayerId === command.actorPlayerId ||
    !state.players.some((player) => player.playerId === command.targetPlayerId)
  ) {
    return failure('INVALID_TARGET');
  }
  const targetRole = state.roleAssignments[command.targetPlayerId];
  const hit = targetRole === 'MERLIN';
  const outcome: GameOutcome = {
    winner: hit ? 'EVIL' : 'GOOD',
    reason: hit ? 'MERLIN_ASSASSINATED' : 'MERLIN_SURVIVED',
    assassinationTargetPlayerId: command.targetPlayerId,
  };
  return withCue(
    {
      ...state,
      phase: 'GAME_OVER',
      phaseStage: 'RESOLVED',
      gameOutcome: outcome,
    },
    'GAME_OVER',
    hit ? 'game.evil.wins' : 'game.good.wins',
    ports,
  );
}

function pauseGame(
  state: GameState,
  command: Extract<GameCommand, { type: 'PauseGame' }>,
): HandlerResult {
  if (command.actorPlayerId !== state.hostPlayerId) return failure('NOT_HOST');
  if (
    state.phase === 'LOBBY' ||
    state.phase === 'PAUSED' ||
    state.phase === 'GAME_OVER' ||
    state.gameOutcome !== undefined
  ) {
    return failure('INVALID_PHASE');
  }
  return success({
    ...state,
    phase: 'PAUSED',
    resumePoint: {
      phase: state.phase as ActiveGamePhase,
      phaseStage: state.phaseStage,
    },
    pauseReasons: [...state.pauseReasons, 'MANUAL'],
  });
}

function resumeGame(
  state: GameState,
  command: Extract<GameCommand, { type: 'ResumeGame' }>,
): HandlerResult {
  if (command.actorPlayerId !== state.hostPlayerId) return failure('NOT_HOST');
  if (
    state.phase !== 'PAUSED' ||
    state.resumePoint === undefined ||
    !state.pauseReasons.includes('MANUAL')
  ) {
    return failure('INVALID_PHASE');
  }
  const pauseReasons = state.pauseReasons.filter(
    (reason) => reason !== 'MANUAL',
  );
  if (pauseReasons.length > 0) {
    return success({ ...state, pauseReasons });
  }
  return success({
    ...state,
    phase: state.resumePoint.phase,
    phaseStage: state.resumePoint.phaseStage,
    pauseReasons: [],
    resumePoint: undefined,
  });
}

function replayAudioCue(
  state: GameState,
  command: Extract<GameCommand, { type: 'ReplayAudioCue' }>,
  ports: EnginePorts,
): HandlerResult {
  if (command.actorPlayerId !== state.hostPlayerId) return failure('NOT_HOST');
  if (
    state.currentAudioCue === undefined ||
    state.currentAudioCue.audioCueId !== command.audioCueId
  ) {
    return failure('AUDIO_CUE_NOT_FOUND');
  }
  const created = cue(
    state,
    state.currentAudioCue.phase,
    state.currentAudioCue.audioCueKey,
    ports,
    state.currentAudioCue.audioCueId,
  );
  return success({ ...state, currentAudioCue: created.audioCue }, [
    created.effect,
  ]);
}

function dispatch(
  state: GameState,
  command: GameCommand,
  ports: EnginePorts,
): HandlerResult {
  if (
    !state.players.some((player) => player.playerId === command.actorPlayerId)
  ) {
    return failure('INVALID_TARGET');
  }
  switch (command.type) {
    case 'StartGame':
      return startGame(state, command, ports);
    case 'ContinuePhase':
      return continuePhase(state, command, ports);
    case 'AckRole':
      return acknowledgeRole(state, command, ports);
    case 'SubmitTeam':
      return submitTeam(state, command, ports);
    case 'SubmitTeamVote':
      return submitTeamVote(state, command, ports);
    case 'SubmitQuestChoice':
      return submitQuestChoice(state, command, ports);
    case 'SelectMerlinTarget':
      return selectMerlinTarget(state, command, ports);
    case 'PauseGame':
      return pauseGame(state, command);
    case 'ResumeGame':
      return resumeGame(state, command);
    case 'ReplayAudioCue':
      return replayAudioCue(state, command, ports);
  }
}

function rejected(
  state: GameState,
  errorCode: EngineErrorCode,
): EngineTransition {
  const result: CommandResult = {
    accepted: false,
    errorCode,
    currentStateVersion: state.stateVersion,
  };
  return { state, result, effects: [] };
}

export function executeCommand(
  state: GameState,
  command: GameCommand,
  ports: EnginePorts,
): EngineTransition {
  const processed = state.processedCommands[command.commandId];
  if (processed !== undefined) {
    if (processed.requestDigest !== command.requestDigest) {
      return rejected(state, 'DUPLICATE_COMMAND_CONFLICT');
    }
    return {
      state,
      result: {
        accepted: true,
        stateVersion: processed.acceptedStateVersion,
        idempotentReplay: true,
      },
      effects: [],
    };
  }
  if (command.expectedStateVersion !== state.stateVersion) {
    return rejected(state, 'STALE_VERSION');
  }
  if (state.phase === 'GAME_OVER' && command.type !== 'ReplayAudioCue') {
    return rejected(state, 'INVALID_PHASE');
  }

  const handled = dispatch(state, command, ports);
  if (!handled.ok) return rejected(state, handled.errorCode);

  const stateVersion = state.stateVersion + 1;
  const nextState: GameState = {
    ...handled.state,
    stateVersion,
    processedCommands: {
      ...state.processedCommands,
      [command.commandId]: {
        requestDigest: command.requestDigest,
        acceptedStateVersion: stateVersion,
      },
    },
  };
  assertGameInvariants(nextState);
  return {
    state: nextState,
    result: { accepted: true, stateVersion, idempotentReplay: false },
    effects: handled.effects,
  };
}

function connectionPauseReasons(
  state: GameState,
): readonly GameState['pauseReasons'][number][] {
  const offlinePlayers = state.players.filter((player) => !player.connected);
  const connectionReasons: GameState['pauseReasons'][number][] = [];
  if (offlinePlayers.some((player) => player.playerId === state.hostPlayerId)) {
    connectionReasons.push('HOST_DISCONNECTED');
  }
  if (offlinePlayers.some((player) => player.playerId !== state.hostPlayerId)) {
    connectionReasons.push('PLAYER_DISCONNECTED');
  }
  return connectionReasons;
}

export function applyConnectionChanged(
  state: GameState,
  playerId: string,
  connected: boolean,
): SystemTransition {
  const target = state.players.find((player) => player.playerId === playerId);
  if (target === undefined || target.connected === connected) {
    return { state, effects: [] };
  }
  const players = state.players.map((player) =>
    player.playerId === playerId ? { ...player, connected } : player,
  );
  let changed: GameState = { ...state, players };
  if (state.phase !== 'LOBBY' && state.phase !== 'GAME_OVER') {
    const manual = state.pauseReasons.includes('MANUAL')
      ? ['MANUAL' as const]
      : [];
    const pauseReasons = [...manual, ...connectionPauseReasons(changed)];
    if (pauseReasons.length > 0) {
      const resumePoint =
        state.phase === 'PAUSED'
          ? state.resumePoint
          : {
              phase: state.phase as ActiveGamePhase,
              phaseStage: state.phaseStage,
            };
      if (resumePoint === undefined) {
        throw new Error('Paused state lost its resume point');
      }
      changed = {
        ...changed,
        phase: 'PAUSED',
        resumePoint,
        pauseReasons,
      };
    } else if (state.phase === 'PAUSED' && state.resumePoint !== undefined) {
      changed = {
        ...changed,
        phase: state.resumePoint.phase,
        phaseStage: state.resumePoint.phaseStage,
        pauseReasons: [],
        resumePoint: undefined,
      };
    }
  }
  changed = { ...changed, stateVersion: state.stateVersion + 1 };
  assertGameInvariants(changed);
  return { state: changed, effects: [] };
}

export function expirePausedGame(
  state: GameState,
  ports: EnginePorts,
): SystemTransition {
  if (state.phase !== 'PAUSED') return { state, effects: [] };
  const outcome: GameOutcome = { winner: 'NONE', reason: 'ABORTED' };
  const created = cue(state, 'GAME_OVER', 'game.aborted', ports);
  const changed: GameState = {
    ...state,
    stateVersion: state.stateVersion + 1,
    phase: 'GAME_OVER',
    phaseStage: 'RESOLVED',
    pauseReasons: [],
    resumePoint: undefined,
    gameOutcome: outcome,
    currentAudioCue: created.audioCue,
  };
  assertGameInvariants(changed);
  return { state: changed, effects: [created.effect] };
}
