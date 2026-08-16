export const ACCEPTANCE_SCENARIOS = Object.freeze({
  'happy-path': {
    label: '五轮正常流程（成功、失败、成功、失败、成功）',
    traceability: ['AC-001', 'AC-002', 'AC-007', 'AC-008', 'AC-015'],
    minimumPlayers: 5,
  },
  'tie-vote': {
    label: '6 人首轮组队票 3:3 否决',
    traceability: ['AC-003'],
    minimumPlayers: 6,
    maximumPlayers: 6,
  },
  'five-rejections': {
    label: '同一任务连续五次组队否决',
    traceability: ['AC-004'],
    minimumPlayers: 5,
  },
  'fourth-quest-single-fail': {
    label: '7–10 人第四次任务一张失败仍成功',
    traceability: ['AC-006'],
    minimumPlayers: 7,
  },
  'fourth-quest-double-fail': {
    label: '7–10 人第四次任务两张失败而失败',
    traceability: ['AC-006'],
    minimumPlayers: 7,
  },
  'assassination-hit': {
    label: '三次任务成功后刺杀命中梅林',
    traceability: ['AC-007'],
    minimumPlayers: 5,
  },
  'assassination-miss': {
    label: '三次任务成功后刺杀未命中梅林',
    traceability: ['AC-007'],
    minimumPlayers: 5,
  },
  reconnect: {
    label: '投票已提交的普通玩家断线并恢复',
    traceability: ['AC-009', 'AC-010', 'AC-011'],
    minimumPlayers: 5,
  },
});

export function scenarioNames() {
  return Object.keys(ACCEPTANCE_SCENARIOS);
}

export function validateScenario(scenario, playerCount) {
  const definition = ACCEPTANCE_SCENARIOS[scenario];
  if (definition === undefined) {
    throw new Error(
      `Unknown scenario ${scenario}. Expected one of: ${scenarioNames().join(', ')}`,
    );
  }
  if (playerCount < definition.minimumPlayers) {
    throw new Error(
      `${scenario} requires at least ${String(definition.minimumPlayers)} players`,
    );
  }
  if (
    definition.maximumPlayers !== undefined &&
    playerCount > definition.maximumPlayers
  ) {
    throw new Error(
      `${scenario} requires exactly ${String(definition.maximumPlayers)} players`,
    );
  }
  return definition;
}

export function desiredQuestFailChoices(
  scenario,
  questIndex,
  requiredQuestFails,
) {
  if (scenario === 'assassination-hit' || scenario === 'assassination-miss') {
    return 0;
  }
  if (scenario === 'fourth-quest-single-fail') {
    if (questIndex === 2) return 1;
    if (questIndex === 4) return 1;
    return 0;
  }
  if (scenario === 'fourth-quest-double-fail') {
    if (questIndex === 2) return 1;
    if (questIndex === 4) return 2;
    return 0;
  }
  if (scenario === 'five-rejections') return 0;
  const desiredFailure = [false, true, false, true, false][questIndex - 1];
  return desiredFailure ? requiredQuestFails : 0;
}

export function teamVoteForBot({
  scenario,
  questIndex,
  proposalAttempt,
  botIndex,
}) {
  if (scenario === 'five-rejections' && questIndex === 1) return 'REJECT';
  if (scenario === 'tie-vote' && questIndex === 1 && proposalAttempt === 1) {
    // The human host is instructed to approve. Two approving bots plus the
    // host and three rejecting bots produce the required 3:3 result.
    return botIndex < 2 ? 'APPROVE' : 'REJECT';
  }
  return 'APPROVE';
}

export function chooseTeam({
  players,
  botMembers,
  requiredTeamSize,
  failChoices,
}) {
  const seatByPlayer = new Map(
    players.map((player) => [player.playerId, player.seat]),
  );
  const bySeat = (left, right) =>
    (seatByPlayer.get(left.playerId) ?? 99) -
    (seatByPlayer.get(right.playerId) ?? 99);
  const evilBots = botMembers
    .filter((member) => member.lastView?.private?.selfAlignment === 'EVIL')
    .sort(bySeat);
  if (evilBots.length < failChoices) {
    throw new Error(
      `Scenario needs ${String(failChoices)} evil bots on the quest, but only ${String(evilBots.length)} are available`,
    );
  }
  const selected = evilBots
    .slice(0, failChoices)
    .map((member) => member.playerId);
  const botPlayerIds = new Set(botMembers.map((member) => member.playerId));
  const candidates = [...players].sort((left, right) => {
    const botPriority =
      Number(botPlayerIds.has(right.playerId)) -
      Number(botPlayerIds.has(left.playerId));
    return botPriority === 0 ? left.seat - right.seat : botPriority;
  });
  for (const player of candidates) {
    if (selected.length >= requiredTeamSize) break;
    if (!selected.includes(player.playerId)) selected.push(player.playerId);
  }
  if (selected.length !== requiredTeamSize) {
    throw new Error('Could not build a quest team of the required size');
  }
  return selected;
}

export function questChoiceForBot(
  member,
  botMembers,
  failChoices,
  teamPlayerIds,
) {
  const evilTeam = teamPlayerIds.filter((playerId) => {
    const candidate = botMembers.find((bot) => bot.playerId === playerId);
    return candidate?.lastView?.private?.selfAlignment === 'EVIL';
  });
  const failingPlayerIds = new Set(evilTeam.slice(0, failChoices));
  const allowed = member.lastView?.private?.availableActions.find(
    (action) => action.commandType === 'SubmitQuestChoice',
  )?.allowedQuestChoices;
  if (failingPlayerIds.has(member.playerId) && allowed?.includes('FAIL')) {
    return 'FAIL';
  }
  return 'SUCCESS';
}

export function assassinationTarget({ scenario, players, botMembers }) {
  const assassin = botMembers.find(
    (member) => member.lastView?.private?.selfRole === 'ASSASSIN',
  );
  if (assassin === undefined) return undefined;
  const botMerlin = botMembers.find(
    (member) => member.lastView?.private?.selfRole === 'MERLIN',
  );
  const humanPlayers = players.filter(
    (player) =>
      !botMembers.some((member) => member.playerId === player.playerId),
  );
  const merlinId =
    botMerlin?.playerId ??
    (humanPlayers.length === 1 ? humanPlayers[0]?.playerId : undefined);
  if (merlinId === undefined) {
    throw new Error('Could not identify the human Merlin unambiguously');
  }
  if (scenario === 'assassination-hit') return merlinId;
  const miss = players.find(
    (player) =>
      player.playerId !== assassin.playerId && player.playerId !== merlinId,
  );
  if (miss === undefined) throw new Error('No legal assassination miss exists');
  return miss.playerId;
}

export function scenarioExpectation(scenario) {
  if (scenario === 'five-rejections') {
    return { phase: 'GAME_OVER', reason: 'FIVE_REJECTED_TEAMS' };
  }
  if (scenario === 'assassination-hit') {
    return { phase: 'GAME_OVER', reason: 'MERLIN_ASSASSINATED' };
  }
  if (scenario === 'assassination-miss') {
    return { phase: 'GAME_OVER', reason: 'MERLIN_SURVIVED' };
  }
  if (scenario === 'tie-vote') {
    return { proposalAttempt: 2, firstProposalApproved: false };
  }
  if (scenario === 'fourth-quest-single-fail') {
    return { questIndex: 4, questResult: 'SUCCESS', failChoices: 1 };
  }
  if (scenario === 'fourth-quest-double-fail') {
    return { questIndex: 4, questResult: 'FAILURE', failChoices: 2 };
  }
  if (scenario === 'reconnect') return { recovered: true };
  return { questHistoryLength: 5 };
}
