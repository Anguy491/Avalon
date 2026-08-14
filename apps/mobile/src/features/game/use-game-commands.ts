import { useCallback, useState } from 'react';

import { useSession } from '@/session/session-provider';

export function useGameCommands() {
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

  return {
    notice,
    pendingCommandType: session.pendingCommandType,
    continuePhase: () =>
      run({ type: 'ContinuePhase', payload: {} }, '阶段已继续。'),
    submitTeam: (teamPlayerIds: readonly string[]) =>
      run({ type: 'SubmitTeam', payload: { teamPlayerIds } }, '队伍已提交。'),
    submitTeamVote: (vote: 'APPROVE' | 'REJECT') =>
      run(
        { type: 'SubmitTeamVote', payload: { vote } },
        '你的投票已安全提交。',
      ),
    submitQuestChoice: (choice: 'SUCCESS' | 'FAIL') =>
      run(
        { type: 'SubmitQuestChoice', payload: { choice } },
        '你的任务行动已安全提交。',
      ),
  } as const;
}
