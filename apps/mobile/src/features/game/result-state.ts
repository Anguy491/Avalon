import type { RoomView } from '@avalon/protocol/mobile';

import { ROLE_PRESENTATION } from '../roles/role-reveal-state';

type Outcome = NonNullable<RoomView['public']['gameOutcome']>;
type PlayerSummary = RoomView['public']['players'][number];

const REASON_LABELS: Readonly<Record<Outcome['reason'], string>> = {
  THREE_QUEST_FAILURES: '三项任务失败，邪恶方赢得对局。',
  FIVE_REJECTED_TEAMS: '同一任务连续五次组队被否决，邪恶方赢得对局。',
  MERLIN_ASSASSINATED: '刺客成功找出梅林，邪恶方翻盘获胜。',
  MERLIN_SURVIVED: '刺客未能找出梅林，善良方守住胜利。',
  ABORTED: '对局已中止，不判定阵营胜负。',
};

export interface RevealedPlayer {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly roleLabel: string;
  readonly alignment: 'GOOD' | 'EVIL';
  readonly alignmentLabel: '善良阵营' | '邪恶阵营';
  readonly wasAssassinationTarget: boolean;
}

export interface ResultState {
  readonly winner: Outcome['winner'];
  readonly winnerLabel: string;
  readonly reason: Outcome['reason'];
  readonly reasonLabel: string;
  readonly assassinationTarget?: PlayerSummary;
  readonly revealedPlayers: readonly RevealedPlayer[];
  readonly successCount: number;
  readonly failureCount: number;
  readonly proposalHistory: RoomView['public']['proposalHistory'];
  readonly questHistory: RoomView['public']['questHistory'];
  readonly players: readonly PlayerSummary[];
}

export function deriveResultState(roomView: RoomView): ResultState | undefined {
  const outcome = roomView.public.gameOutcome;
  if (
    roomView.public.phase !== 'GAME_OVER' ||
    outcome === null ||
    outcome === undefined
  ) {
    return undefined;
  }

  const players = [...roomView.public.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const byId = new Map(players.map((player) => [player.playerId, player]));
  const assignments = new Map(
    (roomView.public.revealedAssignments ?? []).map((assignment) => [
      assignment.playerId,
      assignment,
    ]),
  );
  const targetId = outcome.assassinationTargetPlayerId ?? undefined;
  const assassinationTarget =
    targetId === undefined ? undefined : byId.get(targetId);

  return {
    winner: outcome.winner,
    winnerLabel:
      outcome.winner === 'GOOD'
        ? '善良方获胜'
        : outcome.winner === 'EVIL'
          ? '邪恶方获胜'
          : '对局中止',
    reason: outcome.reason,
    reasonLabel: REASON_LABELS[outcome.reason] ?? '对局已结束。',
    ...(assassinationTarget === undefined ? {} : { assassinationTarget }),
    revealedPlayers: players.flatMap<RevealedPlayer>((player) => {
      const assignment = assignments.get(player.playerId);
      if (assignment === undefined) return [];
      const presentation = ROLE_PRESENTATION[assignment.roleId];
      if (presentation === undefined) return [];
      return [
        {
          playerId: player.playerId,
          nickname: player.nickname,
          seat: player.seat,
          roleLabel: presentation.label,
          alignment:
            assignment.alignment === 'GOOD'
              ? ('GOOD' as const)
              : ('EVIL' as const),
          alignmentLabel:
            assignment.alignment === 'GOOD' ? '善良阵营' : '邪恶阵营',
          wasAssassinationTarget: player.playerId === targetId,
        },
      ];
    }),
    successCount: roomView.public.successCount,
    failureCount: roomView.public.failureCount,
    proposalHistory: roomView.public.proposalHistory,
    questHistory: roomView.public.questHistory,
    players,
  };
}
