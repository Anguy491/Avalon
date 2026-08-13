import { useCallback, useState } from 'react';

import { useSession } from '@/session/session-provider';

export function useRoleCommands() {
  const session = useSession();
  const [notice, setNotice] = useState<string>();

  const continuePhase = useCallback(async (): Promise<boolean> => {
    setNotice(undefined);
    session.dismissError();
    try {
      await session.submitCommand({ type: 'ContinuePhase', payload: {} });
      setNotice('身份确认已开始。');
      return true;
    } catch {
      return false;
    }
  }, [session]);

  const acknowledgeRole = useCallback(async (): Promise<boolean> => {
    setNotice(undefined);
    session.dismissError();
    try {
      await session.submitCommand({ type: 'AckRole', payload: {} });
      setNotice('身份已确认，请等待其他玩家。');
      return true;
    } catch {
      return false;
    }
  }, [session]);

  return {
    notice,
    pendingCommandType: session.pendingCommandType,
    continuePhase,
    acknowledgeRole,
  } as const;
}
