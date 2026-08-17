import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  alignmentForRole,
  collectInvariantViolations,
  createInitialGameState,
  executeCommand,
  type GameState,
  type QuestChoice,
} from './index.js';
import {
  accepted,
  approveTeam,
  command,
  config,
  configInput,
  fixedPorts,
  lobbyState,
  players,
  settleQuest,
  startAndAcknowledge,
  teamForQuest,
  type TestCommandBody,
} from './__tests__/helpers.js';

const REPRODUCIBLE_SEED = 20_260_813;
const PROPERTY_RUNS = 80;

describe('M1-007 fast-check properties (seed 20260813)', () => {
  it('keeps assignments, leader bounds, and invariants valid for injected random streams', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 239 }),
        fc.integer({ min: 5, max: 10 }),
        (byte, rawCount) => {
          const count = rawCount as 5 | 6 | 7 | 8 | 9 | 10;
          const ports = fixedPorts([byte]);
          const initial = createInitialGameState(config(count), players(count));
          const started = accepted(
            initial,
            initial.hostPlayerId,
            { type: 'StartGame' },
            ports,
          );
          expect(Object.keys(started.roleAssignments)).toHaveLength(count);
          expect(
            new Set(Object.values(started.roleAssignments)).size,
          ).toBeGreaterThan(1);
          expect(started.leaderSeatIndex).toBeGreaterThanOrEqual(0);
          expect(started.leaderSeatIndex).toBeLessThan(count);
          expect(collectInvariantViolations(started)).toEqual([]);
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('makes state versions strictly monotonic on success and stable on rejection/replay', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 239 }), (byte) => {
        const ports = fixedPorts([byte]);
        const initial = createInitialGameState(config(5), players(5));
        const startCommand = command(initial, initial.hostPlayerId, {
          type: 'StartGame',
        });
        const started = executeCommand(initial, startCommand, ports);
        expect(started.state.stateVersion).toBe(initial.stateVersion + 1);
        const replay = executeCommand(started.state, startCommand, ports);
        expect(replay.state.stateVersion).toBe(started.state.stateVersion);
        const rejected = executeCommand(
          replay.state,
          command(replay.state, 'player-2', { type: 'ContinuePhase' }),
          ports,
        );
        expect(rejected.result).toMatchObject({
          accepted: false,
          errorCode: 'NOT_HOST',
        });
        expect(rejected.state.stateVersion).toBe(started.state.stateVersion);
      }),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('never lets a good role create FAIL or alter public progress', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 239 }), (byte) => {
        const ports = fixedPorts([byte]);
        let state = startAndAcknowledge(5, ports);
        const good = state.players.find((player) => {
          const role = state.roleAssignments[player.playerId];
          return role !== undefined && alignmentForRole(role) === 'GOOD';
        });
        if (good === undefined) throw new Error('No good player');
        const team = teamForQuest(state, [good.playerId]);
        state = approveTeam(state, team, ports);
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'ContinuePhase' },
          ports,
        );
        const before = state;
        const rejected = executeCommand(
          state,
          command(state, good.playerId, {
            type: 'SubmitQuestChoice',
            choice: 'FAIL',
          }),
          ports,
        );
        expect(rejected.result).toMatchObject({
          accepted: false,
          errorCode: 'GOOD_CANNOT_FAIL',
        });
        expect(rejected.state).toBe(before);
      }),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('keeps scores bounded and invariants valid across generated legal quest models', () => {
    fc.assert(
      fc.property(
        fc.array(fc.boolean(), { minLength: 1, maxLength: 5 }),
        (questSucceeds) => {
          const ports = fixedPorts();
          let state = startAndAcknowledge(5, ports);
          let modelSuccess = 0;
          let modelFailure = 0;
          const evil = state.players.find((player) => {
            const role = state.roleAssignments[player.playerId];
            return role !== undefined && alignmentForRole(role) === 'EVIL';
          })?.playerId;
          if (evil === undefined) throw new Error('No evil player');

          for (const questSucceeded of questSucceeds) {
            if (modelSuccess === 3 || modelFailure === 3) break;
            const team = teamForQuest(state, questSucceeded ? [] : [evil]);
            state = settleQuest(
              state,
              team,
              questSucceeded ? new Set() : new Set([evil]),
              ports,
            );
            if (questSucceeded) modelSuccess += 1;
            else modelFailure += 1;
            expect(state.successCount).toBe(modelSuccess);
            expect(state.failureCount).toBe(modelFailure);
            expect(state.successCount + state.failureCount).toBe(
              state.questHistory.length,
            );
            expect(state.successCount).toBeLessThanOrEqual(3);
            expect(state.failureCount).toBeLessThanOrEqual(3);
            expect(collectInvariantViolations(state)).toEqual([]);
            if (modelSuccess < 3 && modelFailure < 3) {
              state = accepted(
                state,
                state.hostPlayerId,
                { type: 'ContinuePhase' },
                ports,
              );
            }
          }
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('settles the same anonymous result under any task-action submission order', () => {
    const ports = fixedPorts();
    let base = startAndAcknowledge(5, ports);
    const evil = base.players.find((player) => {
      const role = base.roleAssignments[player.playerId];
      return role !== undefined && alignmentForRole(role) === 'EVIL';
    })?.playerId;
    if (evil === undefined) throw new Error('No evil player');
    const team = teamForQuest(base, [evil]);
    base = approveTeam(base, team, ports);
    base = accepted(base, base.hostPlayerId, { type: 'ContinuePhase' }, ports);

    fc.assert(
      fc.property(
        fc.shuffledSubarray([...team], {
          minLength: team.length,
          maxLength: team.length,
        }),
        (submissionOrder) => {
          let state = base;
          const orderPorts = fixedPorts();
          for (const playerId of submissionOrder) {
            const choice: QuestChoice = playerId === evil ? 'FAIL' : 'SUCCESS';
            state = accepted(
              state,
              playerId,
              { type: 'SubmitQuestChoice', choice },
              orderPorts,
            );
          }
          expect(state.questHistory.at(-1)).toEqual({
            questIndex: 1,
            leaderPlayerId: base.players.find(
              (player) => player.seat === base.leaderSeatIndex,
            )?.playerId,
            teamPlayerIds: team,
            successChoices: team.length - 1,
            failChoices: 1,
            requiredFails: 1,
            result: 'FAILURE',
          });
          expect(state.questChoices).toEqual({});
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('preserves all secret state through generated pause/resume points', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 4 }), (acceptedVotes) => {
        const ports = fixedPorts();
        let state = startAndAcknowledge(5, ports);
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'ContinuePhase' },
          ports,
        );
        state = accepted(
          state,
          state.players.find((player) => player.seat === state.leaderSeatIndex)
            ?.playerId ?? '',
          { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
          ports,
        );
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'ContinuePhase' },
          ports,
        );
        for (const player of state.players.slice(0, acceptedVotes)) {
          state = accepted(
            state,
            player.playerId,
            { type: 'SubmitTeamVote', vote: 'APPROVE' },
            ports,
          );
        }
        const secretSnapshot = {
          roles: state.roleAssignments,
          knowledge: state.privateKnowledge,
          votes: state.teamVotes,
          choices: state.questChoices,
          leader: state.leaderSeatIndex,
          quest: state.questIndex,
          cue: state.currentAudioCue,
        };
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'PauseGame' },
          ports,
        );
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'ResumeGame' },
          ports,
        );
        expect({
          roles: state.roleAssignments,
          knowledge: state.privateKnowledge,
          votes: state.teamVotes,
          choices: state.questChoices,
          leader: state.leaderSeatIndex,
          quest: state.questIndex,
          cue: state.currentAudioCue,
        }).toEqual(secretSnapshot);
      }),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('makes terminal winner, reason, roles, and score immutable', () => {
    const ports = fixedPorts();
    let state = startAndAcknowledge(5, ports);
    const evil = state.players.find((player) => {
      const role = state.roleAssignments[player.playerId];
      return role !== undefined && alignmentForRole(role) === 'EVIL';
    })?.playerId;
    if (evil === undefined) throw new Error('No evil player');
    for (let quest = 0; quest < 3; quest += 1) {
      state = settleQuest(
        state,
        teamForQuest(state, [evil]),
        new Set([evil]),
        ports,
      );
      if (quest < 2) {
        state = accepted(
          state,
          state.hostPlayerId,
          { type: 'ContinuePhase' },
          ports,
        );
      }
    }
    state = accepted(
      state,
      state.hostPlayerId,
      { type: 'ContinuePhase' },
      ports,
    );
    const terminal = {
      outcome: state.gameOutcome,
      roles: state.roleAssignments,
      success: state.successCount,
      failure: state.failureCount,
    };

    fc.assert(
      fc.property(
        fc.constantFrom('ContinuePhase', 'PauseGame', 'AckRole'),
        (type) => {
          const terminalCommand =
            type === 'ContinuePhase'
              ? ({ type: 'ContinuePhase' } as const)
              : type === 'PauseGame'
                ? ({ type: 'PauseGame' } as const)
                : ({ type: 'AckRole' } as const);
          const result = executeCommand(
            state,
            command(state, state.hostPlayerId, terminalCommand),
            ports,
          );
          expect(result.result.accepted).toBe(false);
          expect({
            outcome: result.state.gameOutcome,
            roles: result.state.roleAssignments,
            success: result.state.successCount,
            failure: result.state.failureCount,
          }).toEqual(terminal);
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: 20 },
    );
  });
});

interface VoteModel {
  readonly submitted: Set<number>;
  resolved: boolean;
  version: number;
}

interface VoteReal {
  state: GameState;
  readonly ports: ReturnType<typeof fixedPorts>;
}

class VoteModelCommand implements fc.Command<VoteModel, VoteReal> {
  public constructor(
    private readonly playerIndex: number,
    private readonly approve: boolean,
  ) {}

  public check(model: Readonly<VoteModel>): boolean {
    return !model.resolved && !model.submitted.has(this.playerIndex);
  }

  public run(model: VoteModel, real: VoteReal): void {
    const player = real.state.players[this.playerIndex];
    if (player === undefined) throw new Error('Generated player out of range');
    const previousVersion = real.state.stateVersion;
    real.state = accepted(
      real.state,
      player.playerId,
      { type: 'SubmitTeamVote', vote: this.approve ? 'APPROVE' : 'REJECT' },
      real.ports,
    );
    model.submitted.add(this.playerIndex);
    model.version += 1;
    model.resolved = model.submitted.size === real.state.players.length;
    expect(real.state.stateVersion).toBe(previousVersion + 1);
    expect(real.state.stateVersion).toBe(model.version);
    expect(new Set(Object.keys(real.state.teamVotes)).size).toBe(
      model.submitted.size,
    );
    expect(collectInvariantViolations(real.state)).toEqual([]);
  }

  public toString(): string {
    return `vote(${String(this.playerIndex)},${this.approve ? 'A' : 'R'})`;
  }
}

describe('M1-007 fast-check stateful model', () => {
  it('accepts each generated player vote at most once and resolves exactly on the fifth', () => {
    const commandArbitrary = fc
      .tuple(fc.integer({ min: 0, max: 4 }), fc.boolean())
      .map(
        ([playerIndex, approve]) => new VoteModelCommand(playerIndex, approve),
      );

    fc.assert(
      fc.property(
        fc.commands([commandArbitrary], { maxCommands: 20 }),
        (generatedCommands) => {
          const ports = fixedPorts();
          let state = startAndAcknowledge(5, ports);
          state = accepted(
            state,
            state.hostPlayerId,
            { type: 'ContinuePhase' },
            ports,
          );
          state = accepted(
            state,
            state.players.find(
              (player) => player.seat === state.leaderSeatIndex,
            )?.playerId ?? '',
            { type: 'SubmitTeam', teamPlayerIds: teamForQuest(state) },
            ports,
          );
          state = accepted(
            state,
            state.hostPlayerId,
            { type: 'ContinuePhase' },
            ports,
          );
          fc.modelRun(
            () => ({
              model: {
                submitted: new Set<number>(),
                resolved: false,
                version: state.stateVersion,
              },
              real: { state, ports },
            }),
            generatedCommands,
          );
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });
});

describe('M3-002 lobby command sequence invariants (seed 20260813)', () => {
  type LobbyAction =
    | {
        readonly kind: 'READY';
        readonly playerIndex: number;
        readonly ready: boolean;
      }
    | { readonly kind: 'REORDER'; readonly rotateBy: number }
    | {
        readonly kind: 'RECONFIGURE';
        readonly preset: 'CLASSIC' | 'RECOMMENDED';
      }
    | { readonly kind: 'LEAVE'; readonly playerIndex: number }
    | { readonly kind: 'KICK'; readonly playerIndex: number };

  const actionArbitrary: fc.Arbitrary<LobbyAction> = fc.oneof(
    fc
      .tuple(fc.integer({ min: 0, max: 9 }), fc.boolean())
      .map(([playerIndex, ready]) => ({
        kind: 'READY' as const,
        playerIndex,
        ready,
      })),
    fc
      .integer({ min: 0, max: 9 })
      .map((rotateBy) => ({ kind: 'REORDER' as const, rotateBy })),
    fc
      .constantFrom('CLASSIC' as const, 'RECOMMENDED' as const)
      .map((preset) => ({ kind: 'RECONFIGURE' as const, preset })),
    fc
      .integer({ min: 0, max: 9 })
      .map((playerIndex) => ({ kind: 'LEAVE' as const, playerIndex })),
    fc
      .integer({ min: 0, max: 9 })
      .map((playerIndex) => ({ kind: 'KICK' as const, playerIndex })),
  );

  it('never produces duplicate seats, non-contiguous seats, or leftover ready=true after config/seat mutation', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 5, max: 10 }),
        fc.array(actionArbitrary, { minLength: 0, maxLength: 25 }),
        (rawCount, actions) => {
          const count = rawCount as 5 | 6 | 7 | 8 | 9 | 10;
          const ports = fixedPorts();
          let state = lobbyState(count);

          for (const action of actions) {
            if (state.phase !== 'LOBBY') break;
            const ids = state.players.map((player) => player.playerId);
            switch (action.kind) {
              case 'READY': {
                const target = ids[action.playerIndex % ids.length];
                if (target === undefined) break;
                const transition = executeCommand(
                  state,
                  command(state, target, {
                    type: 'SetReady',
                    ready: action.ready,
                  }),
                  ports,
                );
                if (transition.result.accepted) state = transition.state;
                break;
              }
              case 'REORDER': {
                const rotate = action.rotateBy % ids.length;
                const rotated = [...ids.slice(rotate), ...ids.slice(0, rotate)];
                const transition = executeCommand(
                  state,
                  command(state, state.hostPlayerId, {
                    type: 'ReorderSeats',
                    playerIds: rotated,
                  }),
                  ports,
                );
                if (transition.result.accepted) {
                  expect(
                    transition.state.players.every((player) => !player.ready),
                  ).toBe(true);
                  state = transition.state;
                }
                break;
              }
              case 'RECONFIGURE': {
                const transition = executeCommand(
                  state,
                  command(state, state.hostPlayerId, {
                    type: 'ConfigureRoom',
                    configInput: configInput(
                      Math.max(state.players.length, count),
                      action.preset,
                    ),
                  }),
                  ports,
                );
                if (transition.result.accepted) {
                  expect(
                    transition.state.players.every((player) => !player.ready),
                  ).toBe(true);
                  state = transition.state;
                }
                break;
              }
              case 'LEAVE': {
                const target = ids[action.playerIndex % ids.length];
                if (target === undefined || target === state.hostPlayerId) {
                  break;
                }
                const transition = executeCommand(
                  state,
                  command(state, target, { type: 'LeaveLobby' }),
                  ports,
                );
                if (transition.result.accepted) {
                  expect(
                    transition.state.players.every((player) => !player.ready),
                  ).toBe(true);
                  state = transition.state;
                }
                break;
              }
              case 'KICK': {
                const target = ids[action.playerIndex % ids.length];
                if (target === undefined || target === state.hostPlayerId) {
                  break;
                }
                const transition = executeCommand(
                  state,
                  command(state, state.hostPlayerId, {
                    type: 'KickLobbyPlayer',
                    targetPlayerId: target,
                  }),
                  ports,
                );
                if (transition.result.accepted) {
                  expect(
                    transition.state.players.every((player) => !player.ready),
                  ).toBe(true);
                  state = transition.state;
                }
                break;
              }
            }
            expect(collectInvariantViolations(state)).toEqual([]);
          }

          // Seats must always be a contiguous 0..n-1 range with unique players.
          const seats = state.players
            .map((player) => player.seat)
            .sort((a, b) => a - b);
          seats.forEach((seat, index) => {
            expect(seat).toBe(index);
          });
          expect(
            new Set(state.players.map((player) => player.playerId)).size,
          ).toBe(state.players.length);

          // Any accepted config/seat mutation must have left no stale ready=true.
          // (StartGame is host-only and requires ready=true, so this is only
          // asserted while still in the lobby.)
          if (state.phase === 'LOBBY' && actions.length > 0) {
            expect(collectInvariantViolations(state)).toEqual([]);
          }
        },
      ),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });

  it('freezes config, seats, and role assignments once the game has started', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 239 }), (byte) => {
        const ports = fixedPorts([byte]);
        const initial = createInitialGameState(config(6), players(6));
        const started = accepted(
          initial,
          initial.hostPlayerId,
          { type: 'StartGame' },
          ports,
        );

        const immutableSnapshot = {
          config: started.config,
          players: started.players,
          roleAssignments: started.roleAssignments,
        };
        const reversedPlayerIds = started.players
          .map((player) => player.playerId)
          .slice()
          .reverse();
        const attempts: readonly {
          readonly actor: string;
          readonly body: TestCommandBody;
        }[] = [
          {
            actor: started.hostPlayerId,
            body: {
              type: 'ConfigureRoom',
              configInput: configInput(6, 'RECOMMENDED'),
            },
          },
          {
            actor: started.hostPlayerId,
            body: { type: 'ReorderSeats', playerIds: reversedPlayerIds },
          },
          {
            actor: 'player-2',
            body: { type: 'SetReady', ready: false },
          },
          { actor: 'player-2', body: { type: 'LeaveLobby' } },
          {
            actor: started.hostPlayerId,
            body: {
              type: 'KickLobbyPlayer',
              targetPlayerId: 'player-2',
            },
          },
          { actor: started.hostPlayerId, body: { type: 'CloseRoom' } },
        ];

        for (const attempt of attempts) {
          const rejected = executeCommand(
            started,
            command(started, attempt.actor, attempt.body),
            ports,
          );
          expect(rejected.result).toMatchObject({
            accepted: false,
            errorCode: 'INVALID_PHASE',
          });
          expect(rejected.state).toBe(started);
          expect({
            config: rejected.state.config,
            players: rejected.state.players,
            roleAssignments: rejected.state.roleAssignments,
          }).toEqual(immutableSnapshot);
        }
      }),
      { seed: REPRODUCIBLE_SEED, numRuns: PROPERTY_RUNS },
    );
  });
});
