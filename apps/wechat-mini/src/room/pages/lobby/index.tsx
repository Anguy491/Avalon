import { Button, Text, View } from '@tarojs/components';
import Taro from '@tarojs/taro';
import { useState } from 'react';

import { CLIENT_ROLE_IDS, rolePresentation } from '@avalon/client-core';
import type { RoomConfigInput, RoomView } from '@avalon/protocol/mobile';

import { PageShell } from '@/components/page-shell';
import { PlayerList } from '@/components/player-list';
import { RoomQr } from '@/components/room-qr';
import { useSession } from '@/session/session-provider';

async function confirm(title: string, content: string): Promise<boolean> {
  const result = await Taro.showModal({
    title,
    content,
    confirmText: '确认',
    cancelText: '取消',
  });
  return result.confirm;
}

export default function LobbyPage() {
  const { roomView, summary, submitCommand, pendingCommandType } = useSession();
  const [draftPlayerCount, setDraftPlayerCount] = useState<number>();
  const [customRoles, setCustomRoles] = useState<
    RoomView['public']['config']['roleIds'][number][]
  >([]);
  if (roomView === undefined || summary === undefined) {
    return (
      <PageShell title="正在恢复大厅" subtitle="正在读取服务端当前状态…" />
    );
  }
  const players = [...roomView.public.players].sort((a, b) => a.seat - b.seat);
  const self = players.find(
    (player) => player.playerId === roomView.private.playerId,
  );
  const actions = new Map(
    roomView.private.availableActions.map((action) => [
      action.commandType,
      action,
    ]),
  );
  const busy = pendingCommandType !== undefined;
  const send = (input: Parameters<typeof submitCommand>[0]) =>
    void submitCommand(input);
  const playerCount = draftPlayerCount ?? roomView.public.config.playerCount;
  const configure = (presetId: 'CLASSIC' | 'RECOMMENDED') => {
    const config: RoomConfigInput = {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount,
      roleSelection: { type: 'PRESET', presetId },
      locale: 'zh-CN',
    };
    send({ type: 'ConfigureRoom', payload: { config } });
  };
  const configureCustom = () => {
    const config: RoomConfigInput = {
      rulesVersion: 'CLASSIC_AVALON_V1',
      playerCount,
      roleSelection: { type: 'CUSTOM', roleIds: customRoles },
      locale: 'zh-CN',
    };
    send({ type: 'ConfigureRoom', payload: { config } });
  };
  const reorder = (playerId: string, delta: -1 | 1) => {
    const ids = players.map((player) => player.playerId);
    const index = ids.indexOf(playerId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= ids.length) return;
    [ids[index], ids[target]] = [ids[target] as string, ids[index] as string];
    send({ type: 'ReorderSeats', payload: { playerIds: ids } });
  };

  return (
    <PageShell title="房间大厅" subtitle="所有玩家在线并准备后，房主即可开始。">
      <View className="card">
        <View className="room-code">{summary.roomCode}</View>
        <RoomQr roomCode={summary.roomCode} />
        <View className="row-wrap">
          <Button
            className="button button-secondary button-small"
            onClick={() =>
              void Taro.setClipboardData({ data: summary.roomCode })
            }
          >
            复制房间号
          </Button>
          <Button
            className="button button-secondary button-small"
            onClick={() => {
              const audio = Taro.createInnerAudioContext();
              audio.src = '/assets/audio/zh-CN-v1/game-role-reveal.mp3';
              audio.onEnded(() => {
                audio.destroy();
              });
              audio.play();
            }}
          >
            测试主持语音
          </Button>
        </View>
      </View>

      <Text className="section-title">
        玩家 {players.length}/{roomView.public.config.playerCount}
      </Text>
      <PlayerList players={players} selfPlayerId={roomView.private.playerId} />

      {self?.isHost === true && actions.has('ReorderSeats') ? (
        <View className="card">
          <Text className="section-title">调整座次</Text>
          {players.map((player, index) => (
            <View className="player" key={player.playerId}>
              <Text>
                {player.seat + 1} 号 · {player.nickname}
              </Text>
              <View className="spacer" />
              <Button
                className="button button-secondary button-small"
                disabled={index === 0 || busy}
                onClick={() => {
                  reorder(player.playerId, -1);
                }}
              >
                上移
              </Button>
              <Button
                className="button button-secondary button-small"
                disabled={index === players.length - 1 || busy}
                onClick={() => {
                  reorder(player.playerId, 1);
                }}
              >
                下移
              </Button>
              {actions
                .get('KickLobbyPlayer')
                ?.eligibleTargetPlayerIds?.includes(player.playerId) ===
              true ? (
                <Button
                  className="button button-danger button-small"
                  disabled={busy}
                  onClick={() =>
                    void confirm(
                      '移除玩家',
                      `确认将“${player.nickname}”移出大厅？`,
                    ).then((ok) => {
                      if (ok)
                        send({
                          type: 'KickLobbyPlayer',
                          payload: { targetPlayerId: player.playerId },
                        });
                    })
                  }
                >
                  移除
                </Button>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}

      {self?.isHost === true && actions.has('ConfigureRoom') ? (
        <View className="card">
          <Text className="section-title">角色配置</Text>
          <View className="progress">
            当前：{roomView.public.config.roleIds.join('、')}
          </View>
          <Text className="section-title">目标人数</Text>
          <View className="row-wrap">
            {Array.from({ length: 6 }, (_, index) => index + 5).map((count) => (
              <View
                className={`choice${playerCount === count ? ' choice-selected' : ''}`}
                key={count}
                onClick={() => {
                  setDraftPlayerCount(count);
                  setCustomRoles((current) => current.slice(0, count));
                }}
              >
                {count} 人
              </View>
            ))}
          </View>
          <View className="row-wrap">
            <Button
              className="button button-secondary button-small"
              disabled={busy}
              onClick={() => {
                configure('CLASSIC');
              }}
            >
              基础配置
            </Button>
            <Button
              className="button button-secondary button-small"
              disabled={busy}
              onClick={() => {
                configure('RECOMMENDED');
              }}
            >
              推荐配置
            </Button>
          </View>
          <Text className="section-title">自定义角色</Text>
          <View className="progress">
            已选 {customRoles.length}/{playerCount}；最终合法性由服务器校验
          </View>
          {CLIENT_ROLE_IDS.map((roleId) => {
            const count = customRoles.filter((role) => role === roleId).length;
            return (
              <View className="player" key={roleId}>
                <Text>{rolePresentation(roleId)?.label ?? roleId}</Text>
                <View className="spacer" />
                <Text>{count}</Text>
                <Button
                  className="button button-secondary button-small"
                  disabled={busy || count === 0}
                  onClick={() => {
                    setCustomRoles((current) => {
                      const index = current.lastIndexOf(roleId);
                      return index < 0
                        ? current
                        : current.filter(
                            (_role, roleIndex) => roleIndex !== index,
                          );
                    });
                  }}
                >
                  −
                </Button>
                <Button
                  className="button button-small"
                  disabled={busy || customRoles.length >= playerCount}
                  onClick={() => {
                    setCustomRoles((current) => [...current, roleId]);
                  }}
                >
                  ＋
                </Button>
              </View>
            );
          })}
          <Button
            className="button"
            disabled={busy || customRoles.length !== playerCount}
            onClick={configureCustom}
          >
            保存自定义配置
          </Button>
        </View>
      ) : null}

      {actions.has('SetReady') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() => {
            send({
              type: 'SetReady',
              payload: { ready: self?.ready !== true },
            });
          }}
        >
          {self?.ready === true ? '取消准备' : '我已准备'}
        </Button>
      ) : null}
      {actions.has('StartGame') ? (
        <Button
          className="button"
          disabled={busy}
          onClick={() =>
            void confirm(
              '开始游戏',
              '开始后将随机分配身份，玩家不能退出或替换。',
            ).then((ok) => {
              if (ok) send({ type: 'StartGame', payload: {} });
            })
          }
        >
          开始游戏
        </Button>
      ) : null}
      {actions.has('LeaveLobby') ? (
        <Button
          className="button button-secondary"
          disabled={busy}
          onClick={() =>
            void confirm('离开大厅', '确认离开当前房间？').then((ok) => {
              if (ok) send({ type: 'LeaveLobby', payload: {} });
            })
          }
        >
          离开大厅
        </Button>
      ) : null}
      {actions.has('CloseRoom') ? (
        <Button
          className="button button-danger"
          disabled={busy}
          onClick={() =>
            void confirm('关闭房间', '房间关闭后所有玩家都会返回首页。').then(
              (ok) => {
                if (ok) send({ type: 'CloseRoom', payload: {} });
              },
            )
          }
        >
          关闭房间
        </Button>
      ) : null}
    </PageShell>
  );
}
