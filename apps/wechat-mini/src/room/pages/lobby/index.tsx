import { Button, Text, View } from '@tarojs/components';
import Taro, { useDidHide } from '@tarojs/taro';
import { useEffect, useRef, useState } from 'react';

import { CLIENT_ROLE_IDS, rolePresentation } from '@avalon/client-core';
import type {
  RoomConfigInput,
  RoomConfigValidationError,
  RoomConfigValidationErrorCode,
  RoomView,
} from '@avalon/protocol/mobile';

import { PageShell } from '@/components/page-shell';
import { PlayerList } from '@/components/player-list';
import { RoomQr } from '@/components/room-qr';
import { useSession } from '@/session/session-provider';
import { validateRoomConfig } from '@/api/client';
import {
  VOICE_PACK_READY,
  voicePackEntryFor,
} from '@/audio/voice-pack.generated';

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
  const [qrOpen, setQrOpen] = useState(false);
  const [previewStatus, setPreviewStatus] = useState<
    'IDLE' | 'PLAYING' | 'FAILED'
  >('IDLE');
  const previewPlayer = useRef<Taro.InnerAudioContext>();
  const [configValidation, setConfigValidation] = useState<
    | { readonly status: 'IDLE' | 'CHECKING' | 'UNAVAILABLE' }
    | {
        readonly status: 'VALIDATED';
        readonly errors: readonly RoomConfigValidationError[];
      }
  >({ status: 'IDLE' });
  const effectivePlayerCount =
    draftPlayerCount ?? roomView?.public.config.playerCount ?? 5;
  useEffect(() => {
    const isHost = roomView?.public.players.some(
      (player) =>
        player.playerId === roomView.private.playerId && player.isHost,
    );
    if (isHost !== true) {
      setConfigValidation({ status: 'IDLE' });
      return;
    }
    let active = true;
    setConfigValidation({ status: 'CHECKING' });
    const timeout = setTimeout(() => {
      void validateRoomConfig({
        playerCount: effectivePlayerCount,
        roleIds: customRoles,
      })
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
  }, [customRoles, effectivePlayerCount, roomView]);
  const stopPreview = () => {
    previewPlayer.current?.stop();
    previewPlayer.current?.destroy();
    previewPlayer.current = undefined;
    setPreviewStatus('IDLE');
  };
  const togglePreview = () => {
    if (previewStatus === 'PLAYING') {
      stopPreview();
      return;
    }
    const preview = voicePackEntryFor('game.role.reveal');
    if (!VOICE_PACK_READY || preview === undefined) {
      setPreviewStatus('FAILED');
      return;
    }
    stopPreview();
    const audio = Taro.createInnerAudioContext();
    previewPlayer.current = audio;
    audio.src = preview.source;
    audio.volume = 0.8;
    audio.onPlay(() => {
      setPreviewStatus('PLAYING');
    });
    audio.onEnded(() => {
      if (previewPlayer.current === audio) previewPlayer.current = undefined;
      audio.destroy();
      setPreviewStatus('IDLE');
    });
    audio.onError(() => {
      if (previewPlayer.current === audio) previewPlayer.current = undefined;
      audio.destroy();
      setPreviewStatus('FAILED');
    });
    audio.play();
  };
  useDidHide(stopPreview);
  useEffect(
    () => () => {
      stopPreview();
    },
    [],
  );
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
  const playerCount = effectivePlayerCount;
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
        <View className="row-wrap">
          <Button
            className="button button-secondary button-small"
            ariaLabel="全屏显示房间二维码"
            onClick={() => {
              setQrOpen(true);
            }}
          >
            全屏二维码
          </Button>
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
            onClick={togglePreview}
          >
            {previewStatus === 'PLAYING' ? '停止主持语音' : '测试主持语音'}
          </Button>
        </View>
        <View className="subtitle">
          字幕：
          {voicePackEntryFor('game.role.reveal')?.subtitle ??
            '语音资源不可用，请根据当前阶段继续。'}
        </View>
        <View className="progress">播放状态：{previewStatus}</View>
        {previewStatus === 'FAILED' ? (
          <View className="error">音频加载失败，可继续使用字幕主持。</View>
        ) : null}
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
              <Button
                className={`choice${playerCount === count ? ' choice-selected' : ''}`}
                key={count}
                ariaLabel={`${playerCount === count ? '已选择，' : ''}${String(count)} 人`}
                onClick={() => {
                  setDraftPlayerCount(count);
                  setCustomRoles((current) => current.slice(0, count));
                }}
              >
                {count} 人
              </Button>
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
          <Button
            className="button"
            disabled={
              busy ||
              configValidation.status !== 'VALIDATED' ||
              configValidation.errors.length > 0
            }
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
      {self?.isHost === true ? (
        <View className="card">
          <Text className="section-title">开始对局</Text>
          {players.length === roomView.public.config.playerCount ? null : (
            <View className="error">
              还需 {roomView.public.config.playerCount - players.length}{' '}
              名玩家。
            </View>
          )}
          {players
            .filter((player) => !player.connected)
            .map((player) => (
              <View className="error" key={`offline-${player.playerId}`}>
                {player.nickname} 当前离线。
              </View>
            ))}
          {players
            .filter((player) => !player.ready)
            .map((player) => (
              <View className="error" key={`ready-${player.playerId}`}>
                {player.nickname} 尚未准备。
              </View>
            ))}
          <Button
            className="button"
            disabled={busy || !actions.has('StartGame')}
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
        </View>
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
      {qrOpen ? (
        <View className="qr-overlay">
          <Text className="title">扫码加入房间</Text>
          <View className="room-code">{summary.roomCode}</View>
          <RoomQr roomCode={summary.roomCode} />
          <View className="subtitle">
            请调高屏幕亮度并避免反光；扫码失败时可手动输入房间号。
          </View>
          <Button
            className="button"
            onClick={() => {
              setQrOpen(false);
            }}
          >
            关闭二维码
          </Button>
        </View>
      ) : null}
    </PageShell>
  );
}
