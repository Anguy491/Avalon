import { describe, expect, it } from 'vitest';

import {
  FIXTURE_NICKNAMES,
  FIXTURE_PLAYER_IDS,
  FIXTURE_RULE_ROWS,
  M1_FAST_CHECK_SEED,
  M4_FIVE_QUEST_SCRIPT,
  M4_REJECTION_SCRIPT,
  createFixedEnginePorts,
  fixturePlayerIds,
} from './index.js';

describe('M1-007 deterministic fixtures', () => {
  it('provides stable, non-secret identities for every supported player count', () => {
    expect(FIXTURE_PLAYER_IDS).toHaveLength(10);
    expect(new Set(FIXTURE_NICKNAMES).size).toBe(10);
    expect(fixturePlayerIds(5)).toHaveLength(5);
    expect(fixturePlayerIds(10)).toHaveLength(10);
  });

  it('provides all six rule rows and two valid deterministic decks per row', () => {
    expect(FIXTURE_RULE_ROWS.map((row) => row.playerCount)).toEqual([
      5, 6, 7, 8, 9, 10,
    ]);
    for (const row of FIXTURE_RULE_ROWS) {
      expect(row.classicRoleIds).toHaveLength(row.playerCount);
      expect(row.recommendedRoleIds).toHaveLength(row.playerCount);
      expect(row.questTeamSizes).toHaveLength(5);
    }
  });

  it('provides reproducible clock, IDs, random bytes, and fast-check seed', () => {
    const ports = createFixedEnginePorts([3, 7]);
    expect([...ports.random.bytes(4)]).toEqual([3, 7, 3, 7]);
    expect(ports.clock.nowIso()).toBe('2026-08-13T10:00:00.000Z');
    expect(ports.ids.nextId()).toBe('fixture-audio-1');
    expect(M1_FAST_CHECK_SEED).toBe(20_260_813);
  });

  it('provides M4 five-quest and rejection scripts without player-to-action ownership', () => {
    expect(M4_FIVE_QUEST_SCRIPT.map((step) => step.result)).toEqual([
      'SUCCESS',
      'FAILURE',
      'SUCCESS',
      'FAILURE',
      'SUCCESS',
    ]);
    expect(M4_REJECTION_SCRIPT.sixPlayerTie).toHaveLength(6);
    expect(M4_REJECTION_SCRIPT.fiveRejectedAttempts).toEqual([1, 2, 3, 4, 5]);
    expect(JSON.stringify(M4_FIVE_QUEST_SCRIPT)).not.toContain('playerId');
  });
});
