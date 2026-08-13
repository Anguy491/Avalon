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
  isRoomViewMessage,
  isSessionReady,
  type CreateRoomRequest,
  type RoomConfigInput,
  type RoomView,
  type SessionBootstrap,
} from '@avalon/protocol/mobile';

import {
  clientCapabilities,
  createRoom as createRoomRequest,
  joinRoom as joinRoomRequest,
  readCurrentRoomView,
  resumeSession,
} from '@/api/client';
import { isInvalidSession, userFacingError } from '@/api/errors';

import { expoSecureStore } from './expo-secure-store-driver';
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
  readonly createRoom: (
    nickname: string,
    config: RoomConfigInput,
  ) => Promise<void>;
  readonly joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly refreshView: () => Promise<void>;
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
  const installationId = useRef<Promise<string> | undefined>(undefined);
  const [status, setStatus] = useState<SessionStatus>('LOADING');
  const [summary, setSummary] = useState<SessionSummary>();
  const [error, setError] = useState<string>();

  const roomViewQuery = useQuery<RoomView>({
    queryKey: ROOM_VIEW_KEY,
    queryFn: async () => {
      const token = sessionToken.current;
      if (token === undefined) throw new Error('No active session');
      return (await readCurrentRoomView(token)).roomView;
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
    },
    [acceptRoomView, queryClient, stopSocket],
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

  const forgetSession = useCallback(async () => {
    stopSocket();
    sessionRecord.current = undefined;
    sessionToken.current = undefined;
    setSummary(undefined);
    setError(undefined);
    queryClient.removeQueries({ queryKey: ROOM_VIEW_KEY, exact: true });
    await clearStoredSession(expoSecureStore);
    setStatus('ANONYMOUS');
  }, [queryClient, stopSocket]);

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

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      ...(summary === undefined ? {} : { summary }),
      ...(roomViewQuery.data === undefined
        ? {}
        : { roomView: roomViewQuery.data }),
      ...(error === undefined ? {} : { error }),
      createRoom,
      joinRoom,
      recover,
      refreshView,
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
      recover,
      refreshView,
      roomViewQuery.data,
      status,
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
