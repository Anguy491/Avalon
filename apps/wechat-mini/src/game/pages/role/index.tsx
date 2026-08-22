import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

import { rolePresentation } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

const KNOWLEDGE_LABELS = {
  EVIL_PLAYER: '邪恶玩家',
  MERLIN_CANDIDATE: '梅林候选人',
  KNOWN_EVIL_ALLY: '已知邪恶同伴',
} as const;

export default function RolePage() {
  const { roomView, submitCommand, pendingCommandType, privacyHidden } =
    useSession();
  const [revealed, setRevealed] = useState(false);
  const [guideOpen, setGuideOpen] = useState(false);
  const [tapMode, setTapMode] = useState(false);
  const revealTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const clearRevealTimer = () => {
    if (revealTimerRef.current !== undefined) {
      clearTimeout(revealTimerRef.current);
      revealTimerRef.current = undefined;
    }
  };
  useEffect(() => {
    clearRevealTimer();
    setRevealed(false);
    setGuideOpen(false);
  }, [privacyHidden, roomView?.public.phase, roomView?.public.stateVersion]);
  useEffect(
    () => () => {
      clearRevealTimer();
    },
    [],
  );
  if (roomView === undefined)
    return <PageShell privatePage title="正在恢复身份" />;
  const role = rolePresentation(roomView.private.selfRole);
  const names = new Map(
    roomView.public.players.map((player) => [player.playerId, player.nickname]),
  );
  const actions = new Set(
    roomView.private.availableActions.map((action) => action.commandType),
  );
  const busy = pendingCommandType !== undefined;
  const progress = roomView.public.submissionProgress;
  return (
    <PageShell
      privatePage
      title="私密身份"
      subtitle="遮挡屏幕后主动揭示；不要把身份展示给同桌玩家。"
    >
      <View className="card" style="color:#171a22;text-align:center;">
        {!revealed ? <Text className="section-title">身份已遮挡</Text> : null}
        <Button
          className="button"
          ariaLabel={tapMode ? '点按揭示或遮挡身份' : '按住六百毫秒查看身份'}
          onTouchStart={() => {
            if (tapMode || role === undefined) return;
            clearRevealTimer();
            revealTimerRef.current = setTimeout(() => {
              setRevealed(true);
            }, 600);
          }}
          onTouchEnd={() => {
            clearRevealTimer();
            if (!tapMode) setRevealed(false);
          }}
          onTouchCancel={() => {
            clearRevealTimer();
            if (!tapMode) setRevealed(false);
          }}
          onClick={() => {
            if (tapMode && role !== undefined) setRevealed((value) => !value);
          }}
        >
          {tapMode
            ? revealed
              ? '点按遮挡身份'
              : '点按揭示身份'
            : revealed
              ? '松手立即遮挡'
              : '按住 600ms 查看身份'}
        </Button>
        <Button
          className="button button-secondary"
          ariaLabel={`${tapMode ? '关闭' : '开启'}读屏点按切换模式`}
          onClick={() => {
            clearRevealTimer();
            setRevealed(false);
            setTapMode((enabled) => !enabled);
          }}
        >
          {tapMode ? '关闭点按切换模式' : '读屏用户：开启点按切换模式'}
        </Button>
        {revealed ? (
          <View style="text-align:left;">
            <Text className="title">{role?.label ?? '身份不可用'}</Text>
            <View className="section-title">
              {roomView.private.selfAlignment === 'GOOD'
                ? '善良阵营'
                : '邪恶阵营'}
            </View>
            <View className="subtitle">{role?.ability}</View>
            <Text className="section-title">你知道的信息</Text>
            {roomView.private.knownPlayers.length === 0 ? (
              <View className="muted">没有额外的开局信息。</View>
            ) : (
              roomView.private.knownPlayers.map((known) => (
                <View className="player" key={known.playerId}>
                  <Text>{names.get(known.playerId) ?? '同桌玩家'}</Text>
                  <View className="spacer" />
                  <Text className="badge">
                    {KNOWLEDGE_LABELS[known.knowledgeLabel]}
                  </Text>
                </View>
              ))
            )}
            <Button
              className="button button-secondary"
              onClick={() => {
                setGuideOpen((open) => !open);
              }}
            >
              {guideOpen ? '关闭角色攻略' : '查看角色攻略'}
            </Button>
            <Button
              className="button button-secondary"
              onClick={() => {
                setGuideOpen(false);
                setRevealed(false);
              }}
            >
              立即遮挡
            </Button>
          </View>
        ) : null}
      </View>
      <View className="progress">
        身份确认进度：{progress?.submittedCount ?? 0}/
        {progress?.requiredCount ?? roomView.public.players.length}
      </View>
      {actions.has('AckRole') ? (
        <Button
          className="button"
          disabled={!revealed || busy}
          onClick={() =>
            void Taro.showModal({
              title: '确认已记住身份',
              content: '提交后将进入中性等待画面，无法再次查看本页内容。',
              confirmText: '确认提交',
              cancelText: '继续查看',
            }).then((result) => {
              if (!result.confirm) return;
              setRevealed(false);
              setGuideOpen(false);
              void submitCommand({ type: 'AckRole', payload: {} }).catch(
                () => undefined,
              );
            })
          }
        >
          我已记住身份
        </Button>
      ) : null}
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
              setRevealed(false);
            }}
          >
            关闭并遮挡
          </Button>
        </View>
      ) : null}
      {actions.has('ContinuePhase') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() =>
            void submitCommand({ type: 'ContinuePhase', payload: {} })
          }
        >
          房主继续
        </Button>
      ) : null}
    </PageShell>
  );
}
