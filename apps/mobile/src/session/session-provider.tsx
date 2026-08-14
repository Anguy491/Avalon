import { randomUUID } from 'expo-crypto';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react';
import { AppState } from 'react-native';
import { io, type Socket } from 'socket.io-client';

import {
  isCommandResult,
  isRoomViewMessage,
  isSessionReady,
  type CommandResult,
  type CommandType,
  type CreateRoomRequest,
  type RoomConfigInput,
  type RoomView,
  type SessionBootstrap,
} from '@avalon/protocol/mobile';

import {
  ApiError,
  clientCapabilities,
  createRoom as createRoomRequest,
  joinRoom as joinRoomRequest,
  readCurrentRoomView,
  resumeSession,
} from '@/api/client';
import { isInvalidSession, userFacingError } from '@/api/errors';

import { expoSecureStore } from './expo-secure-store-driver';
import {
  CommandAckTimeoutError,
  InvalidCommandAckError,
  RoomCommandAttempts,
  shouldResyncAfterRejection,
  submitCommandWithAck,
  type RoomCommandInput,
} from './command-submission';
import { IdempotencyKeys } from './idempotency';
import { acceptNewerRoomView } from './room-view-state';
import {
  beginResume,
  clearStoredSession,
  getOrCreateInstallationId,
  loadStoredSession,
  saveBootstrap,
  type StoredSession,
} from './secure-session-store';

const ROOM_VIEW_KEY = ['room-view'] as const;
type SessionStatus =
  | 'LOADING'
  | 'ANONYMOUS'
  | 'RECOVERING'
  | 'CONNECTED'
  | 'OFFLINE';

interface SessionSummary {
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionExpiresAt: string;
}

interface SessionContextValue {
  readonly status: SessionStatus;
  readonly summary?: SessionSummary;
  readonly roomView?: RoomView;
  readonly error?: string;
  readonly pendingCommandType?: CommandType;
  readonly createRoom: (
    nickname: string,
    config: RoomConfigInput,
  ) => Promise<void>;
  readonly joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly refreshView: () => Promise<void>;
  readonly submitCommand: (command: RoomCommandInput) => Promise<CommandResult>;
  readonly forgetSession: () => Promise<void>;
  readonly dismissError: () => void;
}

const SessionContext = createContext<SessionContextValue | undefined>(
  undefined,
);

function summaryFrom(session: StoredSession): SessionSummary {
  return {
    roomCode: session.roomCode,
    playerId: session.playerId,
    sessionExpiresAt: session.sessionExpiresAt,
  };
}

export function SessionProvider({ children }: PropsWithChildren) {
  const queryClient = useQueryClient();
  const sessionToken = useRef<string | undefined>(undefined);
  const sessionRecord = useRef<StoredSession | undefined>(undefined);
  const socket = useRef<Socket | undefined>(undefined);
  const recovery = useRef<Promise<void> | undefined>(undefined);
  const createKeys = useRef(new IdempotencyKeys());
  const joinKeys = useRef(new IdempotencyKeys());
  const commandAttempts = useRef(new RoomCommandAttempts());
  const commandInFlight = useRef(false);
  const installationId = useRef<Promise<string> | undefined>(undefined);
  const [status, setStatus] = useState<SessionStatus>('LOADING');
  const [summary, setSummary] = useState<SessionSummary>();
  const [error, setError] = useState<string>();
  const [pendingCommandType, setPendingCommandType] = useState<CommandType>();

  const roomViewQuery = useQuery<RoomView>({
    queryKey: ROOM_VIEW_KEY,
    queryFn: async () => {
      const token = sessionToken.current;
      if (token === undefined) throw new Error('No active session');
      const incoming = (await readCurrentRoomView(token)).roomView;
      return acceptNewerRoomView(
        queryClient.getQueryData<RoomView>(ROOM_VIEW_KEY),
        incoming,
      );
    },
    enabled: false,
    gcTime: Number.POSITIVE_INFINITY,
  });

  const getInstallationId = useCallback(() => {
    installationId.current ??= getOrCreateInstallationId(
      expoSecureStore,
      randomUUID,
    );
    return installationId.current;
  }, []);

  const stopSocket = useCallback(() => {
    const activeSocket = socket.current;
    socket.current = undefined;
    if (activeSocket === undefined) return;
    activeSocket.removeAllListeners();
    activeSocket.disconnect();
  }, []);

  const acceptRoomView = useCallback(
    (incoming: RoomView) => {
      queryClient.setQueryData<RoomView>(ROOM_VIEW_KEY, (current) =>
        acceptNewerRoomView(current, incoming),
      );
    },
    [queryClient],
  );

  const forgetSession = useCallback(async () => {
    stopSocket();
    sessionRecord.current = undefined;
    sessionToken.current = undefined;
    setSummary(undefined);
    setError(undefined);
    setPendingCommandType(undefined);
    queryClient.removeQueries({ queryKey: ROOM_VIEW_KEY, exact: true });
    await clearStoredSession(expoSecureStore);
    setStatus('ANONYMOUS');
  }, [queryClient, stopSocket]);

  const connectSocket = useCallback(
    (record: StoredSession) => {
      stopSocket();
      const lastStateVersion =
        queryClient.getQueryData<RoomView>(ROOM_VIEW_KEY)?.public
          .stateVersion ?? 0;
      const nextSocket = io(record.realtimeUrl, {
        auth: {
          protocolVersion: 1,
          sessionToken: record.sessionToken,
          lastStateVersion,
        },
        forceNew: true,
        reconnection: true,
        transports: ['websocket'],
      });
      socket.current = nextSocket;
      nextSocket.on('connect', () => {
        setStatus('CONNECTED');
      });
      nextSocket.on('disconnect', () => {
        setStatus('OFFLINE');
      });
      nextSocket.on('connect_error', () => {
        setStatus('OFFLINE');
      });
      nextSocket.on('session.ready', (payload: unknown) => {
        if (!isSessionReady(payload)) return;
        acceptRoomView(payload.roomView);
      });
      nextSocket.on('room.view', (payload: unknown) => {
        if (!isRoomViewMessage(payload)) return;
        acceptRoomView(payload.roomView);
      });
      nextSocket.on('session.revoked', () => {
        void forgetSession().then(() => {
          setError('本机会话已失效，请返回首页重新加入。');
        });
      });
    },
    [acceptRoomView, forgetSession, queryClient, stopSocket],
  );

  const installBootstrap = useCallback(
    async (bootstrap: SessionBootstrap) => {
      const record = await saveBootstrap(expoSecureStore, bootstrap);
      sessionRecord.current = record;
      sessionToken.current = record.sessionToken;
      setSummary(summaryFrom(record));
      setError(undefined);
      acceptRoomView(bootstrap.roomView);
      setStatus('RECOVERING');
      connectSocket(record);
    },
    [acceptRoomView, connectSocket],
  );

  const runRecovery = useCallback(async () => {
    let record =
      sessionRecord.current ?? (await loadStoredSession(expoSecureStore));
    if (record === null) {
      setStatus('ANONYMOUS');
      return;
    }
    sessionRecord.current = record;
    sessionToken.current = record.sessionToken;
    setSummary(summaryFrom(record));
    setStatus('RECOVERING');
    try {
      record = await beginResume(expoSecureStore, record, randomUUID);
      sessionRecord.current = record;
      const resumeId = record.pendingResumeIdempotencyKey;
      if (resumeId === undefined) throw new Error('Missing resume identifier');
      const bootstrap = await resumeSession(
        record.sessionToken,
        resumeId,
        await getInstallationId(),
      );
      await installBootstrap(bootstrap);
    } catch (caught) {
      setError(userFacingError(caught));
      if (isInvalidSession(caught)) {
        await forgetSession();
      } else {
        setStatus('OFFLINE');
      }
    }
  }, [forgetSession, getInstallationId, installBootstrap]);

  const recover = useCallback(() => {
    recovery.current ??= runRecovery().finally(() => {
      recovery.current = undefined;
    });
    return recovery.current;
  }, [runRecovery]);

  useEffect(() => {
    void recover();
    return stopSocket;
  }, [recover, stopSocket]);

  useEffect(() => {
    let previous = AppState.currentState;
    const subscription = AppState.addEventListener('change', (next) => {
      if (previous !== 'active' && next === 'active' && sessionRecord.current) {
        void recover();
      }
      previous = next;
    });
    return () => {
      subscription.remove();
    };
  }, [recover]);

  const createRoom = useCallback(
    async (nickname: string, config: RoomConfigInput) => {
      const request: CreateRoomRequest = {
        nickname,
        config,
        client: clientCapabilities(await getInstallationId()),
      };
      const fingerprint = JSON.stringify(request);
      const idempotencyKey = createKeys.current.acquire(
        fingerprint,
        randomUUID,
      );
      setStatus('RECOVERING');
      setError(undefined);
      try {
        const bootstrap = await createRoomRequest(idempotencyKey, request);
        createKeys.current.complete(fingerprint);
        await installBootstrap(bootstrap);
      } catch (caught) {
        setStatus(sessionRecord.current ? 'OFFLINE' : 'ANONYMOUS');
        setError(userFacingError(caught));
        throw caught;
      }
    },
    [getInstallationId, installBootstrap],
  );

  const joinRoom = useCallback(
    async (nickname: string, roomCode: string) => {
      const request = {
        nickname,
        client: clientCapabilities(await getInstallationId()),
      };
      const fingerprint = JSON.stringify({ roomCode, ...request });
      const idempotencyKey = joinKeys.current.acquire(fingerprint, randomUUID);
      setStatus('RECOVERING');
      setError(undefined);
      try {
        const bootstrap = await joinRoomRequest(
          roomCode,
          idempotencyKey,
          request,
        );
        joinKeys.current.complete(fingerprint);
        await installBootstrap(bootstrap);
      } catch (caught) {
        setStatus(sessionRecord.current ? 'OFFLINE' : 'ANONYMOUS');
        setError(userFacingError(caught));
        throw caught;
      }
    },
    [getInstallationId, installBootstrap],
  );

  const refreshView = useCallback(async () => {
    try {
      const result = await roomViewQuery.refetch();
      if (result.error) throw result.error;
      setError(undefined);
    } catch (caught) {
      setError(userFacingError(caught));
      if (isInvalidSession(caught)) await forgetSession();
    }
  }, [forgetSession, roomViewQuery]);

  const submitCommand = useCallback(
    async (input: RoomCommandInput): Promise<CommandResult> => {
      if (commandInFlight.current) {
        const busyError = new ApiError(
          {
            code: 'RATE_LIMITED',
            diagnosticId: 'client_command_pending',
            retryable: true,
          },
          0,
        );
        setError('上一项操作仍在等待服务器确认。');
        throw busyError;
      }
      const roomView = queryClient.getQueryData<RoomView>(ROOM_VIEW_KEY);
      const activeSocket = socket.current;
      if (roomView === undefined || activeSocket?.connected !== true) {
        const offlineError = new ApiError(
          {
            code: 'INTERNAL_ERROR',
            diagnosticId: 'client_command_offline',
            retryable: true,
          },
          0,
        );
        setError(userFacingError(offlineError));
        throw offlineError;
      }

      const command = commandAttempts.current.acquire(
        roomView,
        input,
        randomUUID,
        () => new Date(),
      );
      commandInFlight.current = true;
      setPendingCommandType(input.type);
      setError(undefined);
      try {
        const result = await submitCommandWithAck(
          (payload, acknowledge) => {
            activeSocket.emit('command.submit', payload, acknowledge);
          },
          command,
          isCommandResult,
        );
        commandAttempts.current.complete(command.commandId);

        if (!result.accepted) {
          const rejection = new ApiError(result.error, 0);
          if (isInvalidSession(rejection)) {
            await forgetSession();
          } else if (shouldResyncAfterRejection(result)) {
            await refreshView();
          }
          setError(userFacingError(rejection));
          throw rejection;
        }

        if (input.type === 'LeaveLobby' || input.type === 'CloseRoom') {
          await forgetSession();
          return result;
        }

        try {
          await refreshView();
        } catch {
          // A committed command still converges through room.view when the
          // opportunistic HTTP resync is unavailable.
        }
        return result;
      } catch (caught) {
        if (caught instanceof ApiError) throw caught;
        if (caught instanceof CommandAckTimeoutError) {
          setError(
            '未收到服务器确认。请检查网络后重试；相同操作会沿用原命令编号。',
          );
        } else if (caught instanceof InvalidCommandAckError) {
          await refreshView();
          setError('服务器确认格式异常，请刷新大厅后重试。');
        } else {
          setError(userFacingError(caught));
        }
        throw caught;
      } finally {
        commandInFlight.current = false;
        setPendingCommandType(undefined);
      }
    },
    [forgetSession, queryClient, refreshView],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      ...(summary === undefined ? {} : { summary }),
      ...(roomViewQuery.data === undefined
        ? {}
        : { roomView: roomViewQuery.data }),
      ...(error === undefined ? {} : { error }),
      ...(pendingCommandType === undefined ? {} : { pendingCommandType }),
      createRoom,
      joinRoom,
      recover,
      refreshView,
      submitCommand,
      forgetSession,
      dismissError: () => {
        setError(undefined);
      },
    }),
    [
      createRoom,
      error,
      forgetSession,
      joinRoom,
      pendingCommandType,
      recover,
      refreshView,
      roomViewQuery.data,
      status,
      submitCommand,
      summary,
    ],
  );

  return (
    <SessionContext.Provider value={value}>{children}</SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (context === undefined) {
    throw new Error('useSession must be used within SessionProvider');
  }
  return context;
}
