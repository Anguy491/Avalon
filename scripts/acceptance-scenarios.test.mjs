import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertExpectedRoomConfig,
  parseAcceptanceBotArgs,
} from './acceptance-bots.mjs';
import { recommendedFivePlayerOptions } from './acceptance-recommended-5p-bots.mjs';
import {
  assassinationTarget,
  chooseTeam,
  desiredQuestFailChoices,
  scenarioExpectation,
  teamVoteForBot,
  validateScenario,
} from './acceptance-scenarios.mjs';
import { parseWebPlayerArgs } from './web-multi-player.mjs';

const player = (index) => ({
  playerId: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
  seat: index - 1,
});

const bot = (index, selfAlignment, selfRole) => ({
  playerId: player(index).playerId,
  lastView: { private: { selfAlignment, selfRole } },
});

test('validates scenario-specific player counts', () => {
  assert.equal(validateScenario('tie-vote', 6).traceability[0], 'AC-003');
  assert.throws(() => validateScenario('tie-vote', 5), /at least 6/u);
  assert.throws(() => validateScenario('tie-vote', 7), /exactly 6/u);
  assert.throws(
    () => validateScenario('fourth-quest-double-fail', 6),
    /at least 7/u,
  );
});

test('maps deterministic quest outcomes to required fail choices', () => {
  assert.deepEqual(
    [1, 2, 3, 4, 5].map((questIndex) =>
      desiredQuestFailChoices(
        'happy-path',
        questIndex,
        questIndex === 4 ? 2 : 1,
      ),
    ),
    [0, 1, 0, 2, 0],
  );
  assert.equal(desiredQuestFailChoices('fourth-quest-single-fail', 4, 2), 1);
  assert.equal(desiredQuestFailChoices('fourth-quest-double-fail', 4, 2), 2);
  assert.equal(desiredQuestFailChoices('assassination-hit', 3, 1), 0);
});

test('forms a 6-player 3:3 vote when the human approves', () => {
  const botVotes = Array.from({ length: 5 }, (_, botIndex) =>
    teamVoteForBot({
      botIndex,
      proposalAttempt: 1,
      questIndex: 1,
      scenario: 'tie-vote',
    }),
  );
  assert.deepEqual(botVotes, [
    'APPROVE',
    'APPROVE',
    'REJECT',
    'REJECT',
    'REJECT',
  ]);
});

test('chooses enough evil bots without including the human when capacity allows', () => {
  const players = Array.from({ length: 7 }, (_, index) => player(index + 1));
  const bots = [
    bot(2, 'EVIL', 'ASSASSIN'),
    bot(3, 'GOOD', 'LOYAL_SERVANT'),
    bot(4, 'EVIL', 'MINION'),
    bot(5, 'GOOD', 'MERLIN'),
    bot(6, 'GOOD', 'LOYAL_SERVANT'),
    bot(7, 'GOOD', 'LOYAL_SERVANT'),
  ];
  const team = chooseTeam({
    botMembers: bots,
    failChoices: 2,
    players,
    requiredTeamSize: 4,
  });
  assert.deepEqual(team.slice(0, 2), [player(2).playerId, player(4).playerId]);
  assert.equal(team.length, 4);
  assert.equal(team.includes(player(1).playerId), false);
});

test('targets or avoids Merlin without persisting a role map', () => {
  const players = Array.from({ length: 5 }, (_, index) => player(index + 1));
  const bots = [
    bot(2, 'EVIL', 'ASSASSIN'),
    bot(3, 'GOOD', 'MERLIN'),
    bot(4, 'GOOD', 'LOYAL_SERVANT'),
    bot(5, 'EVIL', 'MINION'),
  ];
  assert.equal(
    assassinationTarget({
      scenario: 'assassination-hit',
      players,
      botMembers: bots,
    }),
    player(3).playerId,
  );
  assert.notEqual(
    assassinationTarget({
      scenario: 'assassination-miss',
      players,
      botMembers: bots,
    }),
    player(3).playerId,
  );
});

test('parses the documented CLI and returns sanitized expectations', () => {
  const options = parseAcceptanceBotArgs([
    '--',
    '--room-code',
    '234567',
    '--scenario',
    'reconnect',
    '--bots',
    '4',
    '--no-report',
  ]);
  assert.equal(options.roomCode, '234567');
  assert.equal(options.botCount, 4);
  assert.equal(options.report, false);
  assert.deepEqual(scenarioExpectation('reconnect'), { recovered: true });
});

test('locks the recommended 5-player bot launcher to four bots and the exact public deck', () => {
  const options = recommendedFivePlayerOptions([
    '--',
    '--room-code',
    '234567',
    '--bots',
    '2',
  ]);
  assert.equal(options.botCount, 4);
  assert.equal(options.expectedConfig, 'recommended-5p');
  assert.equal(options.scenario, 'happy-path');

  assert.doesNotThrow(() =>
    assertExpectedRoomConfig('recommended-5p', {
      playerCount: 5,
      roleIds: ['MERLIN', 'PERCIVAL', 'LOYAL_SERVANT', 'MORGANA', 'ASSASSIN'],
    }),
  );
  assert.throws(
    () =>
      assertExpectedRoomConfig('recommended-5p', {
        playerCount: 5,
        roleIds: [
          'MERLIN',
          'LOYAL_SERVANT',
          'LOYAL_SERVANT',
          'ASSASSIN',
          'MINION',
        ],
      }),
    /requires roles/u,
  );
  assert.throws(
    () =>
      assertExpectedRoomConfig('recommended-5p', {
        playerCount: 6,
        roleIds: [],
      }),
    /requires a 5-player room/u,
  );
});

test('parses isolated web player launcher options', () => {
  const options = parseWebPlayerArgs([
    '--',
    '--room-code',
    '234567',
    '--players',
    '5',
    '--headless',
    '--screenshots',
  ]);
  assert.equal(options.playerCount, 5);
  assert.equal(options.headless, true);
  assert.equal(options.screenshots, true);
});
