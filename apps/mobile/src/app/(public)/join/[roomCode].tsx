import { useLocalSearchParams } from 'expo-router';

import { JoinRoomScreen } from '@/features/rooms/join-room-screen';

export default function DeepLinkJoinRoute() {
  const parameters = useLocalSearchParams<{ roomCode?: string }>();
  return <JoinRoomScreen initialRoomCode={parameters.roomCode ?? ''} />;
}
