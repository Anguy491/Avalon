import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol';

import { acceptNewerRoomView } from './room-view-state';

const view = (stateVersion: number, marker = '') =>
  ({ public: { stateVersion }, private: { marker } }) as unknown as RoomView;

describe('acceptNewerRoomView', () => {
  it('drops stale views while accepting equal-version time-derived refreshes', () => {
    const current = view(4, 'current');
    expect(acceptNewerRoomView(current, view(3, 'stale'))).toBe(current);
    expect(
      (
        acceptNewerRoomView(current, view(4, 'refreshed'))
          .private as unknown as {
          marker: string;
        }
      ).marker,
    ).toBe('refreshed');
    expect(acceptNewerRoomView(current, view(5)).public.stateVersion).toBe(5);
  });
});
