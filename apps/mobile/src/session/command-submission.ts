import type {
  Command,
  CommandResult,
  RoomConfigInput,
  RoomView,
} from '@avalon/protocol/mobile';

export type LobbyCommandInput =
  | {
      readonly type: 'ConfigureRoom';
      readonly payload: { readonly config: RoomConfigInput };
    }
  | {
      readonly type: 'ReorderSeats';
      readonly payload: { readonly playerIds: readonly string[] };
    }
  | {
      readonly type: 'SetReady';
      readonly payload: { readonly ready: boolean };
    }
  | { readonly type: 'LeaveLobby'; readonly payload: Record<string, never> }
  | {
      readonly type: 'KickLobbyPlayer';
      readonly payload: { readonly targetPlayerId: string };
    }
  | { readonly type: 'CloseRoom'; readonly payload: Record<string, never> };

export type RoomCommandInput =
  | LobbyCommandInput
  | { readonly type: 'StartGame'; readonly payload: Record<string, never> }
  | {
      readonly type: 'ContinuePhase';
      readonly payload: Record<string, never>;
    }
  | { readonly type: 'AckRole'; readonly payload: Record<string, never> }
  | {
      readonly type: 'SubmitTeam';
      readonly payload: { readonly teamPlayerIds: readonly string[] };
    }
  | {
      readonly type: 'SubmitTeamVote';
      readonly payload: { readonly vote: 'APPROVE' | 'REJECT' };
    }
  | {
      readonly type: 'SubmitQuestChoice';
      readonly payload: { readonly choice: 'SUCCESS' | 'FAIL' };
    };

interface PendingCommand {
  readonly fingerprint: string;
  readonly command: Command;
}

export class RoomCommandAttempts {
  private pending: PendingCommand | undefined;

  acquire(
    roomView: RoomView,
    input: RoomCommandInput,
    createId: () => string,
    now: () => Date,
  ): Command {
    const fingerprint = JSON.stringify({
      roomId: roomView.public.roomId,
      expectedStateVersion: roomView.public.stateVersion,
      input,
    });
    if (this.pending?.fingerprint === fingerprint) {
      return this.pending.command;
    }
    const command = {
      commandId: createId(),
      roomId: roomView.public.roomId,
      expectedStateVersion: roomView.public.stateVersion,
      sentAt: now().toISOString(),
      ...input,
    } as Command;
    this.pending = { fingerprint, command };
    return command;
  }

  complete(commandId: string): void {
    if (this.pending?.command.commandId === commandId) {
      this.pending = undefined;
    }
  }
}

export class CommandAckTimeoutError extends Error {
  constructor() {
    super('Command acknowledgement timed out');
    this.name = 'CommandAckTimeoutError';
  }
}

export class InvalidCommandAckError extends Error {
  constructor() {
    super('Command acknowledgement failed protocol validation');
    this.name = 'InvalidCommandAckError';
  }
}

export type CommandEmitter = (
  command: Command,
  acknowledge: (payload: unknown) => void,
) => void;

async function submitOnce(
  emit: CommandEmitter,
  command: Command,
  validate: (payload: unknown) => payload is CommandResult,
  timeoutMs: number,
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      reject(new CommandAckTimeoutError());
    }, timeoutMs);
    emit(command, (payload) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (!validate(payload)) {
        reject(new InvalidCommandAckError());
        return;
      }
      resolve(payload);
    });
  });
}

export async function submitCommandWithAck(
  emit: CommandEmitter,
  command: Command,
  validate: (payload: unknown) => payload is CommandResult,
  timeoutMs = 4_000,
  attempts = 2,
): Promise<CommandResult> {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await submitOnce(emit, command, validate, timeoutMs);
    } catch (error) {
      if (
        !(error instanceof CommandAckTimeoutError) ||
        attempt + 1 >= attempts
      ) {
        throw error;
      }
    }
  }
  throw new CommandAckTimeoutError();
}

const RESYNC_REJECTION_CODES = new Set([
  'NOT_HOST',
  'NOT_LEADER',
  'INVALID_PHASE',
  'INVALID_PHASE_STAGE',
  'PHASE_HELD',
  'STALE_VERSION',
  'ALREADY_SUBMITTED',
  'PLAYER_NOT_ON_TEAM',
  'GOOD_CANNOT_FAIL',
]);

export function shouldResyncAfterRejection(result: CommandResult): boolean {
  return !result.accepted && RESYNC_REJECTION_CODES.has(result.error.code);
}
