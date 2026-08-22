import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import type { RoomConfigInput } from '@avalon/protocol/mobile';

import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { useSession } from '@/session/session-provider';

export function useLobbyCommands() {
  const session = useSession();
  const { t } = useI18n();
  const [noticeKey, setNoticeKey] = useState<MessageKey>();

  const run = useCallback(
    async (
      command: Parameters<typeof session.submitCommand>[0],
      successNoticeKey: MessageKey,
    ): Promise<boolean> => {
      setNoticeKey(undefined);
      session.dismissError();
      try {
        await session.submitCommand(command);
        setNoticeKey(successNoticeKey);
        return true;
      } catch {
        return false;
      }
    },
    [session],
  );

  const configureRoom = useCallback(
    (config: RoomConfigInput) =>
      run(
        { type: 'ConfigureRoom', payload: { config } },
        'lobbyNoticeConfigUpdated',
      ),
    [run],
  );

  const reorderSeats = useCallback(
    (playerIds: readonly string[]) =>
      run(
        { type: 'ReorderSeats', payload: { playerIds } },
        'lobbyNoticeSeatsUpdated',
      ),
    [run],
  );

  const setReady = useCallback(
    (ready: boolean) =>
      run(
        { type: 'SetReady', payload: { ready } },
        ready ? 'lobbyNoticeReady' : 'lobbyNoticeNotReady',
      ),
    [run],
  );

  const startGame = useCallback(async () => {
    const succeeded = await run(
      { type: 'StartGame', payload: {} },
      'lobbyNoticeStarted',
    );
    if (succeeded) router.replace('/role');
    return succeeded;
  }, [run]);

  const kickPlayer = useCallback(
    (targetPlayerId: string) =>
      run(
        { type: 'KickLobbyPlayer', payload: { targetPlayerId } },
        'lobbyNoticePlayerRemoved',
      ),
    [run],
  );

  const leaveLobby = useCallback(async () => {
    const succeeded = await run(
      { type: 'LeaveLobby', payload: {} },
      'lobbyNoticeLeft',
    );
    if (succeeded) router.replace('/');
    return succeeded;
  }, [run]);

  const closeRoom = useCallback(async () => {
    const succeeded = await run(
      { type: 'CloseRoom', payload: {} },
      'lobbyNoticeClosed',
    );
    if (succeeded) router.replace('/');
    return succeeded;
  }, [run]);

  return {
    notice: noticeKey === undefined ? undefined : t(noticeKey),
    pendingCommandType: session.pendingCommandType,
    configureRoom,
    reorderSeats,
    setReady,
    startGame,
    kickPlayer,
    leaveLobby,
    closeRoom,
  } as const;
}
