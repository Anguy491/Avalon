import { router } from 'expo-router';
import { useCallback, useState } from 'react';

import type { RoomConfigInput } from '@avalon/protocol/mobile';

import { useSession } from '@/session/session-provider';

export function useLobbyCommands() {
  const session = useSession();
  const [notice, setNotice] = useState<string>();

  const run = useCallback(
    async (
      command: Parameters<typeof session.submitCommand>[0],
      successNotice: string,
    ): Promise<boolean> => {
      setNotice(undefined);
      session.dismissError();
      try {
        await session.submitCommand(command);
        setNotice(successNotice);
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
        '配置已更新，请所有人重新准备。',
      ),
    [run],
  );

  const reorderSeats = useCallback(
    (playerIds: readonly string[]) =>
      run(
        { type: 'ReorderSeats', payload: { playerIds } },
        '座次已更新，请所有人重新准备。',
      ),
    [run],
  );

  const setReady = useCallback(
    (ready: boolean) =>
      run(
        { type: 'SetReady', payload: { ready } },
        ready ? '你已准备。' : '你已取消准备。',
      ),
    [run],
  );

  const startGame = useCallback(async () => {
    const succeeded = await run(
      { type: 'StartGame', payload: {} },
      '身份已分配。',
    );
    if (succeeded) router.replace('/role');
    return succeeded;
  }, [run]);

  const kickPlayer = useCallback(
    (targetPlayerId: string) =>
      run(
        { type: 'KickLobbyPlayer', payload: { targetPlayerId } },
        '玩家已移出大厅，全员需重新准备。',
      ),
    [run],
  );

  const leaveLobby = useCallback(async () => {
    const succeeded = await run(
      { type: 'LeaveLobby', payload: {} },
      '你已离开大厅。',
    );
    if (succeeded) router.replace('/');
    return succeeded;
  }, [run]);

  const closeRoom = useCallback(async () => {
    const succeeded = await run(
      { type: 'CloseRoom', payload: {} },
      '房间已关闭。',
    );
    if (succeeded) router.replace('/');
    return succeeded;
  }, [run]);

  return {
    notice,
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
