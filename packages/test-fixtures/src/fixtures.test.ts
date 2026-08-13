import { describe, expect, it } from 'vitest';

import {
  FIXTURE_NICKNAMES,
  FIXTURE_PLAYER_IDS,
  FIXTURE_RULE_ROWS,
  M1_FAST_CHECK_SEED,
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
      expect(row.commonRoleIds).toHaveLength(row.playerCount);
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
});
