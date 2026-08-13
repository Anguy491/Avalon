import { describe, expect, it } from 'vitest';

import type { RoomView } from '@avalon/protocol';

import { acceptNewerRoomView } from './room-view-state';

const view = (stateVersion: number) =>
  ({ public: { stateVersion } }) as RoomView;

describe('acceptNewerRoomView', () => {
  it('drops duplicate and stale LIVE deliveries', () => {
    expect(acceptNewerRoomView(view(4), view(3)).public.stateVersion).toBe(4);
    expect(acceptNewerRoomView(view(4), view(4)).public.stateVersion).toBe(4);
    expect(acceptNewerRoomView(view(4), view(5)).public.stateVersion).toBe(5);
  });
});
