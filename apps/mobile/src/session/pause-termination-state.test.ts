import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol/mobile';

import {
  countdownLabel,
  derivePauseTerminationUiState,
} from './pause-termination-state';

function pausedView(): RoomView {
  return {
    public: {
      phase: 'PAUSED',
      pauseTerminationVoteAvailableAt: '2026-08-16T06:01:00.000Z',
      pauseTerminationVote: null,
    },
    private: {
      availableActions: [],
      pauseTerminationVoteStatus: null,
    },
  } as unknown as RoomView;
}

describe('pause termination UI state', () => {
  it('counts down to the server-projected eligibility time', () => {
    const state = derivePauseTerminationUiState(
      pausedView(),
      Date.parse('2026-08-16T06:00:40.000Z'),
    );
    expect(state.availableInMs).toBe(20_000);
    expect(state.canStart).toBe(false);
    expect(countdownLabel(state.availableInMs)).toBe('00:20');
  });

  it('uses only public counts while enabling a private eligible voter', () => {
    const view = pausedView();
    view.public.pauseTerminationVote = {
      startedAt: '2026-08-16T06:01:00.000Z',
      expiresAt: '2026-08-16T06:01:30.000Z',
      eligibleCount: 4,
      submittedCount: 1,
    };
    view.private.pauseTerminationVoteStatus = 'PENDING';
    view.private.availableActions = [
      {
        commandType: 'SubmitPauseTerminationVote',
        allowedPauseTerminationChoices: ['TERMINATE', 'CONTINUE_PAUSE'],
      },
    ];
    const state = derivePauseTerminationUiState(
      view,
      Date.parse('2026-08-16T06:01:10.000Z'),
    );
    expect(state).toMatchObject({
      canSubmit: true,
      eligibleCount: 4,
      submittedCount: 1,
      ballotRemainingMs: 20_000,
      voterStatus: 'PENDING',
    });
  });
});
