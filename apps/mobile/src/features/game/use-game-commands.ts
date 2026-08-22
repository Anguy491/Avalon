import { useCallback, useState } from 'react';

import { useI18n } from '@/localization/localization-provider';
import type { MessageKey } from '@/localization/messages';
import { useSession } from '@/session/session-provider';

export function useGameCommands() {
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

  return {
    notice: noticeKey === undefined ? undefined : t(noticeKey),
    pendingCommandType: session.pendingCommandType,
    continuePhase: () =>
      run({ type: 'ContinuePhase', payload: {} }, 'gameNoticePhaseContinued'),
    submitTeam: (teamPlayerIds: readonly string[]) =>
      run(
        { type: 'SubmitTeam', payload: { teamPlayerIds } },
        'gameNoticeTeamSubmitted',
      ),
    submitTeamVote: (vote: 'APPROVE' | 'REJECT') =>
      run(
        { type: 'SubmitTeamVote', payload: { vote } },
        'gameNoticeVoteSubmitted',
      ),
    submitQuestChoice: (choice: 'SUCCESS' | 'FAIL') =>
      run(
        { type: 'SubmitQuestChoice', payload: { choice } },
        'gameNoticeQuestSubmitted',
      ),
    selectMerlinTarget: (targetPlayerId: string) =>
      run(
        { type: 'SelectMerlinTarget', payload: { targetPlayerId } },
        'gameNoticeAssassinationSubmitted',
      ),
  } as const;
}
