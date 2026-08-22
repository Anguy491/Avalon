import Taro, { useDidHide, useDidShow } from '@tarojs/taro';
import { View, Text, Button } from '@tarojs/components';
import { io, type Socket } from 'socket.io-client';
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

import {
  CommandAckTimeoutError,
  IdempotencyKeys,
  InvalidCommandAckError,
  RoomCommandAttempts,
  acceptNewerRoomView,
  beginResume,
  clearStoredSession,
  getOrCreateInstallationId,
  loadStoredSession,
  routeForRoomView,
  saveBootstrap,
  shouldResyncAfterRejection,
  submitCommandWithAck,
  updateSessionExpiry,
  type RoomCommandInput,
  type StoredSession,
} from '@avalon/client-core';
import {
  isCommandResult,
  isRoomViewMessage,
  isServerMaintenance,
  isSessionPong,
  isSessionReady,
  isSessionRevoked,
  isTerminalViewAckResult,
  type CommandResult,
  type CommandType,
  type RoomConfigInput,
  type RoomView,
  type RoomViewMessage,
  type SessionBootstrap,
} from '@avalon/protocol/mobile';

import {
  ApiError,
  clearWechatIdentity,
  clientCapabilities,
  createRoom as createRoomRequest,
  isInvalidSession,
  joinRoom as joinRoomRequest,
  getWechatIdentityToken,
  readCurrentRoomView,
  resumeSession,
  userFacingError,
} from '@/api/client';
import { WeChatWebSocketTransport } from '@/realtime/wechat-websocket-transport';
import { secureUuid } from '@/runtime/uuid';

import { WECHAT_APP_VERSION } from '../runtime/public-config';
import { wechatSessionStore } from './storage';

export type SessionStatus =
  | 'LOADING'
  | 'ANONYMOUS'
  | 'RECOVERING'
  | 'CONNECTED'
  | 'OFFLINE'
  | 'TERMINAL';

interface SessionSummary {
  readonly roomCode: string;
  readonly playerId: string;
  readonly sessionExpiresAt: string;
}

interface SessionContextValue {
  readonly status: SessionStatus;
  readonly summary?: SessionSummary;
  readonly roomView?: RoomView;
  readonly lastProjection?: RoomViewMessage;
  readonly networkReachable: boolean;
  readonly privacyHidden: boolean;
  readonly error?: string;
  readonly pendingCommandType?: CommandType;
  readonly createRoom: (
    nickname: string,
    config: RoomConfigInput,
  ) => Promise<void>;
  readonly joinRoom: (nickname: string, roomCode: string) => Promise<void>;
  readonly recover: () => Promise<void>;
  readonly refreshView: () => Promise<void>;
  readonly submitCommand: (input: RoomCommandInput) => Promise<CommandResult>;
  readonly forgetSession: () => Promise<void>;
  readonly dismissError: () => void;
  readonly revealPrivateUi: () => void;
  readonly reportAudioTelemetry: (
    category:
      | 'ASSET_MISSING'
      | 'HASH_MISMATCH'
      | 'LOAD_FAILED'
      | 'PLAYBACK_INTERRUPTED',
  ) => void;
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

function currentRoute(): string | undefined {
  return Taro.getCurrentPages().at(-1)?.route;
}

async function navigateForView(view: RoomView): Promise<void> {
  const target = routeForRoomView(view);
  if (`/${currentRoute() ?? ''}` === target) return;
  await Taro.reLaunch({ url: target });
}

export function SessionProvider({ children }: PropsWithChildren) {
  const tokenRef = useRef<string>();
  const recordRef = useRef<StoredSession>();
  const socketRef = useRef<Socket>();
  const heartbeatRef = useRef<ReturnType<typeof setInterval>>();
  const recoveryRef = useRef<Promise<void>>();
  const roomViewRef = useRef<RoomView>();
  const terminalAckVersionRef = useRef<number>();
  const commandInFlightRef = useRef(false);
  const createKeysRef = useRef(new IdempotencyKeys());
  const joinKeysRef = useRef(new IdempotencyKeys());
  const commandAttemptsRef = useRef(new RoomCommandAttempts());
  const installationIdRef = useRef<Promise<string>>();
  const [status, setStatus] = useState<SessionStatus>('LOADING');
  const [summary, setSummary] = useState<SessionSummary>();
  const [roomView, setRoomView] = useState<RoomView>();
  const [lastProjection, setLastProjection] = useState<RoomViewMessage>();
  const [networkReachable, setNetworkReachable] = useState(true);
  const [privacyHidden, setPrivacyHidden] = useState(false);
  const [error, setError] = useState<string>();
  const [pendingCommandType, setPendingCommandType] = useState<CommandType>();

  const getInstallationId = useCallback(async () => {
    if (installationIdRef.current === undefined) {
      installationIdRef.current = secureUuid().then((id) =>
        getOrCreateInstallationId(wechatSessionStore, () => id),
      );
    }
    return installationIdRef.current;
  }, []);

  const acceptView = useCallback((incoming: RoomView) => {
    const accepted = acceptNewerRoomView(roomViewRef.current, incoming);
    roomViewRef.current = accepted;
    setRoomView(accepted);
    void navigateForView(accepted);
  }, []);

  const stopSocket = useCallback(() => {
    if (heartbeatRef.current !== undefined) clearInterval(heartbeatRef.current);
    heartbeatRef.current = undefined;
    const active = socketRef.current;
    socketRef.current = undefined;
    if (active === undefined) return;
    active.removeAllListeners();
    active.disconnect();
  }, []);

  const clearRuntimeSession = useCallback(() => {
    stopSocket();
    clearWechatIdentity();
    tokenRef.current = undefined;
    recordRef.current = undefined;
    commandAttemptsRef.current = new RoomCommandAttempts();
    terminalAckVersionRef.current = undefined;
    setSummary(undefined);
    setPendingCommandType(undefined);
    setLastProjection(undefined);
  }, [stopSocket]);

  const forgetSession = useCallback(async () => {
    clearRuntimeSession();
    roomViewRef.current = undefined;
    setRoomView(undefined);
    setPrivacyHidden(false);
    setError(undefined);
    await clearStoredSession(wechatSessionStore);
    setStatus('ANONYMOUS');
  }, [clearRuntimeSession]);

  const retireTerminalSession = useCallback(async () => {
    clearRuntimeSession();
    await clearStoredSession(wechatSessionStore);
    setStatus('TERMINAL');
  }, [clearRuntimeSession]);

  const connectSocket = useCallback(
    (record: StoredSession) => {
      stopSocket();
      let identityReconnectAttempted = false;
      const next = io(record.realtimeUrl, {
        auth: (provideAuth) => {
          void getWechatIdentityToken()
            .then((wechatIdentityToken) => {
              provideAuth({
                protocolVersion: 2,
                sessionToken: record.sessionToken,
                wechatIdentityToken,
                lastStateVersion: roomViewRef.current?.public.stateVersion ?? 0,
              });
            })
            .catch((caught: unknown) => {
              setError(userFacingError(caught));
              provideAuth({
                protocolVersion: 2,
                sessionToken: record.sessionToken,
                lastStateVersion: roomViewRef.current?.public.stateVersion ?? 0,
              });
            });
        },
        forceNew: true,
        reconnection: true,
        reconnectionAttempts: 6,
        reconnectionDelay: 500,
        reconnectionDelayMax: 5_000,
        randomizationFactor: 0.4,
        transports: [WeChatWebSocketTransport],
      });
      socketRef.current = next;
      next.on('connect', () => {
        identityReconnectAttempted = false;
        setStatus('RECOVERING');
        const ping = () => {
          if (!next.connected) return;
          next.emit(
            'session.ping',
            { protocolVersion: 2 },
            (payload: unknown) => {
              if (!isSessionPong(payload) || recordRef.current === undefined)
                return;
              void updateSessionExpiry(
                wechatSessionStore,
                recordRef.current,
                payload.sessionExpiresAt,
              ).then((updated) => {
                recordRef.current = updated;
                setSummary(summaryFrom(updated));
              });
            },
          );
        };
        ping();
        if (heartbeatRef.current !== undefined)
          clearInterval(heartbeatRef.current);
        heartbeatRef.current = setInterval(ping, 2_000);
      });
      next.on('disconnect', () => {
        setStatus('OFFLINE');
      });
      next.on('connect_error', (caught: Error) => {
        if (
          caught.message === 'WECHAT_AUTH_INVALID' &&
          !identityReconnectAttempted
        ) {
          identityReconnectAttempted = true;
          clearWechatIdentity();
          next.connect();
          return;
        }
        setStatus('OFFLINE');
      });
      next.on('session.ready', (payload: unknown) => {
        if (!isSessionReady(payload)) return;
        acceptView(payload.roomView);
        setStatus('CONNECTED');
      });
      next.on('room.view', (payload: unknown) => {
        if (!isRoomViewMessage(payload)) return;
        setLastProjection(payload);
        acceptView(payload.roomView);
      });
      next.on('session.revoked', (payload: unknown) => {
        if (!isSessionRevoked(payload)) return;
        void forgetSession().then(() => {
          setError('本机会话已失效，请返回首页重新加入。');
          void Taro.reLaunch({ url: '/pages/index/index' });
        });
      });
      next.on('server.maintenance', (payload: unknown) => {
        if (!isServerMaintenance(payload)) return;
        setStatus('OFFLINE');
        setError(`服务器维护中，请稍后重试。诊断码：${payload.diagnosticId}`);
      });
    },
    [acceptView, forgetSession, stopSocket],
  );

  const installBootstrap = useCallback(
    async (bootstrap: SessionBootstrap) => {
      const record = await saveBootstrap(wechatSessionStore, bootstrap);
      recordRef.current = record;
      tokenRef.current = record.sessionToken;
      setSummary(summaryFrom(record));
      setError(undefined);
      acceptView(bootstrap.roomView);
      setStatus('RECOVERING');
      connectSocket(record);
    },
    [acceptView, connectSocket],
  );

  const runRecovery = useCallback(async () => {
    let record =
      recordRef.current ?? (await loadStoredSession(wechatSessionStore));
    if (record === null) {
      setStatus('ANONYMOUS');
      return;
    }
    recordRef.current = record;
    tokenRef.current = record.sessionToken;
    setPrivacyHidden(true);
    setSummary(summaryFrom(record));
    setStatus('RECOVERING');
    stopSocket();
    try {
      const resumeId = await secureUuid();
      record = await beginResume(wechatSessionStore, record, () => resumeId);
      recordRef.current = record;
      if (record.pendingResumeIdempotencyKey === undefined) {
        throw new Error('Missing resume idempotency key');
      }
      const bootstrap = await resumeSession(
        record.sessionToken,
        record.pendingResumeIdempotencyKey,
        await getInstallationId(),
      );
      await installBootstrap(bootstrap);
    } catch (caught) {
      setError(userFacingError(caught));
      if (isInvalidSession(caught)) await forgetSession();
      else setStatus('OFFLINE');
    }
  }, [forgetSession, getInstallationId, installBootstrap, stopSocket]);

  const recover = useCallback(() => {
    recoveryRef.current ??= runRecovery().finally(() => {
      recoveryRef.current = undefined;
    });
    return recoveryRef.current;
  }, [runRecovery]);

  useEffect(() => {
    void recover();
    const handleNetwork = ({
      isConnected,
    }: Taro.onNetworkStatusChange.CallbackResult) => {
      setNetworkReachable(isConnected);
      if (!isConnected && recordRef.current !== undefined) setStatus('OFFLINE');
      if (
        isConnected &&
        recordRef.current !== undefined &&
        socketRef.current?.connected !== true
      ) {
        socketRef.current?.connect();
      }
    };
    Taro.onNetworkStatusChange(handleNetwork);
    return () => {
      Taro.offNetworkStatusChange(handleNetwork);
      stopSocket();
    };
  }, [recover, stopSocket]);

  useDidHide(() => {
    setPrivacyHidden(true);
    clearWechatIdentity();
    stopSocket();
  });

  useDidShow(() => {
    if (recordRef.current !== undefined) {
      setPrivacyHidden(true);
      void recover();
    }
  });

  useEffect(() => {
    if (
      roomView?.public.phase !== 'GAME_OVER' ||
      terminalAckVersionRef.current === roomView.public.stateVersion ||
      socketRef.current?.connected !== true
    ) {
      return;
    }
    terminalAckVersionRef.current = roomView.public.stateVersion;
    socketRef.current
      .timeout(4_000)
      .emit(
        'room.terminalAck',
        { stateVersion: roomView.public.stateVersion },
        (ackError: Error | null, payload: unknown) => {
          if (
            ackError !== null ||
            !isTerminalViewAckResult(payload) ||
            !payload.accepted
          ) {
            setError('终局回执未确认；服务器仍会在 60 秒内自动清理房间。');
          }
          if (roomView.public.gameOutcome?.reason === 'ABORTED') {
            void forgetSession().then(() =>
              Taro.reLaunch({ url: '/pages/index/index' }),
            );
          } else {
            void retireTerminalSession();
          }
        },
      );
  }, [forgetSession, retireTerminalSession, roomView]);

  const createRoom = useCallback(
    async (nickname: string, config: RoomConfigInput) => {
      const request = {
        nickname,
        config,
        client: clientCapabilities(await getInstallationId()),
      };
      const fingerprint = JSON.stringify(request);
      const freshId = await secureUuid();
      const idempotencyKey = createKeysRef.current.acquire(
        fingerprint,
        () => freshId,
      );
      setStatus('RECOVERING');
      setError(undefined);
      try {
        const bootstrap = await createRoomRequest(idempotencyKey, request);
        createKeysRef.current.complete(fingerprint);
        await installBootstrap(bootstrap);
      } catch (caught) {
        setStatus('ANONYMOUS');
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
      const freshId = await secureUuid();
      const idempotencyKey = joinKeysRef.current.acquire(
        fingerprint,
        () => freshId,
      );
      setStatus('RECOVERING');
      setError(undefined);
      try {
        const bootstrap = await joinRoomRequest(
          roomCode,
          idempotencyKey,
          request,
        );
        joinKeysRef.current.complete(fingerprint);
        await installBootstrap(bootstrap);
      } catch (caught) {
        setStatus('ANONYMOUS');
        setError(userFacingError(caught));
        throw caught;
      }
    },
    [getInstallationId, installBootstrap],
  );

  const refreshView = useCallback(async () => {
    const token = tokenRef.current;
    if (token === undefined) return;
    try {
      acceptView((await readCurrentRoomView(token)).roomView);
      setError(undefined);
    } catch (caught) {
      setError(userFacingError(caught));
      if (isInvalidSession(caught)) await forgetSession();
    }
  }, [acceptView, forgetSession]);

  const submitCommand = useCallback(
    async (input: RoomCommandInput): Promise<CommandResult> => {
      const active = socketRef.current;
      const current = roomViewRef.current;
      if (
        commandInFlightRef.current ||
        active?.connected !== true ||
        current === undefined
      ) {
        const busy = new ApiError(
          {
            code: 'RATE_LIMITED',
            diagnosticId: 'client_command_unavailable',
            retryable: true,
          },
          0,
        );
        setError(
          active?.connected === true
            ? '上一项操作仍在等待确认。'
            : '连接恢复后才能操作。',
        );
        throw busy;
      }
      const freshId = await secureUuid();
      const command = commandAttemptsRef.current.acquire(
        current,
        input,
        () => freshId,
        () => new Date(),
      );
      commandInFlightRef.current = true;
      setPendingCommandType(input.type);
      setError(undefined);
      try {
        const result = await submitCommandWithAck(
          (payload, acknowledge) =>
            active.emit('command.submit', payload, acknowledge),
          command,
          isCommandResult,
        );
        commandAttemptsRef.current.complete(command.commandId);
        if (!result.accepted) {
          const rejection = new ApiError(result.error, 0);
          if (isInvalidSession(rejection)) await forgetSession();
          else if (shouldResyncAfterRejection(result)) await refreshView();
          setError(userFacingError(rejection));
          throw rejection;
        }
        if (input.type === 'LeaveLobby' || input.type === 'CloseRoom') {
          await forgetSession();
          await Taro.reLaunch({ url: '/pages/index/index' });
        } else if (
          ![
            'SubmitTeamVote',
            'SubmitQuestChoice',
            'SelectMerlinTarget',
          ].includes(input.type)
        ) {
          await refreshView();
        }
        return result;
      } catch (caught) {
        if (caught instanceof CommandAckTimeoutError) {
          setError('未收到服务器确认；再次提交会沿用相同命令编号。');
        } else if (caught instanceof InvalidCommandAckError) {
          setError('服务器确认格式异常，正在刷新对局。');
          await refreshView();
        } else if (!(caught instanceof ApiError)) {
          setError(userFacingError(caught));
        }
        throw caught;
      } finally {
        commandInFlightRef.current = false;
        setPendingCommandType(undefined);
      }
    },
    [forgetSession, refreshView],
  );

  const reportAudioTelemetry = useCallback(
    (category: Parameters<SessionContextValue['reportAudioTelemetry']>[0]) => {
      if (socketRef.current?.connected !== true) return;
      socketRef.current.emit('audio.telemetry', {
        protocolVersion: 2,
        category,
        platform: 'wechat_miniprogram',
        appVersion: WECHAT_APP_VERSION,
        voicePackVersion: 'zh-CN-v1',
      });
    },
    [],
  );

  const value = useMemo<SessionContextValue>(
    () => ({
      status,
      ...(summary === undefined ? {} : { summary }),
      ...(roomView === undefined ? {} : { roomView }),
      ...(lastProjection === undefined ? {} : { lastProjection }),
      networkReachable,
      privacyHidden,
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
      revealPrivateUi: () => {
        setPrivacyHidden(false);
      },
      reportAudioTelemetry,
    }),
    [
      createRoom,
      error,
      forgetSession,
      joinRoom,
      lastProjection,
      networkReachable,
      pendingCommandType,
      privacyHidden,
      recover,
      refreshView,
      reportAudioTelemetry,
      roomView,
      status,
      submitCommand,
      summary,
    ],
  );

  return (
    <SessionContext.Provider value={value}>
      {children}
      {privacyHidden && roomView !== undefined ? (
        <View className="overlay">
          <Text className="title">私密内容已遮挡</Text>
          <Text className="subtitle">确认旁人无法看到屏幕后再继续。</Text>
          <Button
            className="button"
            onClick={() => {
              setPrivacyHidden(false);
            }}
          >
            返回对局
          </Button>
        </View>
      ) : null}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const value = useContext(SessionContext);
  if (value === undefined)
    throw new Error('useSession must be used within SessionProvider');
  return value;
}
