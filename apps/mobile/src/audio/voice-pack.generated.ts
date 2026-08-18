/* eslint-disable @typescript-eslint/no-require-imports -- Expo local assets require static require() calls. */
import type { AudioSource } from 'expo-audio';

export const VOICE_PACK_VERSION = 'zh-CN-v1' as const;
export const VOICE_PACK_READY: boolean = true;

export const VOICE_PACK_ENTRIES = {
  'game.role.reveal': { subtitle: '请各位玩家查看并确认自己的身份。' },
  'game.team.proposal': { subtitle: '请队长提出本次任务队伍。' },
  'game.team.vote': { subtitle: '请所有玩家秘密提交同意或否决。' },
  'game.team.approved': { subtitle: '队伍已通过，准备执行任务。' },
  'game.team.rejected': { subtitle: '队伍未通过，队长顺位轮换。' },
  'game.quest.submission': { subtitle: '请任务队员秘密提交任务行动。' },
  'game.quest.success': { subtitle: '本次任务成功。' },
  'game.quest.failure': { subtitle: '本次任务失败。' },
  'game.assassination': { subtitle: '三次任务成功，请刺客选择梅林。' },
  'game.good.wins': { subtitle: '善方获得最终胜利。' },
  'game.evil.wins': { subtitle: '邪恶方获得最终胜利。' },
  'game.aborted': { subtitle: '恢复时间已结束，本局已中止。' },
} as const;

export type VoicePackKey = keyof typeof VOICE_PACK_ENTRIES;

const AUDIO_SOURCES: Partial<Record<VoicePackKey, AudioSource>> = {
  'game.role.reveal':
    require('../../assets/audio/zh-CN-v1/game-role-reveal.mp3') as number,
  'game.team.proposal':
    require('../../assets/audio/zh-CN-v1/game-team-proposal.mp3') as number,
  'game.team.vote':
    require('../../assets/audio/zh-CN-v1/game-team-vote.mp3') as number,
  'game.team.approved':
    require('../../assets/audio/zh-CN-v1/game-team-approved.mp3') as number,
  'game.team.rejected':
    require('../../assets/audio/zh-CN-v1/game-team-rejected.mp3') as number,
  'game.quest.submission':
    require('../../assets/audio/zh-CN-v1/game-quest-submission.mp3') as number,
  'game.quest.success':
    require('../../assets/audio/zh-CN-v1/game-quest-success.mp3') as number,
  'game.quest.failure':
    require('../../assets/audio/zh-CN-v1/game-quest-failure.mp3') as number,
  'game.assassination':
    require('../../assets/audio/zh-CN-v1/game-assassination.mp3') as number,
  'game.good.wins':
    require('../../assets/audio/zh-CN-v1/game-good-wins.mp3') as number,
  'game.evil.wins':
    require('../../assets/audio/zh-CN-v1/game-evil-wins.mp3') as number,
  'game.aborted':
    require('../../assets/audio/zh-CN-v1/game-aborted.mp3') as number,
};

export function audioSourceFor(key: VoicePackKey): AudioSource | undefined {
  return AUDIO_SOURCES[key];
}

export function supportedVoicePackVersions(): readonly string[] {
  // Subtitle fallback supports the rules flow even before audio is approved.
  return [VOICE_PACK_VERSION];
}
