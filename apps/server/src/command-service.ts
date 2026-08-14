import type postgres from 'postgres';

import {
  executeCommand,
  type DomainEffect,
  type EnginePorts,
  type GameCommand,
  type GameState,
} from '@avalon/game-engine';
import {
  CommandResultSchema,
  createProtocolValidator,
  type Command,
  type CommandResult,
  type ErrorCode,
  type RoomConfigInput,
} from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import type { RuntimePorts } from './runtime-ports.js';
import { decryptJson, encryptJson, sha256Digest } from './security.js';
import type { SessionContext } from './session-context.js';
import { stateFrom, toEngineConfig } from './room-service.js';

const SCHEMA = 'avalon_runtime';
const SCOPE = 'SOCKET command.submit';
const validateCommandResult =
  createProtocolValidator().compile(CommandResultSchema);

interface ProcessedRow {
  readonly request_digest: string;
  readonly response_ciphertext: Uint8Array;
  readonly response_iv: Uint8Array;
  readonly response_tag: Uint8Array;
}

interface RoomRow {
  readonly aggregate: unknown;
  readonly recovery_started_at: Date | null;
  readonly recovery_expires_at: Date | null;
}

const RECOVERY_WINDOW_MS = 30 * 60 * 1_000;

function withRecoveryWindow(
  state: GameState,
  now: Date,
  persisted: Pick<RoomRow, 'recovery_started_at' | 'recovery_expires_at'>,
): GameState {
  if (state.phase !== 'PAUSED') {
    return {
      ...state,
      recoveryStartedAt: undefined,
      recoveryExpiresAt: undefined,
    };
  }
  if (
    (state.recoveryStartedAt !== undefined ||
      persisted.recovery_started_at !== null) &&
    (state.recoveryExpiresAt !== undefined ||
      persisted.recovery_expires_at !== null)
  ) {
    return {
      ...state,
      recoveryStartedAt:
        state.recoveryStartedAt ?? persisted.recovery_started_at?.toISOString(),
      recoveryExpiresAt:
        state.recoveryExpiresAt ?? persisted.recovery_expires_at?.toISOString(),
    };
  }
  return {
    ...state,
    recoveryStartedAt: now.toISOString(),
    recoveryExpiresAt: new Date(
      now.getTime() + RECOVERY_WINDOW_MS,
    ).toISOString(),
  };
}

function liveAudioCueId(effects: readonly DomainEffect[]): string | null {
  return (
    effects.find((effect) => effect.type === 'AUDIO_CUE_REQUESTED')?.cue
      .audioCueId ?? null
  );
}

function enginePorts(ports: RuntimePorts): EnginePorts {
  return {
    random: ports.random,
    clock: { nowIso: () => ports.clock.now().toISOString() },
    ids: { nextId: () => ports.ids.next() },
  };
}

function diagnosticId(ports: RuntimePorts): string {
  return `diag_${ports.ids.next()}`;
}

function rejected(
  commandId: string,
  code: ErrorCode,
  currentStateVersion: number | undefined,
  ports: RuntimePorts,
): CommandResult {
  return {
    commandId,
    accepted: false,
    error: {
      code,
      diagnosticId: diagnosticId(ports),
      retryable: false,
      ...(currentStateVersion === undefined ? {} : { currentStateVersion }),
    },
  };
}

function toEngineCommand(
  command: Command,
  context: SessionContext,
  requestDigest: string,
): GameCommand {
  const envelope = {
    commandId: command.commandId,
    requestDigest,
    expectedStateVersion: command.expectedStateVersion,
    actorPlayerId: context.playerId,
  };
  switch (command.type) {
    case 'StartGame':
    case 'ContinuePhase':
    case 'AckRole':
    case 'ResumeGame':
      return { ...envelope, type: command.type };
    case 'SubmitTeam': {
      const payload = command.payload as { readonly teamPlayerIds: string[] };
      return {
        ...envelope,
        type: command.type,
        teamPlayerIds: payload.teamPlayerIds,
      };
    }
    case 'SubmitTeamVote':
      return {
        ...envelope,
        type: command.type,
        vote: (command.payload as { readonly vote: 'APPROVE' | 'REJECT' }).vote,
      };
    case 'SubmitQuestChoice':
      return {
        ...envelope,
        type: command.type,
        choice: (command.payload as { readonly choice: 'SUCCESS' | 'FAIL' })
          .choice,
      };
    case 'SelectMerlinTarget':
      return {
        ...envelope,
        type: command.type,
        targetPlayerId: (command.payload as { readonly targetPlayerId: string })
          .targetPlayerId,
      };
    case 'PauseGame':
      return {
        ...envelope,
        type: command.type,
        reason: (command.payload as { readonly reason?: string }).reason,
      };
    case 'ReplayAudioCue':
      return {
        ...envelope,
        type: command.type,
        audioCueId: (command.payload as { readonly audioCueId: string })
          .audioCueId,
      };
    case 'ConfigureRoom': {
      const payload = command.payload as { readonly config: RoomConfigInput };
      return {
        ...envelope,
        type: command.type,
        configInput: toEngineConfig(payload.config),
      };
    }
    case 'ReorderSeats':
      return {
        ...envelope,
        type: command.type,
        playerIds: (
          command.payload as { readonly playerIds: readonly string[] }
        ).playerIds,
      };
    case 'SetReady':
      return {
        ...envelope,
        type: command.type,
        ready: (command.payload as { readonly ready: boolean }).ready,
      };
    case 'LeaveLobby':
      return { ...envelope, type: command.type };
    case 'KickLobbyPlayer':
      return {
        ...envelope,
        type: command.type,
        targetPlayerId: (command.payload as { readonly targetPlayerId: string })
          .targetPlayerId,
      };
    case 'CloseRoom':
      return { ...envelope, type: command.type };
    default:
      throw new RangeError(`Unhandled command type: ${command.type}`);
  }
}

export class CommandService {
  constructor(
    private readonly sql: postgres.Sql,
    private readonly config: ServerConfig,
    private readonly ports: RuntimePorts,
    private readonly beforeCommit?: () => void,
  ) {}

  async submit(
    context: SessionContext,
    command: Command,
  ): Promise<CommandResult> {
    if (command.roomId !== context.roomId) {
      return rejected(command.commandId, 'UNAUTHORIZED', undefined, this.ports);
    }
    const requestHash = sha256Digest(command);
    return this.sql.begin(async (sql) => {
      const validSession = await sql<{ readonly session_id: string }[]>`
        select session_id from ${sql(SCHEMA)}.sessions
         where session_id = ${context.sessionId}
           and token_digest = ${context.tokenDigest}
           and revoked_at is null
           and expires_at > ${this.ports.clock.now()}
         for update
      `;
      if (validSession.length === 0) {
        return rejected(
          command.commandId,
          'SESSION_INVALID',
          undefined,
          this.ports,
        );
      }

      const [processed] = await sql<ProcessedRow[]>`
        select request_digest, response_ciphertext, response_iv, response_tag
          from ${sql(SCHEMA)}.processed_commands
         where scope = ${SCOPE} and command_id = ${command.commandId}
      `;
      if (processed !== undefined) {
        if (processed.request_digest !== requestHash) {
          return rejected(
            command.commandId,
            'DUPLICATE_COMMAND_CONFLICT',
            undefined,
            this.ports,
          );
        }
        const decrypted = decryptJson(
          {
            ciphertext: processed.response_ciphertext,
            iv: processed.response_iv,
            tag: processed.response_tag,
          },
          this.config.idempotencyEncryptionSecret,
        );
        if (!validateCommandResult(decrypted)) {
          throw new Error('Invalid encrypted command response');
        }
        return decrypted as CommandResult;
      }

      const [room] = await sql<RoomRow[]>`
        select aggregate, recovery_started_at, recovery_expires_at
          from ${sql(SCHEMA)}.rooms
         where room_id = ${context.roomId}
         for update
      `;
      if (room === undefined) {
        return rejected(
          command.commandId,
          'ROOM_EXPIRED',
          undefined,
          this.ports,
        );
      }
      const state = stateFrom(room.aggregate);
      const engineCommand = toEngineCommand(command, context, requestHash);
      const transition = executeCommand(
        state,
        engineCommand,
        enginePorts(this.ports),
      );
      if (!transition.result.accepted) {
        return rejected(
          command.commandId,
          transition.result.errorCode,
          transition.result.currentStateVersion,
          this.ports,
        );
      }

      const now = this.ports.clock.now();
      const windowed = withRecoveryWindow(transition.state, now, room);
      const recoveryStartedAt =
        windowed.phase === 'PAUSED' ? (room.recovery_started_at ?? now) : null;
      const recoveryExpiresAt =
        recoveryStartedAt === null
          ? null
          : (room.recovery_expires_at ??
            new Date(recoveryStartedAt.getTime() + RECOVERY_WINDOW_MS));
      const storedState: GameState = {
        ...windowed,
        recoveryStartedAt: recoveryStartedAt?.toISOString(),
        recoveryExpiresAt: recoveryExpiresAt?.toISOString(),
        processedCommands: {},
      };
      const response: CommandResult = {
        commandId: command.commandId,
        accepted: true,
        stateVersion: transition.result.stateVersion,
      };

      const closesRoom = transition.effects.some(
        (effect) => effect.type === 'ROOM_CLOSE_REQUESTED',
      );
      if (closesRoom) {
        // Deleting the room cascades to players, sessions, processed_commands,
        // and outbox rows (see migration 000002 onDelete: 'CASCADE'). There is
        // nothing left to persist for idempotency: any retried command against
        // this room will fail SESSION_INVALID once the actor's own session row
        // is gone, which is a safe terminal response.
        await sql`
          delete from ${sql(SCHEMA)}.rooms where room_id = ${context.roomId}
        `;
        this.beforeCommit?.();
        return response;
      }

      const encrypted = encryptJson(
        response,
        this.config.idempotencyEncryptionSecret,
        this.ports.random,
      );
      if (recoveryStartedAt === null || recoveryExpiresAt === null) {
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${storedState.stateVersion},
                 phase = ${storedState.phase},
                 aggregate = ${sql.json(storedState as unknown as postgres.JSONValue)},
                 recovery_started_at = null, recovery_expires_at = null,
                 last_active_at = ${now}
           where room_id = ${context.roomId}
        `;
      } else {
        await sql`
          update ${sql(SCHEMA)}.rooms
             set state_version = ${storedState.stateVersion},
                 phase = ${storedState.phase},
                 aggregate = ${sql.json(storedState as unknown as postgres.JSONValue)},
                 recovery_started_at = coalesce(recovery_started_at, ${now}),
                 recovery_expires_at = coalesce(recovery_expires_at, ${recoveryExpiresAt}),
                 last_active_at = ${now}
           where room_id = ${context.roomId}
        `;
      }
      await sql`
        insert into ${sql(SCHEMA)}.processed_commands
          (scope, command_id, room_id, token_family, auth_token_digest,
           request_digest, response_status, response_ciphertext, response_iv,
           response_tag, state_version, created_at)
        values
          (${SCOPE}, ${command.commandId}, ${context.roomId},
           ${context.tokenFamily}, ${context.tokenDigest}, ${requestHash}, 200,
           ${Buffer.from(encrypted.ciphertext)}, ${Buffer.from(encrypted.iv)},
           ${Buffer.from(encrypted.tag)}, ${storedState.stateVersion}, ${now})
      `;
      await sql`
        insert into ${sql(SCHEMA)}.outbox
          (outbox_id, event_id, room_id, state_version, event_type,
           live_audio_cue_id,
           created_at, available_at)
        values
          (${this.ports.ids.next()}, ${this.ports.ids.next()}, ${context.roomId},
           ${storedState.stateVersion}, 'ROOM_VIEW_CHANGED',
           ${liveAudioCueId(transition.effects)}, ${now}, ${now})
        on conflict (room_id, state_version, event_type) do nothing
      `;
      await this.revokeSessionEffects(
        sql,
        context.roomId,
        transition.effects,
        now,
      );
      this.beforeCommit?.();
      return response;
    });
  }

  /**
   * Consumes SESSION_REVOKE_REQUESTED domain effects (LeaveLobby,
   * KickLobbyPlayer). This never deletes rows: it marks sessions revoked so
   * the outbox worker and command-service authentication paths stop treating
   * them as live, while preserving processed_commands/foreign-key integrity.
   */
  private async revokeSessionEffects(
    sql: postgres.TransactionSql,
    roomId: string,
    effects: readonly DomainEffect[],
    now: Date,
  ): Promise<void> {
    for (const effect of effects) {
      if (effect.type !== 'SESSION_REVOKE_REQUESTED') continue;
      await sql`
        update ${sql(SCHEMA)}.sessions
           set revoked_at = ${now}
         where room_id = ${roomId}
           and player_id = ${effect.playerId}
           and revoked_at is null
      `;
    }
  }
}
