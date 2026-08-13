import { describe, expect, it } from 'vitest';

import {
  calculatePrivateKnowledge,
  randomIndex,
  shuffle,
  type RoleId,
} from './index.js';
import { fixedPorts, players } from './__tests__/helpers.js';

describe('M1-002 / RULE-005 injectable randomness', () => {
  it('uses only the injected byte source for shuffle and leader selection', () => {
    const ports = fixedPorts([5, 4, 3, 2, 1, 0]);
    expect(shuffle(['a', 'b', 'c', 'd'], ports.random)).toEqual([
      'a',
      'c',
      'd',
      'b',
    ]);
    expect(randomIndex(5, ports.random)).toBeGreaterThanOrEqual(0);
    expect(randomIndex(5, ports.random)).toBeLessThan(5);
  });

  it('rejects a broken random port instead of silently biasing output', () => {
    expect(() => randomIndex(5, { bytes: () => new Uint8Array() })).toThrow(
      'unexpected byte count',
    );
  });
});

describe('M1-002 / RULE-006 RULE-007 / AC-008 private knowledge matrix', () => {
  const gamePlayers = players(8);
  const roles: readonly RoleId[] = [
    'MERLIN',
    'PERCIVAL',
    'LOYAL_SERVANT',
    'LOYAL_SERVANT',
    'ASSASSIN',
    'MORGANA',
    'MORDRED',
    'OBERON',
  ];
  const assignments = Object.fromEntries(
    gamePlayers.map((player, index) => [player.playerId, roles[index]]),
  ) as Readonly<Record<string, RoleId>>;
  const knowledge = calculatePrivateKnowledge(gamePlayers, assignments);

  it('shows Merlin evil labels including Oberon while hiding Mordred and exact roles', () => {
    expect(knowledge['player-1']?.knownPlayers).toEqual([
      { playerId: 'player-5', knowledgeLabel: 'EVIL_PLAYER' },
      { playerId: 'player-6', knowledgeLabel: 'EVIL_PLAYER' },
      { playerId: 'player-8', knowledgeLabel: 'EVIL_PLAYER' },
    ]);
    expect(JSON.stringify(knowledge['player-1'])).not.toContain('MORDRED');
  });

  it('shows Percival indistinguishable Merlin and Morgana candidates', () => {
    expect(knowledge['player-2']?.knownPlayers).toEqual([
      { playerId: 'player-1', knowledgeLabel: 'MERLIN_CANDIDATE' },
      { playerId: 'player-6', knowledgeLabel: 'MERLIN_CANDIDATE' },
    ]);
  });

  it.each(['player-5', 'player-6', 'player-7'])(
    'shows %s only non-Oberon evil allies without exact roles or self',
    (viewerId) => {
      const known = knowledge[viewerId]?.knownPlayers ?? [];
      expect(known.map((entry) => entry.playerId).sort()).toEqual(
        ['player-5', 'player-6', 'player-7']
          .filter((playerId) => playerId !== viewerId)
          .sort(),
      );
      expect(
        known.every((entry) => entry.knowledgeLabel === 'KNOWN_EVIL_ALLY'),
      ).toBe(true);
      expect(JSON.stringify(known)).not.toContain('OBERON');
    },
  );

  it.each(['player-3', 'player-4', 'player-8'])(
    'gives loyal servants and Oberon no extra knowledge (%s)',
    (viewerId) => {
      expect(knowledge[viewerId]?.knownPlayers).toEqual([]);
    },
  );

  it('shows Percival only Merlin when Morgana is absent', () => {
    const fivePlayers = players(5);
    const fiveRoles: readonly RoleId[] = [
      'MERLIN',
      'PERCIVAL',
      'LOYAL_SERVANT',
      'ASSASSIN',
      'MORDRED',
    ];
    const fiveAssignments = Object.fromEntries(
      fivePlayers.map((player, index) => [player.playerId, fiveRoles[index]]),
    ) as Readonly<Record<string, RoleId>>;
    expect(
      calculatePrivateKnowledge(fivePlayers, fiveAssignments)['player-2']
        ?.knownPlayers,
    ).toEqual([{ playerId: 'player-1', knowledgeLabel: 'MERLIN_CANDIDATE' }]);
  });
});
