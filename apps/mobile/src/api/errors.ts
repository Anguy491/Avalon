import type { ErrorCode } from '@avalon/protocol';

import { ApiError } from './client';

const localized: Record<ErrorCode, string> = {
  INVALID_ROOM_CODE: '房间号无效或房间已过期，请检查后重试。',
  ROOM_FULL: '房间人数已满，请联系同桌玩家。',
  ROOM_NOT_JOINABLE: '对局已经开始，当前不能加入。',
  ROOM_EXPIRED: '房间已经过期，请让房主重新创建。',
  SESSION_INVALID: '会话已失效，请返回首页重新加入。',
  NICKNAME_CONFLICT: '这个昵称已被使用，请换一个。',
  INVALID_NICKNAME: '昵称需为 1–16 个可见字符。',
  NOT_HOST: '只有房主可以执行此操作。',
  NOT_LEADER: '当前只有队长可以执行此操作。',
  NOT_ASSASSIN: '当前只有刺客可以执行此操作。',
  INVALID_PHASE: '当前阶段不能执行此操作。',
  INVALID_PHASE_STAGE: '当前阶段步骤不能执行此操作。',
  PHASE_HELD: '请等待房主继续。',
  STALE_VERSION: '房间状态已更新，正在同步最新状态。',
  DUPLICATE_COMMAND_CONFLICT: '请求已变化，请重试。',
  INVALID_CONFIG: '人数与角色配置不匹配。',
  INVALID_SEAT_ORDER: '座次设置无效。',
  INVALID_TEAM_SIZE: '队伍人数不符合本轮规则。',
  INVALID_TEAM_MEMBER: '队伍中包含无效玩家。',
  INVALID_VOTE: '投票选项无效。',
  INVALID_TARGET: '选择的目标无效。',
  PLAYER_NOT_ON_TEAM: '你不在本次任务队伍中。',
  GOOD_CANNOT_FAIL: '善良阵营不能让任务失败。',
  ALREADY_SUBMITTED: '你已经提交过本轮操作。',
  HOST_CANNOT_LEAVE: '房主不能直接离开大厅。',
  PLAYERS_NOT_READY: '仍有玩家尚未准备。',
  PLAYERS_OFFLINE: '仍有玩家离线。',
  AUDIO_CUE_NOT_FOUND: '当前没有可重播的提示。',
  INVALID_PAUSE_REASON: '暂停原因包含不支持的字符，请修改后重试。',
  UPGRADE_REQUIRED: '应用版本过旧，请升级后继续。',
  RATE_LIMITED: '尝试次数过多，请稍后再试。',
  VALIDATION_ERROR: '输入内容无效，请检查后重试。',
  PAYLOAD_TOO_LARGE: '提交内容过大。',
  UNAUTHORIZED: '会话验证失败，请重新加入。',
  INTERNAL_ERROR: '暂时无法连接服务，请检查网络后重试。',
};

export function userFacingError(error: unknown): string {
  return error instanceof ApiError
    ? (localized[error.detail.code] ?? '请求失败，请稍后重试。')
    : (localized.INTERNAL_ERROR ?? '暂时无法连接服务。');
}

export function isInvalidSession(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.detail.code === 'SESSION_INVALID' ||
      error.detail.code === 'ROOM_EXPIRED' ||
      error.detail.code === 'UNAUTHORIZED')
  );
}
