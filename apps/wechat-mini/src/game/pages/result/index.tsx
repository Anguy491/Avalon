import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';

import { rolePresentation } from '@avalon/client-core';

import { PageShell } from '@/components/page-shell';
import { useSession } from '@/session/session-provider';

const REASONS: Readonly<Record<string, string>> = {
  THREE_QUEST_FAILURES: '三项任务失败，邪恶方赢得对局。',
  FIVE_REJECTED_TEAMS: '同一任务连续五次组队被否决，邪恶方赢得对局。',
  MERLIN_ASSASSINATED: '刺客成功找出梅林，邪恶方翻盘获胜。',
  MERLIN_SURVIVED: '刺客未能找出梅林，善良方守住胜利。',
  ABORTED: '对局已中止，不判定阵营胜负。',
} as const;

export default function ResultPage() {
  const { roomView, forgetSession } = useSession();
  if (roomView === undefined || roomView.public.gameOutcome == null) {
    return (
      <PageShell title="结果已清理" subtitle="服务器不会保留已结束对局的历史。">
        <Button
          className="button"
          onClick={() => void Taro.reLaunch({ url: '/pages/index/index' })}
        >
          返回首页
        </Button>
      </PageShell>
    );
  }
  const outcome = roomView.public.gameOutcome;
  const players = [...roomView.public.players].sort((a, b) => a.seat - b.seat);
  const assignments = new Map(
    (roomView.public.revealedAssignments ?? []).map((assignment) => [
      assignment.playerId,
      assignment,
    ]),
  );
  const names = new Map(
    players.map((player) => [player.playerId, player.nickname]),
  );
  return (
    <PageShell
      title={
        outcome.winner === 'GOOD'
          ? '善良方获胜'
          : outcome.winner === 'EVIL'
            ? '邪恶方获胜'
            : '对局中止'
      }
      subtitle={REASONS[outcome.reason] ?? '对局已经结束。'}
    >
      <View className="card">
        <View className="row">
          <Text>成功任务 {roomView.public.successCount}</Text>
          <View className="spacer" />
          <Text>失败任务 {roomView.public.failureCount}</Text>
        </View>
        {outcome.assassinationTargetPlayerId == null ? null : (
          <View className="progress">
            刺杀目标：
            {names.get(outcome.assassinationTargetPlayerId) ?? '同桌玩家'}
          </View>
        )}
      </View>
      {outcome.reason === 'ABORTED' ? null : (
        <View className="card">
          <Text className="section-title">身份揭晓</Text>
          {players.map((player) => {
            const assignment = assignments.get(player.playerId);
            const role = rolePresentation(assignment?.roleId);
            return (
              <View className="player" key={player.playerId}>
                <Text>
                  {player.seat + 1} 号 · {player.nickname}
                </Text>
                <View className="spacer" />
                <Text>{role?.label ?? '未知'}</Text>
                <Text className="badge">
                  {assignment?.alignment === 'GOOD' ? '善良' : '邪恶'}
                </Text>
              </View>
            );
          })}
        </View>
      )}
      <View className="card">
        <Text className="section-title">任务记录</Text>
        {roomView.public.questHistory.map((quest) => (
          <View className="subtitle" key={quest.questIndex}>
            任务 {quest.questIndex}：
            {quest.result === 'SUCCESS' ? '成功' : '失败'}（成功{' '}
            {quest.successChoices} / 失败 {quest.failChoices}）
          </View>
        ))}
      </View>
      <Button
        className="button"
        onClick={() =>
          void forgetSession().then(() =>
            Taro.reLaunch({ url: '/pages/index/index' }),
          )
        }
      >
        清理本机结果并返回首页
      </Button>
    </PageShell>
  );
}
