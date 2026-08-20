import { Button, Input, Text, View } from '@tarojs/components';
import { useRouter } from '@tarojs/taro';
import { useState } from 'react';

import {
  nicknameError,
  normalizeNickname,
  normalizeRoomCode,
  ROOM_CODE_PATTERN,
} from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

export default function JoinPage() {
  const router = useRouter();
  const { joinRoom, status } = useSession();
  const [nickname, setNickname] = useState('');
  const [roomCode, setRoomCode] = useState(() =>
    normalizeRoomCode(router.params.roomCode ?? ''),
  );
  const nameError = nicknameError(nickname);
  const canSubmit = nameError === undefined && ROOM_CODE_PATTERN.test(roomCode);
  return (
    <PageShell title="加入房间" subtitle="输入同桌玩家展示的六位房间号。">
      <View className="card">
        <Text className="section-title">房间号</Text>
        <Input
          className="input room-code"
          maxlength={6}
          value={roomCode}
          placeholder="7K3M9Q"
          onInput={(event) => {
            setRoomCode(normalizeRoomCode(event.detail.value));
          }}
        />
        <Text className="section-title">你的昵称</Text>
        <Input
          className="input"
          maxlength={32}
          value={nickname}
          placeholder="1–16 个可见字符"
          onInput={(event) => {
            setNickname(event.detail.value);
          }}
        />
        {nameError === undefined ? null : (
          <View className="error">{nameError}</View>
        )}
      </View>
      <Button
        className="button"
        disabled={!canSubmit || status === 'RECOVERING'}
        onClick={() => void joinRoom(normalizeNickname(nickname), roomCode)}
      >
        加入房间
      </Button>
    </PageShell>
  );
}
