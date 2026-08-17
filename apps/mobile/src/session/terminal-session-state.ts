import type { RoomView } from '@avalon/protocol/mobile';

export type TerminalSessionDisposition =
  | 'ACTIVE'
  | 'RETURN_HOME'
  | 'RETAIN_RESULT';

export function terminalSessionDisposition(
  roomView: RoomView | undefined,
): TerminalSessionDisposition {
  if (roomView?.public.phase !== 'GAME_OVER') return 'ACTIVE';
  return roomView.public.gameOutcome?.reason === 'ABORTED'
    ? 'RETURN_HOME'
    : 'RETAIN_RESULT';
}
