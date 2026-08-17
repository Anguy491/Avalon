import {
  RULES_VERSION,
  type Alignment,
  type ConfigResult,
  type ConfigValidationError,
  type PlayerCount,
  type QuestIndex,
  type RoleId,
  type RoomConfig,
  type RoomConfigInput,
} from './types.js';

export interface PlayerRuleRow {
  readonly good: number;
  readonly evil: number;
  readonly questTeamSizes: readonly [number, number, number, number, number];
}

export const PLAYER_RULES: Readonly<Record<PlayerCount, PlayerRuleRow>> = {
  5: { good: 3, evil: 2, questTeamSizes: [2, 3, 2, 3, 3] },
  6: { good: 4, evil: 2, questTeamSizes: [2, 3, 4, 3, 4] },
  7: { good: 4, evil: 3, questTeamSizes: [2, 3, 3, 4, 4] },
  8: { good: 5, evil: 3, questTeamSizes: [3, 4, 4, 5, 5] },
  9: { good: 6, evil: 3, questTeamSizes: [3, 4, 4, 5, 5] },
  10: { good: 6, evil: 4, questTeamSizes: [3, 4, 4, 5, 5] },
};

export const ROLE_ALIGNMENT: Readonly<Record<RoleId, Alignment>> = {
  MERLIN: 'GOOD',
  LOYAL_SERVANT: 'GOOD',
  PERCIVAL: 'GOOD',
  ASSASSIN: 'EVIL',
  MINION: 'EVIL',
  MORGANA: 'EVIL',
  MORDRED: 'EVIL',
  OBERON: 'EVIL',
};

const UNIQUE_OPTIONAL_ROLES: readonly RoleId[] = [
  'PERCIVAL',
  'MORGANA',
  'MORDRED',
  'OBERON',
];

export function isPlayerCount(value: number): value is PlayerCount {
  return Number.isInteger(value) && value >= 5 && value <= 10;
}

export function alignmentForRole(roleId: RoleId): Alignment {
  return ROLE_ALIGNMENT[roleId];
}

export function requiredTeamSize(
  playerCount: PlayerCount,
  questIndex: QuestIndex,
): number {
  const size = PLAYER_RULES[playerCount].questTeamSizes[questIndex - 1];
  if (size === undefined) throw new RangeError('Quest index out of range');
  return size;
}

export function requiredFails(
  playerCount: PlayerCount,
  questIndex: QuestIndex,
): 1 | 2 {
  return playerCount >= 7 && questIndex === 4 ? 2 : 1;
}

export function expandPreset(
  playerCount: PlayerCount,
  presetId: 'CLASSIC' | 'RECOMMENDED',
): readonly RoleId[] {
  if (presetId === 'RECOMMENDED') {
    const recommended: Readonly<Record<PlayerCount, readonly RoleId[]>> = {
      5: ['MERLIN', 'PERCIVAL', 'LOYAL_SERVANT', 'MORGANA', 'ASSASSIN'],
      6: [
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'MORGANA',
        'ASSASSIN',
      ],
      7: [
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'MORGANA',
        'ASSASSIN',
        'MINION',
      ],
      8: [
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'MORGANA',
        'ASSASSIN',
        'MINION',
      ],
      9: [
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'MORGANA',
        'ASSASSIN',
        'MORDRED',
      ],
      10: [
        'MERLIN',
        'PERCIVAL',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'LOYAL_SERVANT',
        'MORGANA',
        'ASSASSIN',
        'OBERON',
        'MORDRED',
      ],
    };
    return recommended[playerCount];
  }
  const { good, evil } = PLAYER_RULES[playerCount];
  const goodSpecials: readonly RoleId[] = ['MERLIN'];
  const evilSpecials: readonly RoleId[] = ['ASSASSIN'];

  return [
    ...goodSpecials,
    ...Array<RoleId>(good - goodSpecials.length).fill('LOYAL_SERVANT'),
    ...evilSpecials,
    ...Array<RoleId>(evil - evilSpecials.length).fill('MINION'),
  ];
}

function roleCount(roleIds: readonly RoleId[], target: RoleId): number {
  return roleIds.filter((roleId) => roleId === target).length;
}

export function validateRoleDeck(
  playerCount: PlayerCount,
  roleIds: readonly RoleId[],
): readonly ConfigValidationError[] {
  const errors: ConfigValidationError[] = [];
  const row = PLAYER_RULES[playerCount];

  if (roleIds.length !== playerCount) {
    errors.push({ code: 'ROLE_COUNT_MISMATCH' });
  }

  const goodCount = roleIds.filter(
    (roleId) => alignmentForRole(roleId) === 'GOOD',
  ).length;
  const evilCount = roleIds.length - goodCount;
  if (goodCount !== row.good || evilCount !== row.evil) {
    errors.push({ code: 'ALIGNMENT_COUNT_MISMATCH' });
  }

  if (roleCount(roleIds, 'MERLIN') !== 1) {
    errors.push({ code: 'MERLIN_REQUIRED_ONCE', roleId: 'MERLIN' });
  }
  if (roleCount(roleIds, 'ASSASSIN') !== 1) {
    errors.push({ code: 'ASSASSIN_REQUIRED_ONCE', roleId: 'ASSASSIN' });
  }
  for (const roleId of UNIQUE_OPTIONAL_ROLES) {
    if (roleCount(roleIds, roleId) > 1) {
      errors.push({ code: 'UNIQUE_ROLE_REPEATED', roleId });
    }
  }
  if (roleIds.includes('MORGANA') && !roleIds.includes('PERCIVAL')) {
    errors.push({ code: 'MORGANA_REQUIRES_PERCIVAL', roleId: 'MORGANA' });
  }
  if (
    playerCount === 5 &&
    roleIds.includes('PERCIVAL') &&
    !roleIds.includes('MORGANA') &&
    !roleIds.includes('MORDRED')
  ) {
    errors.push({ code: 'FIVE_PLAYER_PERCIVAL_REQUIRES_DECEPTION_ROLE' });
  }
  return errors;
}

export function normalizeRoomConfig(
  input: RoomConfigInput,
  voicePackVersion: string,
): ConfigResult {
  if (!isPlayerCount(input.playerCount)) {
    return { ok: false, errors: [{ code: 'INVALID_PLAYER_COUNT' }] };
  }

  const playerCount = input.playerCount;
  const roleIds =
    input.roleSelection.type === 'PRESET'
      ? expandPreset(playerCount, input.roleSelection.presetId)
      : [...input.roleSelection.roleIds];
  const errors = validateRoleDeck(playerCount, roleIds);
  if (errors.length > 0) return { ok: false, errors };

  const config: RoomConfig = {
    rulesVersion: RULES_VERSION,
    playerCount,
    roleIds,
    locale: 'zh-CN',
    voicePackVersion,
  };
  return { ok: true, config };
}

export function validateRoomConfig(config: RoomConfig): ConfigResult {
  if (!isPlayerCount(config.playerCount)) {
    return { ok: false, errors: [{ code: 'INVALID_PLAYER_COUNT' }] };
  }
  const errors = validateRoleDeck(config.playerCount, config.roleIds);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, config };
}
