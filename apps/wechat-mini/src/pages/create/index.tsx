import { Button, Input, Text, View } from '@tarojs/components';
import { useMemo, useState } from 'react';

import { nicknameError, normalizeNickname } from '@avalon/client-core';
import type { RoomConfigInput, RoomView } from '@avalon/protocol/mobile';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

type RoleId = RoomView['public']['config']['roleIds'][number];

const ROLES: readonly { id: RoleId; label: string }[] = [
  { id: 'MERLIN', label: '梅林' },
  { id: 'PERCIVAL', label: '派西维尔' },
  { id: 'LOYAL_SERVANT', label: '忠臣' },
  { id: 'ASSASSIN', label: '刺客' },
  { id: 'MINION', label: '爪牙' },
  { id: 'MORGANA', label: '莫甘娜' },
  { id: 'MORDRED', label: '莫德雷德' },
  { id: 'OBERON', label: '奥伯伦' },
];

type Mode = 'CLASSIC' | 'RECOMMENDED' | 'CUSTOM';

export default function CreatePage() {
  const { createRoom, status } = useSession();
  const [nickname, setNickname] = useState('');
  const [playerCount, setPlayerCount] = useState(5);
  const [mode, setMode] = useState<Mode>('CLASSIC');
  const [customRoles, setCustomRoles] = useState<RoleId[]>([]);
  const normalized = normalizeNickname(nickname);
  const inputError = nicknameError(nickname);
  const canSubmit =
    inputError === undefined &&
    (mode !== 'CUSTOM' || customRoles.length === playerCount);
  const counts = useMemo(
    () =>
      new Map(
        ROLES.map(({ id }) => [
          id,
          customRoles.filter((role) => role === id).length,
        ]),
      ),
    [customRoles],
  );

  const config: RoomConfigInput = {
    rulesVersion: 'CLASSIC_AVALON_V1',
    playerCount,
    roleSelection:
      mode === 'CUSTOM'
        ? { type: 'CUSTOM', roleIds: customRoles }
        : { type: 'PRESET', presetId: mode },
    locale: 'zh-CN',
  };

  return (
    <PageShell
      title="创建房间"
      subtitle="选择人数和角色配置，创建后你将成为房主。"
    >
      <View className="card">
        <Text className="section-title">玩家人数</Text>
        <View className="row-wrap">
          {Array.from({ length: 6 }, (_, index) => index + 5).map((count) => (
            <View
              key={count}
              className={`choice${playerCount === count ? ' choice-selected' : ''}`}
              onClick={() => {
                setPlayerCount(count);
              }}
            >
              {count} 人
            </View>
          ))}
        </View>
        <Text className="section-title">角色配置</Text>
        <View className="row-wrap">
          {(['CLASSIC', 'RECOMMENDED', 'CUSTOM'] as const).map((candidate) => (
            <View
              key={candidate}
              className={`choice${mode === candidate ? ' choice-selected' : ''}`}
              onClick={() => {
                setMode(candidate);
              }}
            >
              {candidate === 'CLASSIC'
                ? '基础'
                : candidate === 'RECOMMENDED'
                  ? '推荐'
                  : '自定义'}
            </View>
          ))}
        </View>
        {mode === 'CUSTOM' ? (
          <View>
            <View className="progress">
              已选 {customRoles.length}/{playerCount}
            </View>
            {ROLES.map(({ id, label }) => (
              <View className="player" key={id}>
                <Text>{label}</Text>
                <View className="spacer" />
                <Text>{counts.get(id) ?? 0}</Text>
                <Button
                  className="button button-secondary button-small"
                  onClick={() => {
                    setCustomRoles((current) => {
                      const index = current.lastIndexOf(id);
                      return index < 0
                        ? current
                        : current.filter((_, roleIndex) => roleIndex !== index);
                    });
                  }}
                >
                  −
                </Button>
                <Button
                  className="button button-small"
                  disabled={customRoles.length >= playerCount}
                  onClick={() => {
                    setCustomRoles((current) => [...current, id]);
                  }}
                >
                  ＋
                </Button>
              </View>
            ))}
          </View>
        ) : null}
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
        {inputError === undefined ? null : (
          <View className="error">{inputError}</View>
        )}
      </View>
      <Button
        className="button"
        disabled={!canSubmit || status === 'RECOVERING'}
        onClick={() => void createRoom(normalized, config)}
      >
        创建房间
      </Button>
    </PageShell>
  );
}
