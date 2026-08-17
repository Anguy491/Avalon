import type { RoomView } from '@avalon/protocol/mobile';

export interface PauseTerminationUiState {
  readonly canStart: boolean;
  readonly canSubmit: boolean;
  readonly availableInMs: number;
  readonly ballotRemainingMs: number;
  readonly eligibleCount: number;
  readonly submittedCount: number;
  readonly voterStatus: 'NOT_ELIGIBLE' | 'PENDING' | 'SUBMITTED' | null;
}

export function derivePauseTerminationUiState(
  roomView: RoomView,
  now: number,
): PauseTerminationUiState {
  const actions = new Set(
    roomView.private.availableActions.map((action) => action.commandType),
  );
  const availableAt = roomView.public.pauseTerminationVoteAvailableAt;
  const ballot = roomView.public.pauseTerminationVote;
  return {
    canStart: actions.has('StartPauseTerminationVote'),
    canSubmit: actions.has('SubmitPauseTerminationVote'),
    availableInMs:
      availableAt === undefined || availableAt === null
        ? 0
        : Math.max(0, Date.parse(availableAt) - now),
    ballotRemainingMs:
      ballot === undefined || ballot === null
        ? 0
        : Math.max(0, Date.parse(ballot.expiresAt) - now),
    eligibleCount: ballot?.eligibleCount ?? 0,
    submittedCount: ballot?.submittedCount ?? 0,
    voterStatus: roomView.private.pauseTerminationVoteStatus ?? null,
  };
}

export function countdownLabel(milliseconds: number): string {
  const totalSeconds = Math.ceil(Math.max(0, milliseconds) / 1_000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function shouldRefreshPauseEligibility(
  roomView: RoomView,
  state: PauseTerminationUiState,
  connected: boolean,
): boolean {
  const availableAt = roomView.public.pauseTerminationVoteAvailableAt;
  return (
    connected &&
    roomView.public.phase === 'PAUSED' &&
    availableAt !== undefined &&
    availableAt !== null &&
    roomView.public.pauseTerminationVote == null &&
    state.availableInMs === 0 &&
    !state.canStart
  );
}
