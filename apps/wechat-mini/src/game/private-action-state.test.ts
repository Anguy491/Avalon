import { describe, expect, it } from 'vitest';

import {
  EMPTY_PRIVATE_ACTION,
  privateActionReducer,
} from './private-action-state';

describe('FR private action state', () => {
  it('opens from a neutral entry and never carries an old selection', () => {
    const selected = privateActionReducer(
      privateActionReducer(EMPTY_PRIVATE_ACTION, {
        type: 'OPEN',
        action: 'TEAM_VOTE',
      }),
      { type: 'SELECT', choice: 'APPROVE' },
    );
    expect(selected).toEqual({ action: 'TEAM_VOTE', choice: 'APPROVE' });
    expect(
      privateActionReducer(selected, { type: 'OPEN', action: 'QUEST' }),
    ).toEqual({ action: 'QUEST' });
  });

  it('clears the choice on background, projection change, submit, or failure', () => {
    const selected = {
      action: 'PAUSE_TERMINATION' as const,
      choice: 'TERMINATE',
    };
    expect(privateActionReducer(selected, { type: 'RESET' })).toBe(
      EMPTY_PRIVATE_ACTION,
    );
    expect(
      privateActionReducer(EMPTY_PRIVATE_ACTION, {
        type: 'SELECT',
        choice: 'TERMINATE',
      }),
    ).toBe(EMPTY_PRIVATE_ACTION);
  });
});
