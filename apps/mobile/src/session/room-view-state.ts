import type { RoomView } from '@avalon/protocol';

export function acceptNewerRoomView(
  current: RoomView | undefined,
  incoming: RoomView,
): RoomView {
  return current === undefined ||
    incoming.public.stateVersion >= current.public.stateVersion
    ? incoming
    : current;
}
