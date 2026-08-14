import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import { deriveResultState } from './result-state';

const playerIds = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
] as const;

function terminalView(reason: 'MERLIN_ASSASSINATED' | 'ABORTED'): RoomView {
  return {
    public: {
      roomId: '20000000-0000-4000-8000-000000000001',
      roomCode: '7K3M9Q',
      stateVersion: 50,
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
      phase: 'GAME_OVER',
      phaseStage: 'RESOLVED',
      players: playerIds.map((playerId, seat) => ({
        playerId,
        nickname: `玩家${String(seat + 1)}`,
        seat,
        isHost: seat === 0,
        ready: true,
        connected: true,
      })),
      leaderPlayerId: playerIds[0],
      questIndex: 3,
      proposalAttempt: 1,
      requiredTeamSize: 2,
      requiredQuestFails: 1,
      proposedTeamPlayerIds: [],
      submissionProgress: null,
      proposalHistory: [],
      questHistory: [
        {
          questIndex: 1,
          leaderPlayerId: playerIds[0],
          teamPlayerIds: playerIds.slice(0, 2),
          successChoices: 2,
          failChoices: 0,
          requiredFails: 1,
          result: 'SUCCESS',
        },
      ],
      successCount: reason === 'ABORTED' ? 1 : 3,
      failureCount: 0,
      pauseReasons: [],
      currentAudioCue: null,
      gameOutcome:
        reason === 'ABORTED'
          ? { winner: 'NONE', reason }
          : {
              winner: 'EVIL',
              reason,
              assassinationTargetPlayerId: playerIds[0],
            },
      revealedAssignments: [
        { playerId: playerIds[0], roleId: 'MERLIN', alignment: 'GOOD' },
        {
          playerId: playerIds[1],
          roleId: 'LOYAL_SERVANT',
          alignment: 'GOOD',
        },
        {
          playerId: playerIds[2],
          roleId: 'LOYAL_SERVANT',
          alignment: 'GOOD',
        },
        { playerId: playerIds[3], roleId: 'ASSASSIN', alignment: 'EVIL' },
        { playerId: playerIds[4], roleId: 'MINION', alignment: 'EVIL' },
      ],
    },
    private: {
      playerId: playerIds[0],
      selfRole: 'MERLIN',
      selfAlignment: 'GOOD',
      knownPlayers: [],
      availableActions: [],
      hasSubmitted: false,
      shouldPlayAudio: false,
      sessionExpiresAt: '2026-08-14T12:00:00.000Z',
    },
  };
}

describe('M5 terminal result adapter', () => {
  it('reveals every role by seat and marks the assassination target', () => {
    const state = deriveResultState(terminalView('MERLIN_ASSASSINATED'));
    expect(state).toMatchObject({
      winner: 'EVIL',
      winnerLabel: '邪恶方获胜',
      reason: 'MERLIN_ASSASSINATED',
      assassinationTarget: { playerId: playerIds[0] },
    });
    expect(state?.revealedPlayers).toHaveLength(5);
    expect(state?.revealedPlayers[0]).toMatchObject({
      roleLabel: '梅林',
      wasAssassinationTarget: true,
    });
    expect(state?.questHistory[0]).toMatchObject({
      successChoices: 2,
      failChoices: 0,
    });
  });

  it('renders ABORTED as a neutral outcome without a target', () => {
    const state = deriveResultState(terminalView('ABORTED'));
    expect(state).toMatchObject({
      winner: 'NONE',
      winnerLabel: '对局中止',
      reasonLabel: '对局已中止，不判定阵营胜负。',
    });
    expect(state?.assassinationTarget).toBeUndefined();
  });

  it.each([
    ['THREE_QUEST_FAILURES', 'EVIL', '三项任务失败，邪恶方赢得对局。'],
    [
      'FIVE_REJECTED_TEAMS',
      'EVIL',
      '同一任务连续五次组队被否决，邪恶方赢得对局。',
    ],
    ['MERLIN_ASSASSINATED', 'EVIL', '刺客成功找出梅林，邪恶方翻盘获胜。'],
    ['MERLIN_SURVIVED', 'GOOD', '刺客未能找出梅林，善良方守住胜利。'],
    ['ABORTED', 'NONE', '对局已中止，不判定阵营胜负。'],
  ] as const)(
    'uses the distinct %s outcome copy',
    (reason, winner, reasonLabel) => {
      const view = terminalView('ABORTED');
      view.public.gameOutcome = { winner, reason };
      expect(deriveResultState(view)).toMatchObject({
        winner,
        reason,
        reasonLabel,
      });
    },
  );
});
