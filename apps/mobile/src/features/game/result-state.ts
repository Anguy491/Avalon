import type { RoomView } from '@avalon/protocol/mobile';

type Outcome = NonNullable<RoomView['public']['gameOutcome']>;
type PlayerSummary = RoomView['public']['players'][number];

export interface RevealedPlayer {
  readonly playerId: string;
  readonly nickname: string;
  readonly seat: number;
  readonly roleId: NonNullable<
    RoomView['public']['revealedAssignments']
  >[number]['roleId'];
  readonly alignment: 'GOOD' | 'EVIL';
  readonly wasAssassinationTarget: boolean;
}

export interface ResultState {
  readonly winner: Outcome['winner'];
  readonly reason: Outcome['reason'];
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
    reason: outcome.reason,
    ...(assassinationTarget === undefined ? {} : { assassinationTarget }),
    revealedPlayers: players.flatMap<RevealedPlayer>((player) => {
      const assignment = assignments.get(player.playerId);
      if (assignment === undefined) return [];
      return [
        {
          playerId: player.playerId,
          nickname: player.nickname,
          seat: player.seat,
          roleId: assignment.roleId,
          alignment:
            assignment.alignment === 'GOOD'
              ? ('GOOD' as const)
              : ('EVIL' as const),
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
