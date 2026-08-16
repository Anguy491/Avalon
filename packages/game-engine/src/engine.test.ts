import { describe, expect, it } from 'vitest';

import {
  alignmentForRole,
  applyConnectionChanged,
  buildPrivatePlayerState,
  buildPublicGameState,
  collectInvariantViolations,
  createInitialGameState,
  executeCommand,
  expirePauseTerminationVote,
  expirePausedGame,
  type EnginePorts,
  type GameState,
} from './index.js';
import {
  accepted,
  approveTeam,
  command,
  config,
  fixedPorts,
  playerWithRole,
  players,
  settleQuest,
  startAndAcknowledge,
  teamForQuest,
} from './__tests__/helpers.js';

function leader(state: GameState): string {
  const player = state.players.find(
    (candidate) => candidate.seat === state.leaderSeatIndex,
  );
  if (player === undefined) throw new Error('Leader missing');
  return player.playerId;
}

function controllablePorts() {
  let now = '2026-08-13T10:00:00.000Z';
  const base = fixedPorts();
  return {
    ports: {
      ...base,
      clock: { ...base.clock, nowIso: () => now },
    } satisfies EnginePorts,
    setNow(value: string) {
      now = value;
    },
  };
}

function continueAfterResolution(
  state: GameState,
  ports: ReturnType<typeof fixedPorts>,
) {
  return accepted(state, state.hostPlayerId, { type: 'ContinuePhase' }, ports);
}

function evilPlayers(state: GameState): readonly string[] {
  return state.players
    .filter((player) => {
      const role = state.roleAssignments[player.playerId];
      return role !== undefined && alignmentForRole(role) === 'EVIL';
    })
    .map((player) => player.playerId);
}

describe('M1 command envelope / SM-007–SM-016 idempotency and versions', () => {
  it('starts once, returns the original result on replay, and rejects digest reuse/stale versions', () => {
    const ports = fixedPorts();
    const initial = createInitialGameState(config(5), players(5));
    const start = command(initial, initial.hostPlayerId, { type: 'StartGame' });
    const first = executeCommand(initial, start, ports);
    expect(first.result).toEqual({
      accepted: true,
      stateVersion: 1,
      idempotentReplay: false,
    });
    expect(first.state.phase).toBe('ROLE_REVEAL');
    expect(first.effects).toHaveLength(1);

    const replay = executeCommand(first.state, start, ports);
    expect(replay.state).toBe(first.state);
    expect(replay.result).toEqual({
      accepted: true,
      stateVersion: 1,
      idempotentReplay: true,
    });
    expect(replay.effects).toEqual([]);

    const conflict = executeCommand(
      first.state,
      { ...start, requestDigest: 'changed-digest' },
      ports,
    );
    expect(conflict.result).toMatchObject({
      accepted: false,
      errorCode: 'DUPLICATE_COMMAND_CONFLICT',
    });
    const stale = executeCommand(
      first.state,
      command(
        first.state,
        first.state.hostPlayerId,
        { type: 'ContinuePhase' },
        {
          expectedStateVersion: 0,
        },
      ),
      ports,
    );
    expect(stale.result).toMatchObject({
      accepted: false,
      errorCode: 'STALE_VERSION',
    });
    expect(stale.state.stateVersion).toBe(1);
  });

  it('rejects StartGame for a non-host, incomplete readiness, offline player, and wrong phase', () => {
    const ports = fixedPorts();
    const ready = createInitialGameState(config(5), players(5));
    expect(
      executeCommand(
        ready,
        command(ready, 'player-2', { type: 'StartGame' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'NOT_HOST' });

    const notReady = createInitialGameState(
      config(5),
      players(5).map((player, index) =>
        index === 1 ? { ...player, ready: false } : player,
      ),
    );
    expect(
      executeCommand(
        notReady,
        command(notReady, notReady.hostPlayerId, { type: 'StartGame' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'PLAYERS_NOT_READY' });

    const offline = createInitialGameState(
      config(5),
      players(5).map((player, index) =>
        index === 1 ? { ...player, connected: false } : player,
      ),
    );
    expect(
      executeCommand(
        offline,
        command(offline, offline.hostPlayerId, { type: 'StartGame' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'PLAYERS_OFFLINE' });

    const started = accepted(
      ready,
      ready.hostPlayerId,
      { type: 'StartGame' },
      ports,
    );
    expect(
      executeCommand(
        started,
        command(started, started.hostPlayerId, { type: 'StartGame' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_PHASE' });
  });
});

describe('M1-002 M1-003 / RULE-005–RULE-011 / SM-008–SM-011', () => {
  it('selects a legal first leader, gates role acknowledgement, and advances atomically on the last ack', () => {
    const ports = fixedPorts([249]);
    const initial = createInitialGameState(config(5), players(5));
    let state = accepted(
      initial,
      initial.hostPlayerId,
      { type: 'StartGame' },
      ports,
    );
    expect(state.leaderSeatIndex).toBeGreaterThanOrEqual(0);
    expect(state.leaderSeatIndex).toBeLessThan(5);
    expect(
      executeCommand(
        state,
        command(state, 'player-1', { type: 'AckRole' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_PHASE_STAGE' });

    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    state = accepted(state, 'player-1', { type: 'AckRole' }, ports);
    expect(
      executeCommand(
        state,
        command(state, 'player-1', { type: 'AckRole' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'ALREADY_SUBMITTED' });
    for (const player of state.players.slice(1, -1)) {
      state = accepted(state, player.playerId, { type: 'AckRole' }, ports);
    }
    const beforeLastVersion = state.stateVersion;
    state = accepted(
      state,
      state.players.at(-1)?.playerId ?? '',
      { type: 'AckRole' },
      ports,
    );
    expect(state.stateVersion).toBe(beforeLastVersion + 1);
    expect(state).toMatchObject({
      phase: 'TEAM_PROPOSAL',
      phaseStage: 'HOST_HELD',
      roleAcknowledgements: [],
    });
  });

  it('enforces leader, stage, exact team size, membership, and uniqueness', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const team = teamForQuest(state);
    expect(
      executeCommand(
        state,
        command(state, leader(state), {
          type: 'SubmitTeam',
          teamPlayerIds: team,
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_PHASE_STAGE' });
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    const nonLeader = state.players.find(
      (player) => player.playerId !== leader(state),
    );
    expect(
      executeCommand(
        state,
        command(state, nonLeader?.playerId ?? '', {
          type: 'SubmitTeam',
          teamPlayerIds: team,
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'NOT_LEADER' });
    expect(
      executeCommand(
        state,
        command(state, leader(state), {
          type: 'SubmitTeam',
          teamPlayerIds: team.slice(0, 1),
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_TEAM_SIZE' });
    expect(
      executeCommand(
        state,
        command(state, leader(state), {
          type: 'SubmitTeam',
          teamPlayerIds: [team[0] ?? '', team[0] ?? ''],
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_TEAM_MEMBER' });
    expect(
      executeCommand(
        state,
        command(state, leader(state), {
          type: 'SubmitTeam',
          teamPlayerIds: [team[0] ?? '', 'outsider'],
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_TEAM_MEMBER' });
  });

  it('treats a six-player 3:3 vote as rejection and rotates the leader in the last vote transition', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(6, ports);
    const originalLeader = state.leaderSeatIndex;
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    state = accepted(
      state,
      leader(state),
      { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
      ports,
    );
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    const versionBeforeVotes = state.stateVersion;
    for (const [index, player] of state.players.entries()) {
      state = accepted(
        state,
        player.playerId,
        { type: 'SubmitTeamVote', vote: index < 3 ? 'APPROVE' : 'REJECT' },
        ports,
      );
    }
    expect(state.stateVersion).toBe(versionBeforeVotes + 6);
    expect(state.proposalHistory.at(-1)).toMatchObject({
      approveCount: 3,
      rejectCount: 3,
      approved: false,
    });
    expect(state.questIndex).toBe(1);
    expect(state.proposalAttempt).toBe(2);
    expect(state.leaderSeatIndex).toBe((originalLeader + 1) % 6);
    expect(state.pendingTransition).toBe('NEXT_PROPOSAL');
  });

  it('locks FIVE_REJECTED_TEAMS on the fifth rejection without entering a quest', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    for (let attempt = 1; attempt <= 5; attempt += 1) {
      state = accepted(
        state,
        state.hostPlayerId,
        { type: 'ContinuePhase' },
        ports,
      );
      state = accepted(
        state,
        leader(state),
        { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
        ports,
      );
      state = accepted(
        state,
        state.hostPlayerId,
        { type: 'ContinuePhase' },
        ports,
      );
      for (const player of state.players) {
        state = accepted(
          state,
          player.playerId,
          { type: 'SubmitTeamVote', vote: 'REJECT' },
          ports,
        );
      }
      if (attempt < 5) {
        state = continueAfterResolution(state, ports);
      }
    }
    expect(state.gameOutcome).toEqual({
      winner: 'EVIL',
      reason: 'FIVE_REJECTED_TEAMS',
    });
    expect(state.pendingTransition).toBe('GAME_OVER');
    expect(state.questHistory).toEqual([]);
    state = continueAfterResolution(state, ports);
    expect(state.phase).toBe('GAME_OVER');
  });
});

describe('M1-004 / RULE-012–RULE-016 / SM-012', () => {
  it('rejects non-members, good FAIL, duplicates, and wrong stages without changing progress', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const good = playerWithRole(state, 'MERLIN');
    const evil = playerWithRole(state, 'ASSASSIN');
    const team = teamForQuest(state, [good, evil]);
    state = approveTeam(state, team, ports);
    expect(
      executeCommand(
        state,
        command(state, good, { type: 'SubmitQuestChoice', choice: 'SUCCESS' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_PHASE_STAGE' });
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    const nonMember = state.players.find(
      (player) => !team.includes(player.playerId),
    );
    const originalVersion = state.stateVersion;
    expect(
      executeCommand(
        state,
        command(state, nonMember?.playerId ?? '', {
          type: 'SubmitQuestChoice',
          choice: 'SUCCESS',
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'PLAYER_NOT_ON_TEAM' });
    expect(
      executeCommand(
        state,
        command(state, good, { type: 'SubmitQuestChoice', choice: 'FAIL' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'GOOD_CANNOT_FAIL' });
    expect(state.stateVersion).toBe(originalVersion);

    state = accepted(
      state,
      good,
      { type: 'SubmitQuestChoice', choice: 'SUCCESS' },
      ports,
    );
    expect(
      executeCommand(
        state,
        command(state, good, { type: 'SubmitQuestChoice', choice: 'SUCCESS' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'ALREADY_SUBMITTED' });
    state = accepted(
      state,
      evil,
      { type: 'SubmitQuestChoice', choice: 'FAIL' },
      ports,
    );
    expect(state.phase).toBe('QUEST_RESOLUTION');
    expect(state.questChoices).toEqual({});
    expect(state.questHistory.at(-1)).toMatchObject({
      successChoices: 1,
      failChoices: 1,
      result: 'FAILURE',
    });
    expect(JSON.stringify(state.questHistory)).not.toContain('questChoices');
  });

  it.each([7, 8, 9, 10] as const)(
    'applies one/two FAIL semantics only on the fourth quest for %i players',
    (count) => {
      const ports = fixedPorts();
      let state = startAndAcknowledge(count, ports);
      const evil = evilPlayers(state);
      expect(evil.length).toBeGreaterThanOrEqual(2);
      state = settleQuest(state, teamForQuest(state), new Set(), ports);
      state = continueAfterResolution(state, ports);
      state = settleQuest(
        state,
        teamForQuest(state, [evil[0] ?? '']),
        new Set([evil[0] ?? '']),
        ports,
      );
      state = continueAfterResolution(state, ports);
      state = settleQuest(state, teamForQuest(state), new Set(), ports);
      state = continueAfterResolution(state, ports);
      expect(state.questIndex).toBe(4);

      const oneFail = settleQuest(
        state,
        teamForQuest(state, evil),
        new Set([evil[0] ?? '']),
        ports,
      );
      expect(oneFail.questHistory.at(-1)).toMatchObject({
        requiredFails: 2,
        failChoices: 1,
        result: 'SUCCESS',
      });

      const twoFails = settleQuest(
        state,
        teamForQuest(state, evil),
        new Set([evil[0] ?? '', evil[1] ?? '']),
        ports,
      );
      expect(twoFails.questHistory.at(-1)).toMatchObject({
        requiredFails: 2,
        failChoices: 2,
        result: 'FAILURE',
      });
    },
  );

  it('locks THREE_QUEST_FAILURES in the final quest submission transition', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const evil = evilPlayers(state)[0] ?? '';
    for (let quest = 1; quest <= 3; quest += 1) {
      state = settleQuest(
        state,
        teamForQuest(state, [evil]),
        new Set([evil]),
        ports,
      );
      if (quest < 3) state = continueAfterResolution(state, ports);
    }
    expect(state.failureCount).toBe(3);
    expect(state.gameOutcome).toEqual({
      winner: 'EVIL',
      reason: 'THREE_QUEST_FAILURES',
    });
    expect(state.pendingTransition).toBe('GAME_OVER');
  });
});

describe('M1-005 / RULE-017–RULE-019 / SM-013 / AC-007', () => {
  function assassinationReady() {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    for (let quest = 1; quest <= 3; quest += 1) {
      state = settleQuest(state, teamForQuest(state), new Set(), ports);
      if (quest < 3) state = continueAfterResolution(state, ports);
    }
    expect(state.pendingTransition).toBe('ASSASSINATION');
    expect(buildPublicGameState(state).revealedAssignments).toEqual([]);
    state = continueAfterResolution(state, ports);
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    return { state, ports };
  }

  it('lets only the Assassin select any other player and awards evil on a Merlin hit', () => {
    const { state, ports } = assassinationReady();
    const assassin = playerWithRole(state, 'ASSASSIN');
    const merlin = playerWithRole(state, 'MERLIN');
    expect(
      executeCommand(
        state,
        command(state, merlin, {
          type: 'SelectMerlinTarget',
          targetPlayerId: assassin,
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'NOT_ASSASSIN' });
    expect(
      executeCommand(
        state,
        command(state, assassin, {
          type: 'SelectMerlinTarget',
          targetPlayerId: assassin,
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'INVALID_TARGET' });
    const ended = accepted(
      state,
      assassin,
      { type: 'SelectMerlinTarget', targetPlayerId: merlin },
      ports,
    );
    expect(ended.gameOutcome).toEqual({
      winner: 'EVIL',
      reason: 'MERLIN_ASSASSINATED',
      assassinationTargetPlayerId: merlin,
    });
    expect(ended.phase).toBe('GAME_OVER');
  });

  it('awards good when Merlin survives and reveals roles only after the verdict', () => {
    const { state, ports } = assassinationReady();
    const assassin = playerWithRole(state, 'ASSASSIN');
    const target = state.players.find(
      (player) =>
        player.playerId !== assassin &&
        state.roleAssignments[player.playerId] !== 'MERLIN',
    )?.playerId;
    const ended = accepted(
      state,
      assassin,
      { type: 'SelectMerlinTarget', targetPlayerId: target ?? '' },
      ports,
    );
    expect(ended.gameOutcome).toMatchObject({
      winner: 'GOOD',
      reason: 'MERLIN_SURVIVED',
    });
    expect(buildPublicGameState(ended).revealedAssignments).toHaveLength(5);
  });
});

describe('M1-006 / RULE-020–RULE-022 / SM-014–SM-016 SM-020 SM-021', () => {
  it('pauses and resumes without changing secrets, accepted submissions, leader, or audio instance', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    state = accepted(
      state,
      leader(state),
      { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
      ports,
    );
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    state = accepted(
      state,
      state.players[1]?.playerId ?? '',
      { type: 'SubmitTeamVote', vote: 'APPROVE' },
      ports,
    );
    const secrets = {
      roles: state.roleAssignments,
      knowledge: state.privateKnowledge,
      votes: state.teamVotes,
      leader: state.leaderSeatIndex,
      quest: state.questIndex,
      cue: state.currentAudioCue,
    };
    expect(
      executeCommand(
        state,
        command(state, state.players[1]?.playerId ?? '', { type: 'PauseGame' }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'NOT_HOST' });
    state = accepted(state, state.hostPlayerId, { type: 'PauseGame' }, ports);
    expect(state.phase).toBe('PAUSED');
    expect(buildPublicGameState(state).submissionProgress).toEqual({
      submittedCount: 1,
      requiredCount: 5,
    });
    expect(buildPrivatePlayerState(state, 'player-2').hasSubmitted).toBe(true);
    expect(
      executeCommand(
        state,
        command(state, state.players[1]?.playerId ?? '', {
          type: 'ResumeGame',
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'NOT_HOST' });
    state = accepted(state, state.hostPlayerId, { type: 'ResumeGame' }, ports);
    expect(state).toMatchObject({
      phase: 'TEAM_VOTE',
      phaseStage: 'COLLECTING',
    });
    expect({
      roles: state.roleAssignments,
      knowledge: state.privateKnowledge,
      votes: state.teamVotes,
      leader: state.leaderSeatIndex,
      quest: state.questIndex,
      cue: state.currentAudioCue,
    }).toEqual(secrets);
  });

  it('keeps multiple pause reasons independent and auto-resumes only after all clear', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    state = accepted(state, state.hostPlayerId, { type: 'PauseGame' }, ports);
    state = applyConnectionChanged(state, 'player-2', false).state;
    expect(state.pauseReasons).toEqual(['MANUAL', 'PLAYER_DISCONNECTED']);
    state = accepted(state, state.hostPlayerId, { type: 'ResumeGame' }, ports);
    expect(state.phase).toBe('PAUSED');
    expect(state.pauseReasons).toEqual(['PLAYER_DISCONNECTED']);
    state = applyConnectionChanged(state, 'player-2', true).state;
    expect(state.phase).toBe('TEAM_PROPOSAL');
    expect(state.pauseReasons).toEqual([]);
  });

  it('SM-014 validates and publishes a normalized manual reason even during a connection pause', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const invalid = executeCommand(
      state,
      command(state, state.hostPlayerId, {
        type: 'PauseGame',
        reason: 'bad\u202Ereason',
      }),
      ports,
    );
    expect(invalid.result).toMatchObject({
      accepted: false,
      errorCode: 'INVALID_PAUSE_REASON',
    });
    state = applyConnectionChanged(state, 'player-2', false).state;
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'PauseGame', reason: '  A\u0301休息  ' },
      ports,
    );
    expect(state.pauseReasons).toEqual(['PLAYER_DISCONNECTED', 'MANUAL']);
    expect(buildPublicGameState(state).manualPauseReason).toBe('Á休息');
    state = applyConnectionChanged(state, 'player-2', true).state;
    expect(state.phase).toBe('PAUSED');
    expect(state.pauseReasons).toEqual(['MANUAL']);
  });

  it('does not transfer host control on disconnect and expires a paused game as ABORTED', () => {
    const ports = fixedPorts();
    const active = startAndAcknowledge(5, ports);
    const paused = applyConnectionChanged(
      active,
      active.hostPlayerId,
      false,
    ).state;
    expect(paused.phase).toBe('PAUSED');
    expect(paused.pauseReasons).toEqual(['HOST_DISCONNECTED']);
    expect(paused.hostPlayerId).toBe(active.hostPlayerId);
    const expired = expirePausedGame(paused, ports);
    expect(expired.state).toMatchObject({
      phase: 'GAME_OVER',
      gameOutcome: { winner: 'NONE', reason: 'ABORTED' },
    });
    expect(buildPublicGameState(expired.state).revealedAssignments).toEqual([]);
    expect(expired.effects).toHaveLength(1);
  });

  it('starts a pause termination ballot after 60 seconds using an online-player snapshot', () => {
    const clock = controllablePorts();
    let state = startAndAcknowledge(5, clock.ports);
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'PauseGame' },
      clock.ports,
    );
    state = applyConnectionChanged(state, 'player-5', false).state;
    expect(
      executeCommand(
        state,
        command(state, 'player-2', { type: 'StartPauseTerminationVote' }),
        clock.ports,
      ).result,
    ).toMatchObject({
      accepted: false,
      errorCode: 'PAUSE_VOTE_NOT_AVAILABLE',
    });

    clock.setNow('2026-08-13T10:01:00.000Z');
    state = accepted(
      state,
      'player-2',
      { type: 'StartPauseTerminationVote' },
      clock.ports,
    );
    expect(state.pauseTerminationVote).toMatchObject({
      startedAt: '2026-08-13T10:01:00.000Z',
      expiresAt: '2026-08-13T10:01:30.000Z',
      eligiblePlayerIds: ['player-1', 'player-2', 'player-3', 'player-4'],
      choices: {},
    });
    expect(buildPublicGameState(state).pauseTerminationVote).toEqual({
      startedAt: '2026-08-13T10:01:00.000Z',
      expiresAt: '2026-08-13T10:01:30.000Z',
      eligibleCount: 4,
      submittedCount: 0,
    });
    expect(JSON.stringify(buildPublicGameState(state))).not.toContain(
      'choices',
    );
  });

  it('continues pausing only after a strict online-voter majority and applies a new cooldown', () => {
    const clock = controllablePorts();
    let state = startAndAcknowledge(5, clock.ports);
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'PauseGame' },
      clock.ports,
    );
    clock.setNow('2026-08-13T10:01:00.000Z');
    state = accepted(
      state,
      'player-2',
      { type: 'StartPauseTerminationVote' },
      clock.ports,
    );
    for (const playerId of ['player-1', 'player-2', 'player-3']) {
      state = accepted(
        state,
        playerId,
        { type: 'SubmitPauseTerminationVote', choice: 'CONTINUE_PAUSE' },
        clock.ports,
      );
    }
    expect(state.phase).toBe('PAUSED');
    expect(state.pauseTerminationVote).toBeUndefined();
    expect(state.pauseTerminationVoteAvailableAt).toBe(
      '2026-08-13T10:02:00.000Z',
    );
  });

  it('aborts when all online voters submit without a continue majority or the 30-second deadline expires', () => {
    const clock = controllablePorts();
    let state = startAndAcknowledge(5, clock.ports);
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'PauseGame' },
      clock.ports,
    );
    clock.setNow('2026-08-13T10:01:00.000Z');
    state = accepted(
      state,
      'player-1',
      { type: 'StartPauseTerminationVote' },
      clock.ports,
    );
    const choices = [
      'CONTINUE_PAUSE',
      'CONTINUE_PAUSE',
      'TERMINATE',
      'TERMINATE',
      'TERMINATE',
    ] as const;
    state.players.forEach((player, index) => {
      state = accepted(
        state,
        player.playerId,
        {
          type: 'SubmitPauseTerminationVote',
          choice: choices[index] ?? 'TERMINATE',
        },
        clock.ports,
      );
    });
    expect(state).toMatchObject({
      phase: 'GAME_OVER',
      gameOutcome: { winner: 'NONE', reason: 'ABORTED' },
    });

    let deadlineState = startAndAcknowledge(5, clock.ports);
    clock.setNow('2026-08-13T11:00:00.000Z');
    deadlineState = accepted(
      deadlineState,
      deadlineState.hostPlayerId,
      { type: 'PauseGame' },
      clock.ports,
    );
    clock.setNow('2026-08-13T11:01:00.000Z');
    deadlineState = accepted(
      deadlineState,
      'player-1',
      { type: 'StartPauseTerminationVote' },
      clock.ports,
    );
    clock.setNow('2026-08-13T11:01:30.000Z');
    const expired = expirePauseTerminationVote(deadlineState, clock.ports);
    expect(expired.state).toMatchObject({
      phase: 'GAME_OVER',
      gameOutcome: { winner: 'NONE', reason: 'ABORTED' },
    });
  });

  it('describes fixed audio effects and replays only the current cue as a new instance', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const original = state.currentAudioCue;
    expect(original?.audioCueKey).toBe('game.team.proposal');
    expect(
      executeCommand(
        state,
        command(state, state.hostPlayerId, {
          type: 'ReplayAudioCue',
          audioCueId: 'missing',
        }),
        ports,
      ).result,
    ).toMatchObject({ accepted: false, errorCode: 'AUDIO_CUE_NOT_FOUND' });
    const replay = executeCommand(
      state,
      command(state, state.hostPlayerId, {
        type: 'ReplayAudioCue',
        audioCueId: original?.audioCueId ?? '',
      }),
      ports,
    );
    expect(replay.result.accepted).toBe(true);
    state = replay.state;
    expect(state.currentAudioCue).toMatchObject({
      audioCueKey: 'game.team.proposal',
      replayOf: original?.audioCueId,
    });
    expect(state.currentAudioCue?.audioCueId).not.toBe(original?.audioCueId);
    expect(replay.effects).toEqual([
      { type: 'AUDIO_CUE_REQUESTED', cue: state.currentAudioCue },
    ]);
  });

  it('keeps public state free of secrets before terminal and private state scoped to self', () => {
    const ports = fixedPorts();
    const state = startAndAcknowledge(5, ports);
    const publicState = buildPublicGameState(state);
    const encoded = JSON.stringify(publicState);
    expect(encoded).not.toContain('roleAssignments');
    expect(encoded).not.toContain('privateKnowledge');
    expect(encoded).not.toContain('questChoices');
    expect(encoded).not.toContain('teamVotes');
    expect(publicState.revealedAssignments).toEqual([]);
    const privateState = buildPrivatePlayerState(state, 'player-1');
    expect(privateState.playerId).toBe('player-1');
    expect(privateState.selfRole).toBe(state.roleAssignments['player-1']);
    expect(collectInvariantViolations(state)).toEqual([]);
  });
});
