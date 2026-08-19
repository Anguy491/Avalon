import type { RoomView } from '@avalon/protocol/mobile';

export function acceptNewerRoomView(
  current: RoomView | undefined,
  incoming: RoomView,
): RoomView {
  return current === undefined ||
    incoming.public.stateVersion >= current.public.stateVersion
    ? incoming
    : current;
}

export type CanonicalRoute =
  | '/pages/index/index'
  | '/room/pages/lobby/index'
  | '/game/pages/role/index'
  | '/game/pages/game/index'
  | '/game/pages/assassination/index'
  | '/game/pages/result/index';

export function routeForRoomView(view: RoomView): CanonicalRoute {
  if (view.public.phase === 'LOBBY') return '/room/pages/lobby/index';
  if (view.public.phase === 'ROLE_REVEAL') return '/game/pages/role/index';
  if (view.public.phase === 'ASSASSINATION') {
    return '/game/pages/assassination/index';
  }
  if (view.public.phase === 'GAME_OVER') return '/game/pages/result/index';
  return '/game/pages/game/index';
}
