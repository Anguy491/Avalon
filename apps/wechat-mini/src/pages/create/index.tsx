import { Button, Input, Text, View } from '@tarojs/components';
import { useEffect, useMemo, useState } from 'react';

import { nicknameError, normalizeNickname } from '@avalon/client-core';
import type {
  RoomConfigInput,
  RoomConfigValidationError,
  RoomConfigValidationErrorCode,
  RoomView,
} from '@avalon/protocol/mobile';

import { validateRoomConfig } from '@/api/client';
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

const CONFIG_ERROR_MESSAGES: Readonly<
  Record<RoomConfigValidationErrorCode, string>
> = {
  INVALID_PLAYER_COUNT: '玩家人数必须为 5–10 人。',
  ROLE_COUNT_MISMATCH: '角色数量必须与玩家人数一致。',
  ALIGNMENT_COUNT_MISMATCH: '正义与邪恶阵营人数不符合当前人数规则。',
  MERLIN_REQUIRED_ONCE: '必须且只能有一名梅林。',
  ASSASSIN_REQUIRED_ONCE: '必须且只能有一名刺客。',
  UNIQUE_ROLE_REPEATED: '特殊角色不能重复。',
  MORGANA_REQUIRES_PERCIVAL: '选择莫甘娜时必须同时选择派西维尔。',
  FIVE_PLAYER_PERCIVAL_REQUIRES_DECEPTION_ROLE:
    '五人局选择派西维尔时，必须加入莫甘娜或莫德雷德。',
};

export default function CreatePage() {
  const { createRoom, status } = useSession();
  const [nickname, setNickname] = useState('');
  const [playerCount, setPlayerCount] = useState(5);
  const [mode, setMode] = useState<Mode>('CLASSIC');
  const [customRoles, setCustomRoles] = useState<RoleId[]>([]);
  const [configValidation, setConfigValidation] = useState<
    | { readonly status: 'IDLE' | 'CHECKING' | 'UNAVAILABLE' }
    | {
        readonly status: 'VALIDATED';
        readonly errors: readonly RoomConfigValidationError[];
      }
  >({ status: 'IDLE' });
  const normalized = normalizeNickname(nickname);
  const inputError = nicknameError(nickname);
  const customConfigValid =
    mode !== 'CUSTOM' ||
    (configValidation.status === 'VALIDATED' &&
      configValidation.errors.length === 0);
  const canSubmit = inputError === undefined && customConfigValid;
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

  useEffect(() => {
    if (mode !== 'CUSTOM') {
      setConfigValidation({ status: 'IDLE' });
      return;
    }
    let active = true;
    setConfigValidation({ status: 'CHECKING' });
    const timeout = setTimeout(() => {
      void validateRoomConfig({ playerCount, roleIds: customRoles })
        .then((result) => {
          if (active) {
            setConfigValidation({ status: 'VALIDATED', errors: result.errors });
          }
        })
        .catch(() => {
          if (active) setConfigValidation({ status: 'UNAVAILABLE' });
        });
    }, 200);
    return () => {
      active = false;
      clearTimeout(timeout);
    };
  }, [customRoles, mode, playerCount]);

  return (
    <PageShell
      title="创建房间"
      subtitle="选择人数和角色配置，创建后你将成为房主。"
    >
      <View className="card">
        <Text className="section-title">玩家人数</Text>
        <View className="row-wrap">
          {Array.from({ length: 6 }, (_, index) => index + 5).map((count) => (
            <Button
              key={count}
              className={`choice${playerCount === count ? ' choice-selected' : ''}`}
              ariaLabel={`${playerCount === count ? '已选择，' : ''}${String(count)} 人`}
              onClick={() => {
                setPlayerCount(count);
              }}
            >
              {count} 人
            </Button>
          ))}
        </View>
        <Text className="section-title">角色配置</Text>
        <View className="row-wrap">
          {(['CLASSIC', 'RECOMMENDED', 'CUSTOM'] as const).map((candidate) => (
            <Button
              key={candidate}
              className={`choice${mode === candidate ? ' choice-selected' : ''}`}
              ariaLabel={`${mode === candidate ? '已选择，' : ''}角色配置：${
                candidate === 'CLASSIC'
                  ? '基础'
                  : candidate === 'RECOMMENDED'
                    ? '推荐'
                    : '自定义'
              }`}
              onClick={() => {
                setMode(candidate);
              }}
            >
              {candidate === 'CLASSIC'
                ? '基础'
                : candidate === 'RECOMMENDED'
                  ? '推荐'
                  : '自定义'}
            </Button>
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
            {configValidation.status === 'CHECKING' ? (
              <View className="subtitle">正在校验角色配置…</View>
            ) : null}
            {configValidation.status === 'UNAVAILABLE' ? (
              <View className="error">校验服务暂时不可用，无法保存配置。</View>
            ) : null}
            {configValidation.status === 'VALIDATED'
              ? configValidation.errors.map((validationError, index) => (
                  <View
                    className="error"
                    key={`${validationError.code}-${validationError.roleId ?? 'none'}-${String(index)}`}
                  >
                    {CONFIG_ERROR_MESSAGES[validationError.code]}
                  </View>
                ))
              : null}
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
