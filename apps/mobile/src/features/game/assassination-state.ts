import type { RoomView } from '@avalon/protocol/mobile';

type PlayerSummary = RoomView['public']['players'][number];

export interface AssassinationState {
  readonly phaseStage: RoomView['public']['phaseStage'];
  readonly isHost: boolean;
  readonly canContinue: boolean;
  readonly canSelectTarget: boolean;
  readonly targets: readonly PlayerSummary[];
}

export function deriveAssassinationState(
  roomView: RoomView,
): AssassinationState {
  const players = [...roomView.public.players].sort(
    (left, right) => left.seat - right.seat,
  );
  const self = players.find(
    (player) => player.playerId === roomView.private.playerId,
  );
  const action = roomView.private.availableActions.find(
    (candidate) => candidate.commandType === 'SelectMerlinTarget',
  );
  const eligible = new Set(action?.eligibleTargetPlayerIds ?? []);

  return {
    phaseStage: roomView.public.phaseStage,
    isHost: self?.isHost === true,
    canContinue: roomView.private.availableActions.some(
      (candidate) => candidate.commandType === 'ContinuePhase',
    ),
    canSelectTarget: action !== undefined,
    targets:
      action === undefined
        ? []
        : players.filter((player) => eligible.has(player.playerId)),
  };
}
