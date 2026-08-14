import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import { deriveGameTableState } from './game-state';

const playerIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
] as const;

function roomView(): RoomView {
  return {
    public: {
      roomId: '20000000-0000-4000-8000-000000000001',
      roomCode: '7K3M9Q',
      stateVersion: 20,
      rulesVersion: 'CLASSIC_AVALON_V1',
      config: {
        rulesVersion: 'CLASSIC_AVALON_V1',
        playerCount: 5,
        roleIds: [
          'MERLIN',
          'LOYAL_SERVANT',
          'LOYAL_SERVANT',
          'ASSASSIN',
          'MINION',
        ],
        locale: 'zh-CN',
        voicePackVersion: 'zh-CN-v1',
      },
      phase: 'TEAM_PROPOSAL',
      phaseStage: 'HOST_HELD',
      players: playerIds.map((playerId, seat) => ({
        playerId,
        nickname: `玩家${String(seat + 1)}`,
        seat,
        isHost: seat === 0,
        ready: true,
        connected: true,
      })),
      leaderPlayerId: playerIds[1],
      questIndex: 1,
      proposalAttempt: 1,
      requiredTeamSize: 2,
      requiredQuestFails: 1,
      proposedTeamPlayerIds: [],
      submissionProgress: null,
      proposalHistory: [],
      questHistory: [],
      successCount: 0,
      failureCount: 0,
      pauseReasons: [],
      manualPauseReason: null,
      recoveryStartedAt: null,
      recoveryExpiresAt: null,
      currentAudioCue: null,
      gameOutcome: null,
      revealedAssignments: [],
    },
    private: {
      playerId: playerIds[0],
      selfRole: 'MERLIN',
      selfAlignment: 'GOOD',
      knownPlayers: [],
      availableActions: [{ commandType: 'ContinuePhase' }],
      hasSubmitted: false,
      shouldPlayAudio: false,
      sessionExpiresAt: '2026-08-13T12:00:00.000Z',
    },
  };
}

describe('M4 game table projection adapter', () => {
  it('derives host gating and public task context without local adjudication', () => {
    const state = deriveGameTableState(roomView());
    expect(state).toMatchObject({
      phaseTitle: '队长组队',
      canContinue: true,
      continueLabel: '开放队长组队',
      requiredTeamSize: 2,
      requiredQuestFails: 1,
      proposalAttempt: 1,
    });
    expect(state.leader?.nickname).toBe('玩家2');
    expect(state.questTrack[0]).toMatchObject({
      questIndex: 1,
      state: 'CURRENT',
    });
  });

  it('uses the server-projected vote totals and individual revealed votes', () => {
    const view = roomView();
    view.public.phase = 'TEAM_VOTE';
    view.public.phaseStage = 'RESOLVED';
    view.public.proposedTeamPlayerIds = playerIds.slice(0, 2);
    view.public.proposalHistory = [
      {
        questIndex: 1,
        proposalAttempt: 1,
        leaderPlayerId: playerIds[1],
        teamPlayerIds: playerIds.slice(0, 2),
        votes: playerIds.map((playerId, index) => ({
          playerId,
          vote: index < 3 ? 'APPROVE' : 'REJECT',
        })),
        approveCount: 3,
        rejectCount: 2,
        approved: true,
      },
    ];
    const state = deriveGameTableState(view);
    expect(state.latestProposal).toMatchObject({
      approveCount: 3,
      rejectCount: 2,
      approved: true,
    });
    expect(state.continueLabel).toBe('继续到任务行动');
  });

  it('exposes only vote options supplied by availableActions', () => {
    const view = roomView();
    view.public.phase = 'TEAM_VOTE';
    view.public.phaseStage = 'COLLECTING';
    view.private.availableActions = [
      {
        commandType: 'SubmitTeamVote',
        allowedTeamVotes: ['APPROVE', 'REJECT'],
      },
    ];
    expect(deriveGameTableState(view).allowedTeamVotes).toEqual([
      'APPROVE',
      'REJECT',
    ]);
    view.private.availableActions = [];
    expect(deriveGameTableState(view).allowedTeamVotes).toEqual([]);
  });

  it('renders the server-projected double-fail threshold and legal quest options', () => {
    const view = roomView();
    view.public.config.playerCount = 7;
    view.public.phase = 'QUEST_SUBMISSION';
    view.public.phaseStage = 'COLLECTING';
    view.public.questIndex = 4;
    view.public.requiredTeamSize = 4;
    view.public.requiredQuestFails = 2;
    view.public.proposedTeamPlayerIds = playerIds.slice(0, 4);
    view.private.availableActions = [
      {
        commandType: 'SubmitQuestChoice',
        allowedQuestChoices: ['SUCCESS'],
      },
    ];
    const state = deriveGameTableState(view);
    expect(state.requiredQuestFails).toBe(2);
    expect(state.allowedQuestChoices).toEqual(['SUCCESS']);
    expect(state.allowedQuestChoices).not.toContain('FAIL');
  });
});
