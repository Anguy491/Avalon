import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useState } from 'react';

import { rolePresentation } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

export default function AssassinationPage() {
  const { roomView, submitCommand, pendingCommandType, privacyHidden } =
    useSession();
  const [targetId, setTargetId] = useState<string>();
  const [guideOpen, setGuideOpen] = useState(false);
  useEffect(() => {
    setTargetId(undefined);
    setGuideOpen(false);
  }, [privacyHidden, roomView?.public.phase, roomView?.public.stateVersion]);
  if (roomView === undefined)
    return <PageShell privatePage title="正在恢复刺杀阶段" />;
  const players = [...roomView.public.players].sort((a, b) => a.seat - b.seat);
  const actions = new Map(
    roomView.private.availableActions.map((action) => [
      action.commandType,
      action,
    ]),
  );
  const eligible = new Set(
    actions.get('SelectMerlinTarget')?.eligibleTargetPlayerIds ?? [],
  );
  const targets = players.filter((player) => eligible.has(player.playerId));
  const target = targets.find((player) => player.playerId === targetId);
  const busy = pendingCommandType !== undefined;
  const role = rolePresentation(roomView.private.selfRole);
  return (
    <PageShell
      privatePage
      title="刺杀阶段"
      subtitle={
        actions.has('SelectMerlinTarget')
          ? '你是刺客。选择你认为是梅林的玩家。'
          : '请公开讨论，等待刺客作出最终选择。'
      }
    >
      {actions.has('ContinuePhase') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() =>
            void submitCommand({ type: 'ContinuePhase', payload: {} })
          }
        >
          房主开放刺杀选择
        </Button>
      ) : null}
      {targets.length === 0 ? (
        <View className="card" style="color:#171a22;">
          刺客正在选择目标，其他玩家请等待。
        </View>
      ) : (
        <View className="card" style="color:#171a22;">
          <Text className="section-title">可选目标</Text>
          {targets.map((player) => (
            <Button
              key={player.playerId}
              className={`player${targetId === player.playerId ? ' choice-selected' : ''}`}
              ariaLabel={`${targetId === player.playerId ? '已选择，' : ''}${String(player.seat + 1)} 号，${player.nickname}`}
              onClick={() => {
                setTargetId(player.playerId);
              }}
            >
              <Text>
                {player.seat + 1} 号 · {player.nickname}
              </Text>
              <View className="spacer" />
              {targetId === player.playerId ? (
                <Text className="badge">已选择</Text>
              ) : null}
            </Button>
          ))}
          <Button
            className="button button-danger"
            disabled={target === undefined || busy}
            onClick={() =>
              void Taro.showModal({
                title: '确认刺杀目标',
                content: `刺杀 ${target?.seat === undefined ? '' : `${String(target.seat + 1)} 号 `}${target?.nickname ?? ''}？提交后对局立即结束。`,
                confirmText: '确认刺杀',
                cancelText: '再想想',
              }).then((result) => {
                if (result.confirm && target !== undefined)
                  void submitCommand({
                    type: 'SelectMerlinTarget',
                    payload: { targetPlayerId: target.playerId },
                  });
              })
            }
          >
            确认刺杀目标
          </Button>
        </View>
      )}
      {role === undefined || privacyHidden ? null : (
        <Button
          className="button button-secondary"
          onClick={() => {
            setGuideOpen(true);
          }}
        >
          查看本人角色攻略
        </Button>
      )}
      {guideOpen && role !== undefined && !privacyHidden ? (
        <View className="private-action-overlay">
          <Text className="title">{role.label} · 私密攻略</Text>
          <View className="subtitle">只展示你的本人角色信息。</View>
          {role.guide.map((tip) => (
            <View className="card" key={tip}>
              {tip}
            </View>
          ))}
          <Button
            className="button"
            onClick={() => {
              setGuideOpen(false);
            }}
          >
            关闭并遮挡
          </Button>
        </View>
      ) : null}
    </PageShell>
  );
}
