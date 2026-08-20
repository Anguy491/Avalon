import { Text, View } from '@tarojs/components';

import type { RoomView } from '@avalon/protocol/mobile';

interface PlayerListProps {
  readonly players: RoomView['public']['players'];
  readonly selfPlayerId?: string;
  readonly selectedIds?: ReadonlySet<string>;
  readonly onSelect?: (playerId: string) => void;
}

export function PlayerList({
  players,
  selfPlayerId,
  selectedIds,
  onSelect,
}: PlayerListProps) {
  return (
    <View className="card">
      {[...players]
        .sort((left, right) => left.seat - right.seat)
        .map((player) => (
          <View
            key={player.playerId}
            className={`player${selectedIds?.has(player.playerId) === true ? ' choice-selected' : ''}`}
            onClick={() => onSelect?.(player.playerId)}
          >
            <Text>{player.seat + 1} 号</Text>
            <Text>{player.nickname}</Text>
            {player.playerId === selfPlayerId ? (
              <Text className="badge">你</Text>
            ) : null}
            {player.isHost ? <Text className="badge">房主</Text> : null}
            <View className="spacer" />
            <Text>{player.connected ? '在线' : '离线'}</Text>
            <Text>{player.ready ? '已准备' : '未准备'}</Text>
          </View>
        ))}
    </View>
  );
}
