import { describe, expect, it } from 'vitest';

import {
  PLAYER_RULES,
  expandPreset,
  normalizeRoomConfig,
  requiredFails,
  requiredTeamSize,
  validateRoleDeck,
  type PlayerCount,
  type RoleId,
} from './index.js';

const rows = [
  [5, 3, 2, [2, 3, 2, 3, 3]],
  [6, 4, 2, [2, 3, 4, 3, 4]],
  [7, 4, 3, [2, 3, 3, 4, 4]],
  [8, 5, 3, [3, 4, 4, 5, 5]],
  [9, 6, 3, [3, 4, 4, 5, 5]],
  [10, 6, 4, [3, 4, 4, 5, 5]],
] as const;

describe('M1-001 / RULE-001 RULE-008 RULE-014 / AC-001 AC-002', () => {
  it.each(rows)(
    'covers the complete %i-player alignment and quest table',
    (playerCount, good, evil, teamSizes) => {
      expect(PLAYER_RULES[playerCount]).toEqual({
        good,
        evil,
        questTeamSizes: teamSizes,
      });
      teamSizes.forEach((teamSize, index) => {
        expect(
          requiredTeamSize(playerCount, (index + 1) as 1 | 2 | 3 | 4 | 5),
        ).toBe(teamSize);
      });
    },
  );

  it.each(rows.map(([count]) => count))(
    'expands both legal presets for %i players',
    (playerCount) => {
      for (const presetId of ['CLASSIC', 'COMMON_ROLES'] as const) {
        const deck = expandPreset(playerCount, presetId);
        expect(deck).toHaveLength(playerCount);
        expect(validateRoleDeck(playerCount, deck)).toEqual([]);
        expect(deck.filter((role) => role === 'MERLIN')).toHaveLength(1);
        expect(deck.filter((role) => role === 'ASSASSIN')).toHaveLength(1);
      }
    },
  );

  it.each(
    rows.flatMap(([count]) =>
      [1, 2, 3, 4, 5].map((quest) => [count, quest] as const),
    ),
  )(
    'uses only the 7-10 player fourth quest double-fail exception: %i players quest %i',
    (playerCount, questIndex) => {
      expect(requiredFails(playerCount, questIndex as 1 | 2 | 3 | 4 | 5)).toBe(
        playerCount >= 7 && questIndex === 4 ? 2 : 1,
      );
    },
  );
});

describe('M1-001 / RULE-004 custom configuration hard validation', () => {
  const cases: readonly [string, PlayerCount, readonly RoleId[], string][] = [
    [
      'role count',
      5,
      ['MERLIN', 'LOYAL_SERVANT', 'ASSASSIN', 'MINION'],
      'ROLE_COUNT_MISMATCH',
    ],
    [
      'alignment count',
      5,
      ['MERLIN', 'ASSASSIN', 'MINION', 'MORGANA', 'PERCIVAL'],
      'ALIGNMENT_COUNT_MISMATCH',
    ],
    [
      'unique Merlin',
      5,
      ['MERLIN', 'MERLIN', 'LOYAL_SERVANT', 'ASSASSIN', 'MINION'],
      'MERLIN_REQUIRED_ONCE',
    ],
    [
      'unique Assassin',
      5,
      ['MERLIN', 'LOYAL_SERVANT', 'LOYAL_SERVANT', 'ASSASSIN', 'ASSASSIN'],
      'ASSASSIN_REQUIRED_ONCE',
    ],
    [
      'unique optional special',
      7,
      [
        'MERLIN',
        'PERCIVAL',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'ASSASSIN',
        'MORDRED',
        'MINION',
      ],
      'UNIQUE_ROLE_REPEATED',
    ],
    [
      'Morgana dependency',
      6,
      [
        'MERLIN',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'ASSASSIN',
        'MORGANA',
      ],
      'MORGANA_REQUIRES_PERCIVAL',
    ],
    [
      'five-player Percival deception role',
      5,
      ['MERLIN', 'PERCIVAL', 'LOYAL_SERVANT', 'ASSASSIN', 'MINION'],
      'FIVE_PLAYER_PERCIVAL_REQUIRES_DECEPTION_ROLE',
    ],
  ];

  it.each(cases)('rejects invalid %s decks', (_name, count, deck, code) => {
    expect(validateRoleDeck(count, deck).map((error) => error.code)).toContain(
      code,
    );
  });

  it('accepts a legal custom deck and normalizes transport-independent config', () => {
    const result = normalizeRoomConfig(
      {
        rulesVersion: 'CLASSIC_AVALON_V1',
        playerCount: 5,
        roleSelection: {
          type: 'CUSTOM',
          roleIds: [
            'MERLIN',
            'PERCIVAL',
            'LOYAL_SERVANT',
            'ASSASSIN',
            'MORGANA',
          ],
        },
        locale: 'zh-CN',
      },
      'zh-CN-v1',
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.config.roleIds).toEqual([
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'ASSASSIN',
        'MORGANA',
      ]);
    }
  });

  it.each([4, 11])('rejects unsupported player count %i', (playerCount) => {
    expect(
      normalizeRoomConfig(
        {
          rulesVersion: 'CLASSIC_AVALON_V1',
          playerCount,
          roleSelection: { type: 'PRESET', presetId: 'CLASSIC' },
          locale: 'zh-CN',
        },
        'zh-CN-v1',
      ),
    ).toMatchObject({
      ok: false,
      errors: [{ code: 'INVALID_PLAYER_COUNT' }],
    });
  });
});
