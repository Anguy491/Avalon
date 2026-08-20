import { Button, Text, View } from '@tarojs/components';
import { useEffect, useState } from 'react';

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
  useEffect(() => {
    if (privacyHidden) {
      setRevealed(false);
      setGuideOpen(false);
    }
  }, [privacyHidden]);
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
      {!revealed ? (
        <View className="card" style="color:#171a22;text-align:center;">
          <Text className="section-title">身份已遮挡</Text>
          <Button
            className="button"
            onClick={() => {
              setRevealed(true);
            }}
          >
            点按揭示身份
          </Button>
        </View>
      ) : (
        <View className="card" style="color:#171a22;">
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
          {guideOpen
            ? role?.guide.map((tip) => (
                <View className="subtitle" key={tip}>
                  • {tip}
                </View>
              ))
            : null}
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
      )}
      <View className="progress">
        身份确认进度：{progress?.submittedCount ?? 0}/
        {progress?.requiredCount ?? roomView.public.players.length}
      </View>
      {actions.has('AckRole') ? (
        <Button
          className="button"
          disabled={!revealed || busy}
          onClick={() => {
            setRevealed(false);
            setGuideOpen(false);
            void submitCommand({ type: 'AckRole', payload: {} });
          }}
        >
          我已记住身份
        </Button>
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
