import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import { terminalSessionDisposition } from './terminal-session-state';

function view(
  phase: RoomView['public']['phase'],
  reason?: RoomView['public']['gameOutcome'] extends infer Outcome
    ? NonNullable<Outcome> extends { reason: infer Reason }
      ? Reason
      : never
    : never,
): RoomView {
  return {
    public: {
      phase,
      gameOutcome: reason === undefined ? null : { winner: 'NONE', reason },
    },
  } as RoomView;
}

describe('AC-016 terminal session disposition', () => {
  it('returns aborted games home while retaining ordinary result views', () => {
    expect(terminalSessionDisposition(view('PAUSED'))).toBe('ACTIVE');
    expect(terminalSessionDisposition(view('GAME_OVER', 'ABORTED'))).toBe(
      'RETURN_HOME',
    );
    expect(
      terminalSessionDisposition(view('GAME_OVER', 'FIVE_REJECTED_TEAMS')),
    ).toBe('RETAIN_RESULT');
  });
});
