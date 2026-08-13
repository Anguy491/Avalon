import { describe, expect, it } from 'vitest';

import type { Command, CommandResult, RoomView } from '@avalon/protocol/mobile';

import {
  CommandAckTimeoutError,
  InvalidCommandAckError,
  RoomCommandAttempts,
  shouldResyncAfterRejection,
  submitCommandWithAck,
} from './command-submission';

const view = (stateVersion = 7) =>
  ({
    public: {
      roomId: '10000000-0000-4000-8000-000000000001',
      stateVersion,
    },
  }) as RoomView;

const accepted = (commandId: string): CommandResult => ({
  commandId,
  accepted: true,
  stateVersion: 8,
});

const isCommandResult = (payload: unknown): payload is CommandResult =>
  typeof payload === 'object' &&
  payload !== null &&
  'accepted' in payload &&
  typeof payload.accepted === 'boolean';

describe('RoomCommandAttempts', () => {
  it('reuses the entire envelope after an unknown ack outcome', () => {
    const attempts = new RoomCommandAttempts();
    let sequence = 0;
    let minute = 0;
    const input = { type: 'SetReady', payload: { ready: true } } as const;
    const first = attempts.acquire(
      view(),
      input,
      () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      () => new Date(`2026-08-14T10:${String(minute++).padStart(2, '0')}:00Z`),
    );
    const retry = attempts.acquire(
      view(),
      input,
      () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
      () => new Date(`2026-08-14T10:${String(minute++).padStart(2, '0')}:00Z`),
    );

    expect(retry).toBe(first);
    expect(retry.commandId).toBe(first.commandId);
    expect(retry.sentAt).toBe(first.sentAt);

    attempts.complete(first.commandId);
    expect(
      attempts.acquire(
        view(),
        input,
        () => `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`,
        () => new Date('2026-08-14T10:02:00Z'),
      ).commandId,
    ).not.toBe(first.commandId);
  });

  it('creates a new envelope when the projection version changes', () => {
    const attempts = new RoomCommandAttempts();
    let sequence = 0;
    const createId = () =>
      `10000000-0000-4000-8000-${String(++sequence).padStart(12, '0')}`;
    const input = { type: 'SetReady', payload: { ready: true } } as const;

    const stale = attempts.acquire(view(7), input, createId, () => new Date(0));
    const fresh = attempts.acquire(view(8), input, createId, () => new Date(1));

    expect(fresh.commandId).not.toBe(stale.commandId);
    expect(fresh.expectedStateVersion).toBe(8);
  });
});

describe('submitCommandWithAck', () => {
  const command = {
    commandId: '10000000-0000-4000-8000-000000000010',
    roomId: '10000000-0000-4000-8000-000000000001',
    expectedStateVersion: 7,
    type: 'SetReady',
    payload: { ready: true },
    sentAt: '2026-08-14T10:00:00.000Z',
  } as Command;

  it('retries an ack timeout with the exact same command', async () => {
    const delivered: Command[] = [];
    const result = await submitCommandWithAck(
      (candidate, acknowledge) => {
        delivered.push(candidate);
        if (delivered.length === 2) acknowledge(accepted(candidate.commandId));
      },
      command,
      isCommandResult,
      1,
      2,
    );

    expect(result.accepted).toBe(true);
    expect(delivered).toEqual([command, command]);
  });

  it('surfaces a timeout after the bounded retry', async () => {
    await expect(
      submitCommandWithAck(() => undefined, command, isCommandResult, 1, 2),
    ).rejects.toBeInstanceOf(CommandAckTimeoutError);
  });

  it('rejects malformed acknowledgements without treating them as results', async () => {
    await expect(
      submitCommandWithAck(
        (_candidate, acknowledge) => {
          acknowledge({ accepted: true, leaked: 'not-a-contract-result' });
        },
        command,
        (_payload): _payload is CommandResult => false,
      ),
    ).rejects.toBeInstanceOf(InvalidCommandAckError);
  });
});

describe('shouldResyncAfterRejection', () => {
  const rejected = (
    code: 'STALE_VERSION' | 'INVALID_CONFIG',
  ): CommandResult => ({
    commandId: '10000000-0000-4000-8000-000000000010',
    accepted: false,
    error: { code, diagnosticId: 'diag_test', retryable: false },
  });

  it('resynchronizes state/permission errors but keeps field errors local', () => {
    expect(shouldResyncAfterRejection(rejected('STALE_VERSION'))).toBe(true);
    expect(shouldResyncAfterRejection(rejected('INVALID_CONFIG'))).toBe(false);
  });
});
