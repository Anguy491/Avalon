import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import {
  INITIAL_PRIVACY_GATE,
  ROLE_PRESENTATION,
  deriveRoleRevealUiState,
  isRoleRevealed,
  privacyGateReducer,
} from './role-reveal-state';

const roleView = (): RoomView =>
  ({
    public: {
      players: [
        {
          playerId: 'player-self',
          nickname: 'Arthur',
          seat: 0,
          isHost: false,
          ready: true,
          connected: true,
        },
        {
          playerId: 'player-one',
          nickname: 'Gawain',
          seat: 1,
          isHost: true,
          ready: true,
          connected: true,
        },
        {
          playerId: 'player-two',
          nickname: 'Kay',
          seat: 2,
          isHost: false,
          ready: true,
          connected: true,
        },
      ],
      submissionProgress: { submittedCount: 1, requiredCount: 3 },
    },
    private: {
      playerId: 'player-self',
      selfRole: 'PERCIVAL',
      selfAlignment: 'GOOD',
      knownPlayers: [
        { playerId: 'player-one', knowledgeLabel: 'MERLIN_CANDIDATE' },
        { playerId: 'player-two', knowledgeLabel: 'MERLIN_CANDIDATE' },
      ],
      availableActions: [{ commandType: 'AckRole' }],
      hasSubmitted: false,
    },
  }) as RoomView;

describe('deriveRoleRevealUiState', () => {
  it('renders only the semantic knowledge labels supplied by the projection', () => {
    const state = deriveRoleRevealUiState(roleView());
    expect(state).toMatchObject({
      roleId: 'PERCIVAL',
      roleLabel: '派西维尔',
      alignmentLabel: '善良阵营',
      canContinue: false,
      canAcknowledge: true,
      hasSubmitted: false,
      submittedCount: 1,
      requiredCount: 3,
    });
    expect(state.knowledgeItems).toEqual([
      {
        playerId: 'player-one',
        playerName: 'Gawain',
        label: '梅林候选人',
      },
      {
        playerId: 'player-two',
        playerName: 'Kay',
        label: '梅林候选人',
      },
    ]);
  });

  it('has presentation copy for every protocol role without calculating knowledge', () => {
    expect(Object.keys(ROLE_PRESENTATION).sort()).toEqual(
      [
        'MERLIN',
        'LOYAL_SERVANT',
        'PERCIVAL',
        'ASSASSIN',
        'MINION',
        'MORGANA',
        'MORDRED',
        'OBERON',
      ].sort(),
    );
  });
});

describe('privacyGateReducer', () => {
  it('reveals only after an explicit action and masks immediately on release', () => {
    const revealed = privacyGateReducer(INITIAL_PRIVACY_GATE, {
      type: 'hold-reveal',
    });
    expect(isRoleRevealed(revealed)).toBe(true);
    expect(revealed.hasViewed).toBe(true);
    expect(
      isRoleRevealed(privacyGateReducer(revealed, { type: 'hold-release' })),
    ).toBe(false);
  });

  it('conceals toggle mode on background and requires another explicit reveal', () => {
    const toggled = privacyGateReducer(INITIAL_PRIVACY_GATE, {
      type: 'toggle-reveal',
    });
    const concealed = privacyGateReducer(toggled, { type: 'conceal' });
    expect(concealed).toEqual({ mode: 'MASKED', hasViewed: true });
    expect(isRoleRevealed(concealed)).toBe(false);
  });

  it('returns to a neutral unviewed state after acknowledgement', () => {
    const toggled = privacyGateReducer(INITIAL_PRIVACY_GATE, {
      type: 'toggle-reveal',
    });
    expect(privacyGateReducer(toggled, { type: 'acknowledged' })).toEqual(
      INITIAL_PRIVACY_GATE,
    );
  });
});
