import type postgres from 'postgres';

import {
  executeCommand,
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
} from '@avalon/protocol';

import type { ServerConfig } from './config.js';
import type { RuntimePorts } from './runtime-ports.js';
import { decryptJson, encryptJson, sha256Digest } from './security.js';
import type { SessionContext } from './session-context.js';
import { stateFrom } from './room-service.js';

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
): GameCommand | undefined {
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
      return { ...envelope, type: command.type };
    case 'ReplayAudioCue':
      return {
        ...envelope,
        type: command.type,
        audioCueId: (command.payload as { readonly audioCueId: string })
          .audioCueId,
      };
    case 'ConfigureRoom':
    case 'ReorderSeats':
    case 'SetReady':
    case 'LeaveLobby':
    case 'KickLobbyPlayer':
    case 'CloseRoom':
      return undefined;
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
        select aggregate from ${sql(SCHEMA)}.rooms
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
      if (engineCommand === undefined) {
        return rejected(
          command.commandId,
          'INVALID_PHASE',
          state.stateVersion,
          this.ports,
        );
      }
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

      const storedState: GameState = {
        ...transition.state,
        processedCommands: {},
      };
      const now = this.ports.clock.now();
      const response: CommandResult = {
        commandId: command.commandId,
        accepted: true,
        stateVersion: transition.result.stateVersion,
      };
      const encrypted = encryptJson(
        response,
        this.config.idempotencyEncryptionSecret,
        this.ports.random,
      );
      await sql`
        update ${sql(SCHEMA)}.rooms
           set state_version = ${storedState.stateVersion},
               phase = ${storedState.phase},
               aggregate = ${sql.json(storedState as unknown as postgres.JSONValue)},
               last_active_at = ${now}
         where room_id = ${context.roomId}
      `;
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
           created_at, available_at)
        values
          (${this.ports.ids.next()}, ${this.ports.ids.next()}, ${context.roomId},
           ${storedState.stateVersion}, 'ROOM_VIEW_CHANGED', ${now}, ${now})
        on conflict (room_id, state_version, event_type) do nothing
      `;
      this.beforeCommit?.();
      return response;
    });
  }
}
