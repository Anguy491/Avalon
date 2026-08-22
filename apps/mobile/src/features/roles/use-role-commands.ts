import { useCallback, useState } from 'react';

import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { useSession } from '@/session/session-provider';

export function useRoleCommands() {
  const session = useSession();
  const { t } = useI18n();
  const [noticeKey, setNoticeKey] = useState<MessageKey>();

  const continuePhase = useCallback(async (): Promise<boolean> => {
    setNoticeKey(undefined);
    session.dismissError();
    try {
      await session.submitCommand({ type: 'ContinuePhase', payload: {} });
      setNoticeKey('roleNoticeStarted');
      return true;
    } catch {
      return false;
    }
  }, [session]);

  const acknowledgeRole = useCallback(async (): Promise<boolean> => {
    setNoticeKey(undefined);
    session.dismissError();
    try {
      await session.submitCommand({ type: 'AckRole', payload: {} });
      setNoticeKey('roleNoticeConfirmed');
      return true;
    } catch {
      return false;
    }
  }, [session]);

  return {
    notice: noticeKey === undefined ? undefined : t(noticeKey),
    pendingCommandType: session.pendingCommandType,
    continuePhase,
    acknowledgeRole,
  } as const;
}
