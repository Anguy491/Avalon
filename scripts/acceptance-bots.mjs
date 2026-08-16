import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  assassinationTarget,
  chooseTeam,
  desiredQuestFailChoices,
  questChoiceForBot,
  scenarioExpectation,
  scenarioNames,
  teamVoteForBot,
  validateScenario,
} from './acceptance-scenarios.mjs';
import {
  ProtocolCommandRejectedError,
  createProtocolTestClient,
} from './lib/protocol-test-client.mjs';

const ROOM_CODE_PATTERN = /^[23456789ABCDEFGHJKLMNPQRSTUVWXYZ]{6}$/u;

function usage() {
  return `Usage:
  pnpm acceptance:bots -- --room-code ABCDEF [options]

Options:
  --scenario <name>       ${scenarioNames().join(' | ')}
  --bots <1-9>            Join exactly this many bots; default fills the room
  --api-origin <url>      Default: http://127.0.0.1:3000
  --realtime-url <url>    Override bootstrap realtime URL for local testing
  --disconnect-ms <ms>    Reconnect scenario outage; default: 20000
  --report-dir <path>     Default: output/acceptance
  --no-report             Do not write the sanitized JSON evidence file
  --help                  Show this help

Create the room on the native app first and keep its human player as host.`;
}

function parseInteger(value, name, minimum, maximum) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new Error(
      `${name} must be an integer between ${String(minimum)} and ${String(maximum)}`,
    );
  }
  return parsed;
}

export function parseAcceptanceBotArgs(argv) {
  const options = {
    apiOrigin: process.env.ACCEPTANCE_API_ORIGIN ?? 'http://127.0.0.1:3000',
    botCount: undefined,
    disconnectMs: 20_000,
    realtimeUrl: process.env.ACCEPTANCE_REALTIME_URL,
    report: true,
    reportDir: 'output/acceptance',
    roomCode: process.env.ACCEPTANCE_ROOM_CODE,
    scenario: process.env.ACCEPTANCE_SCENARIO ?? 'happy-path',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    const next = () => {
      const value = argv[index + 1];
      if (value === undefined) throw new Error(`${argument} requires a value`);
      index += 1;
      return value;
    };
    if (argument === '--') continue;
    if (argument === '--help') return { ...options, help: true };
    if (argument === '--room-code') options.roomCode = next();
    else if (argument === '--scenario') options.scenario = next();
    else if (argument === '--api-origin') options.apiOrigin = next();
    else if (argument === '--realtime-url') options.realtimeUrl = next();
    else if (argument === '--report-dir') options.reportDir = next();
    else if (argument === '--no-report') options.report = false;
    else if (argument === '--bots') {
      options.botCount = parseInteger(next(), '--bots', 1, 9);
    } else if (argument === '--disconnect-ms') {
      options.disconnectMs = parseInteger(
        next(),
        '--disconnect-ms',
        10_000,
        120_000,
      );
    } else {
      throw new Error(`Unknown argument: ${String(argument)}`);
    }
  }
  options.roomCode = options.roomCode?.trim().toUpperCase();
  if (!ROOM_CODE_PATTERN.test(options.roomCode ?? '')) {
    throw new Error('--room-code must be a complete six-character room code');
  }
  if (!scenarioNames().includes(options.scenario)) {
    throw new Error(`--scenario must be one of: ${scenarioNames().join(', ')}`);
  }
  return options;
}

function action(member, commandType) {
  return member.lastView?.private?.availableActions.find(
    (candidate) => candidate.commandType === commandType,
  );
}

function playerFor(member, playerId) {
  return member.lastView?.public?.players.find(
    (player) => player.playerId === playerId,
  );
}

function publicSummary(view) {
  const latestQuest = view.public.questHistory.at(-1);
  const latestProposal = view.public.proposalHistory.at(-1);
  return {
    failureCount: view.public.failureCount,
    gameOutcomeReason: view.public.gameOutcome?.reason,
    latestProposal: latestProposal
      ? {
          approveCount: latestProposal.approveCount,
          approved: latestProposal.approved,
          proposalAttempt: latestProposal.proposalAttempt,
          questIndex: latestProposal.questIndex,
          rejectCount: latestProposal.rejectCount,
        }
      : undefined,
    latestQuest: latestQuest
      ? {
          failChoices: latestQuest.failChoices,
          questIndex: latestQuest.questIndex,
          requiredFails: latestQuest.requiredFails,
          result: latestQuest.result,
          successChoices: latestQuest.successChoices,
        }
      : undefined,
    phase: view.public.phase,
    phaseStage: view.public.phaseStage,
    proposalAttempt: view.public.proposalAttempt,
    questIndex: view.public.questIndex,
    stateVersion: view.public.stateVersion,
    successCount: view.public.successCount,
  };
}

function expectationReached(scenario, view, runtime) {
  const expectation = scenarioExpectation(scenario);
  if (scenario === 'tie-vote') {
    const first = view.public.proposalHistory[0];
    return (
      first?.approved === false &&
      first.approveCount === 3 &&
      first.rejectCount === 3
    );
  }
  if (
    scenario === 'fourth-quest-single-fail' ||
    scenario === 'fourth-quest-double-fail'
  ) {
    const fourth = view.public.questHistory.find(
      (quest) => quest.questIndex === 4,
    );
    return (
      fourth?.result === expectation.questResult &&
      fourth.failChoices === expectation.failChoices
    );
  }
  if (scenario === 'reconnect') return runtime.recovered;
  if (scenario === 'happy-path') {
    return (
      view.public.phase === 'GAME_OVER' &&
      view.public.questHistory.length === expectation.questHistoryLength
    );
  }
  return (
    view.public.phase === expectation.phase &&
    view.public.gameOutcome?.reason === expectation.reason
  );
}

function desiredTeamIsSatisfied(view, bots, scenario) {
  const failChoices = desiredQuestFailChoices(
    scenario,
    view.public.questIndex,
    view.public.requiredQuestFails,
  );
  if (failChoices === 0) return true;
  const evilBotIds = new Set(
    bots
      .filter((bot) => bot.lastView?.private?.selfAlignment === 'EVIL')
      .map((bot) => bot.playerId),
  );
  return (
    view.public.proposedTeamPlayerIds.filter((playerId) =>
      evilBotIds.has(playerId),
    ).length >= failChoices
  );
}

function humanPrompt(view, bots, scenario) {
  const human = view.public.players.find(
    (player) => !bots.some((bot) => bot.playerId === player.playerId),
  );
  if (human === undefined) return '等待真人玩家操作';
  if (view.public.phase === 'LOBBY') {
    return human.ready
      ? '房间已填满；请由房主点击“开始游戏”'
      : '请真人房主先点击“准备”，然后开始游戏';
  }
  if (view.public.phaseStage === 'HOST_HELD') {
    return '请真人房主检查字幕/音频后点击继续';
  }
  if (view.public.phase === 'ROLE_REVEAL') return '请真人确认自己的身份';
  if (view.public.phase === 'TEAM_PROPOSAL') {
    return view.public.leaderPlayerId === human.playerId
      ? `请真人队长选择 ${String(view.public.requiredTeamSize)} 名队员；若场景所需失败条件不满足，Bot 会否决并交给下一位队长`
      : 'Bot 队长正在提交符合场景的队伍';
  }
  if (view.public.phase === 'TEAM_VOTE') {
    if (
      scenario === 'tie-vote' &&
      view.public.questIndex === 1 &&
      view.public.proposalAttempt === 1
    ) {
      return 'AC-003：请真人投“同意”；Bot 将形成 3:3 平票';
    }
    return '请真人提交组队票；Bot 会根据场景自动投票';
  }
  if (
    view.public.phase === 'QUEST_SUBMISSION' &&
    view.public.proposedTeamPlayerIds.includes(human.playerId)
  ) {
    return '真人在任务队伍中，请提交任务行动';
  }
  if (view.public.phase === 'ASSASSINATION') {
    return '若真人是刺客，请完成刺杀；角色定向自动化可另运行现有 M5 原生 E2E';
  }
  if (view.public.phase === 'PAUSED')
    return '房间已因断线暂停，Bot 将按场景自动恢复';
  return '等待真人房主推进当前阶段';
}

async function writeEvidence(options, definition, view, runtime, events) {
  if (!options.report) return undefined;
  const directory = resolve(options.reportDir);
  await mkdir(directory, { recursive: true });
  const stamp = new Date().toISOString().replaceAll(':', '-');
  const path = resolve(
    directory,
    `${options.scenario}-${options.roomCode}-${stamp}.json`,
  );
  const evidence = {
    completedAt: new Date().toISOString(),
    expectation: scenarioExpectation(options.scenario),
    finalPublicSummary: publicSummary(view),
    playerCount: view.public.config.playerCount,
    roomCode: options.roomCode,
    scenario: options.scenario,
    scenarioLabel: definition.label,
    traceability: definition.traceability,
    transportEvidence: {
      projectionIsolationErrors: runtime.projectionErrors,
      publicSecretScan:
        runtime.projectionErrors.length === 0 ? 'passed' : 'failed',
    },
    commands: events,
  };
  await writeFile(path, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
  return path;
}

export async function runAcceptanceBots(options) {
  const protocol = createProtocolTestClient({
    apiOrigin: options.apiOrigin,
    realtimeUrl: options.realtimeUrl,
    appVersion: '0.1.0-acceptance-bot',
    timeoutMs: 15_000,
  });
  const bootstraps = [];
  const bots = [];
  const events = [];
  const runtime = {
    disconnectStartedAt: undefined,
    disconnectedMember: undefined,
    projectionErrors: [],
    reconnectCompleted: false,
    recovered: false,
  };
  let interrupted = false;
  const interrupt = () => {
    interrupted = true;
  };
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);

  try {
    const first = await protocol.joinRoom(options.roomCode, '验收Bot01', 'IOS');
    bootstraps.push(first.payload);
    const playerCount = first.payload.roomView.public.config.playerCount;
    const definition = validateScenario(options.scenario, playerCount);
    const existingPlayers = first.payload.roomView.public.players.length;
    const botCount = options.botCount ?? playerCount - existingPlayers + 1;
    if (botCount < 1 || existingPlayers + botCount - 1 > playerCount) {
      throw new Error('Requested bots would exceed the configured room size');
    }
    for (let index = 1; index < botCount; index += 1) {
      const joined = await protocol.joinRoom(
        options.roomCode,
        `验收Bot${String(index + 1).padStart(2, '0')}`,
        index % 2 === 0 ? 'IOS' : 'ANDROID',
      );
      bootstraps.push(joined.payload);
    }
    const connected = await Promise.all(
      bootstraps.map((bootstrap) => protocol.connectMember(bootstrap)),
    );
    bots.push(...connected.map(({ member }) => member));
    const initialView = bots[0]?.lastView;
    if (initialView === undefined) throw new Error('No Bot projection exists');
    const host = initialView.public.players.find((player) => player.isHost);
    if (
      host === undefined ||
      bots.some((bot) => bot.playerId === host.playerId)
    ) {
      throw new Error('The native human player must remain the room host');
    }
    if (
      options.botCount === undefined &&
      initialView.public.players.length !== playerCount
    ) {
      throw new Error(
        'Automatic fill did not reach the configured player count',
      );
    }

    process.stdout.write(
      [
        `房间 ${options.roomCode} 已连接 ${String(bots.length)} 个 Bot（总人数 ${String(playerCount)}）`,
        `场景：${definition.label}`,
        `追踪：${definition.traceability.join(', ')}`,
        humanPrompt(initialView, bots, options.scenario),
      ].join('\n') + '\n',
    );

    let lastPromptKey = '';
    while (!interrupted) {
      const observer = bots.find((bot) => bot.socket?.connected) ?? bots[0];
      const view = observer?.lastView;
      if (view === undefined)
        throw new Error('All Bot projections are missing');
      runtime.projectionErrors = bots.flatMap((bot) => bot.projectionErrors);
      if (runtime.projectionErrors.length > 0) {
        throw new Error(runtime.projectionErrors[0]);
      }
      if (expectationReached(options.scenario, view, runtime)) {
        const evidencePath = await writeEvidence(
          options,
          definition,
          view,
          runtime,
          events,
        );
        process.stdout.write(
          `验收场景通过：${definition.traceability.join(', ')}，最终 stateVersion=${String(view.public.stateVersion)}\n`,
        );
        if (evidencePath !== undefined) {
          process.stdout.write(`证据：${evidencePath}\n`);
        }
        return;
      }

      if (
        options.scenario === 'reconnect' &&
        runtime.disconnectedMember !== undefined &&
        runtime.disconnectStartedAt !== undefined &&
        !runtime.reconnectCompleted &&
        Date.now() - runtime.disconnectStartedAt >= options.disconnectMs
      ) {
        await protocol.reconnectMember(runtime.disconnectedMember);
        runtime.reconnectCompleted = true;
        process.stdout.write('断线 Bot 已使用原会话重新连接，等待房间恢复\n');
        await delay(250);
        continue;
      }
      if (
        runtime.reconnectCompleted &&
        view.public.phase !== 'PAUSED' &&
        view.public.players.every((player) => player.connected)
      ) {
        runtime.recovered = true;
        continue;
      }

      let acted = false;
      for (const [botIndex, bot] of bots.entries()) {
        if (!bot.socket?.connected) continue;
        const botView = bot.lastView;
        if (botView === undefined) continue;
        let commandType;
        let payload = {};
        if (action(bot, 'SetReady')) {
          const self = playerFor(bot, bot.playerId);
          if (self?.ready === false) {
            commandType = 'SetReady';
            payload = { ready: true };
          }
        } else if (action(bot, 'AckRole')) {
          commandType = 'AckRole';
        } else if (action(bot, 'SubmitTeam')) {
          const failChoices = desiredQuestFailChoices(
            options.scenario,
            botView.public.questIndex,
            botView.public.requiredQuestFails,
          );
          commandType = 'SubmitTeam';
          payload = {
            teamPlayerIds: chooseTeam({
              botMembers: bots,
              failChoices,
              players: botView.public.players,
              requiredTeamSize: botView.public.requiredTeamSize,
            }),
          };
        } else if (action(bot, 'SubmitTeamVote')) {
          let vote = teamVoteForBot({
            botIndex,
            proposalAttempt: botView.public.proposalAttempt,
            questIndex: botView.public.questIndex,
            scenario: options.scenario,
          });
          if (
            vote === 'APPROVE' &&
            !desiredTeamIsSatisfied(botView, bots, options.scenario)
          ) {
            vote = 'REJECT';
          }
          commandType = 'SubmitTeamVote';
          payload = { vote };
        } else if (action(bot, 'SubmitQuestChoice')) {
          const failChoices = desiredQuestFailChoices(
            options.scenario,
            botView.public.questIndex,
            botView.public.requiredQuestFails,
          );
          commandType = 'SubmitQuestChoice';
          payload = {
            choice: questChoiceForBot(
              bot,
              bots,
              failChoices,
              botView.public.proposedTeamPlayerIds,
            ),
          };
        } else if (action(bot, 'SelectMerlinTarget')) {
          const targetPlayerId = assassinationTarget({
            botMembers: bots,
            players: botView.public.players,
            scenario: options.scenario,
          });
          if (targetPlayerId !== undefined) {
            commandType = 'SelectMerlinTarget';
            payload = { targetPlayerId };
          } else if (options.scenario === 'happy-path') {
            const eligible = action(bot, 'SelectMerlinTarget')
              ?.eligibleTargetPlayerIds?.[0];
            if (eligible !== undefined) {
              commandType = 'SelectMerlinTarget';
              payload = { targetPlayerId: eligible };
            }
          }
        }
        if (commandType === undefined) continue;

        const latestVersion = Math.max(
          ...bots.map((member) => member.lastView?.public?.stateVersion ?? 0),
        );
        await protocol.waitForVersion(bot, latestVersion);
        let submitted;
        try {
          submitted = await protocol.submit(
            bot,
            commandType,
            payload,
            latestVersion,
          );
        } catch (error) {
          if (
            error instanceof ProtocolCommandRejectedError &&
            error.code === 'STALE_VERSION'
          ) {
            await protocol.refreshMember(bot);
            acted = true;
            break;
          }
          throw error;
        }
        events.push({
          actor: 'BOT',
          commandType,
          stateVersion: submitted.result.stateVersion,
        });
        await protocol.waitForVersion(bot, submitted.result.stateVersion);
        acted = true;

        if (
          options.scenario === 'reconnect' &&
          commandType === 'SubmitTeamVote' &&
          runtime.disconnectedMember === undefined
        ) {
          runtime.disconnectedMember = bot;
          runtime.disconnectStartedAt = Date.now();
          protocol.stopConnection(bot);
          process.stdout.write(
            `AC-010：已提交组队票的 Bot 断线 ${String(options.disconnectMs / 1_000)} 秒\n`,
          );
        }
        break;
      }
      if (acted) continue;

      const promptKey = [
        view.public.phase,
        view.public.phaseStage,
        view.public.questIndex,
        view.public.proposalAttempt,
        view.public.stateVersion,
      ].join(':');
      if (promptKey !== lastPromptKey) {
        process.stdout.write(`${humanPrompt(view, bots, options.scenario)}\n`);
        lastPromptKey = promptKey;
      }
      await delay(150);
    }
    process.stdout.write('验收 Bot 已由用户中止；未写入通过证据。\n');
  } finally {
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    protocol.closeAll();
  }
}

if (
  process.argv[1] !== undefined &&
  import.meta.filename === resolve(process.argv[1])
) {
  try {
    const options = parseAcceptanceBotArgs(process.argv.slice(2));
    if (options.help) process.stdout.write(`${usage()}\n`);
    else await runAcceptanceBots(options);
  } catch (error) {
    process.stderr.write(
      `acceptance:bots failed: ${error instanceof Error ? error.message : String(error)}\n\n${usage()}\n`,
    );
    process.exitCode = 1;
  }
}
