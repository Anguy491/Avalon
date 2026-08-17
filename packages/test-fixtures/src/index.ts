import {
  PLAYER_RULES,
  expandPreset,
  type EnginePorts,
  type PlayerCount,
} from '@avalon/game-engine';

export const FIXTURE_PLAYER_IDS = [
  '10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000003',
  '10000000-0000-4000-8000-000000000004',
  '10000000-0000-4000-8000-000000000005',
  '10000000-0000-4000-8000-000000000006',
  '10000000-0000-4000-8000-000000000007',
  '10000000-0000-4000-8000-000000000008',
  '10000000-0000-4000-8000-000000000009',
  '10000000-0000-4000-8000-000000000010',
] as const;

export const FIXTURE_NICKNAMES = [
  'Arthur',
  'Guinevere',
  'Gawain',
  'Lancelot',
  'Galahad',
  'Bedivere',
  'Kay',
  'Bors',
  'Tristan',
  'Elaine',
] as const;

export const FIXTURE_CLOCK_ISO = '2026-08-13T10:00:00.000Z' as const;
export const M1_FAST_CHECK_SEED = 20_260_813 as const;
export const M1_REGRESSION_QUEST_RESULTS = [
  'SUCCESS',
  'FAILURE',
  'SUCCESS',
  'FAILURE',
  'SUCCESS',
] as const;

export const M4_FIVE_QUEST_SCRIPT = [
  { questIndex: 1, result: 'SUCCESS' },
  { questIndex: 2, result: 'FAILURE' },
  { questIndex: 3, result: 'SUCCESS' },
  { questIndex: 4, result: 'FAILURE' },
  { questIndex: 5, result: 'SUCCESS' },
] as const;

export const M4_REJECTION_SCRIPT = {
  sixPlayerTie: ['APPROVE', 'APPROVE', 'APPROVE', 'REJECT', 'REJECT', 'REJECT'],
  fiveRejectedAttempts: [1, 2, 3, 4, 5],
} as const;

export const FIXTURE_RULE_ROWS = ([5, 6, 7, 8, 9, 10] as const).map(
  (playerCount) => ({
    playerCount,
    ...PLAYER_RULES[playerCount],
    classicRoleIds: expandPreset(playerCount, 'CLASSIC'),
    recommendedRoleIds: expandPreset(playerCount, 'RECOMMENDED'),
  }),
);

export function fixturePlayerIds(playerCount: PlayerCount): readonly string[] {
  return FIXTURE_PLAYER_IDS.slice(0, playerCount);
}

export function createFixedEnginePorts(
  randomBytes: readonly number[] = [0],
): EnginePorts {
  let byteIndex = 0;
  let idIndex = 0;
  return {
    random: {
      bytes: (length) =>
        Uint8Array.from(
          Array.from({ length }, () => {
            const value = randomBytes[byteIndex % randomBytes.length];
            byteIndex += 1;
            return value ?? 0;
          }),
        ),
    },
    clock: {
      nowIso: () => FIXTURE_CLOCK_ISO,
      addMilliseconds: (iso, milliseconds) =>
        new Date(Date.parse(iso) + milliseconds).toISOString(),
    },
    ids: {
      nextId: () => {
        idIndex += 1;
        return `fixture-audio-${String(idIndex)}`;
      },
    },
  };
}
