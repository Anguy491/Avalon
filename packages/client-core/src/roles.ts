import type { RoomView } from '@avalon/protocol/mobile';

export type ClientRoleId = Exclude<
  RoomView['private']['selfRole'],
  null | undefined
>;

export const CLIENT_ROLE_IDS = [
  'MERLIN',
  'PERCIVAL',
  'LOYAL_SERVANT',
  'ASSASSIN',
  'MINION',
  'MORGANA',
  'MORDRED',
  'OBERON',
] as const satisfies readonly ClientRoleId[];

export const ROLE_PRESENTATION: Readonly<
  Record<
    ClientRoleId,
    {
      readonly label: string;
      readonly ability: string;
      readonly guide: readonly string[];
    }
  >
> = {
  MERLIN: {
    label: '梅林',
    ability: '你知道除莫德雷德外的邪恶玩家。保护自己的身份，避免被刺客识破。',
    guide: [
      '用公开逻辑引导队伍，不要过早断言某人一定是邪恶。',
      '让派西维尔能够理解方向，同时避免给刺客确定信号。',
    ],
  },
  PERCIVAL: {
    label: '派西维尔',
    ability: '你会看到不可区分的梅林候选人；莫甘娜在场时会混入候选名单。',
    guide: [
      '首要目标是保护梅林，而不是公开证明谁是莫甘娜。',
      '观察候选人的发言与正确方向，但不要直接暴露关注对象。',
    ],
  },
  LOYAL_SERVANT: {
    label: '忠臣',
    ability: '你没有额外的开局信息。通过讨论、组队与投票协助善良阵营。',
    guide: [
      '结合公开投票和任务结果复盘关系。',
      '信息不足时表达概率判断，避免无依据地锁定单一玩家。',
    ],
  },
  ASSASSIN: {
    label: '刺客',
    ability: '善良阵营完成三次任务后，你将选择刺杀目标。',
    guide: [
      '持续记录谁能稳定给出正确方向又在隐藏信息来源。',
      '重点观察派西维尔最关注的候选人。',
    ],
  },
  MINION: {
    label: '爪牙',
    ability: '你属于邪恶阵营，并会看到规则允许你知道的邪恶同伴。',
    guide: [
      '避免与同伴过度互保。',
      '同一任务中协调失败票，减少重复失败带来的信息暴露。',
    ],
  },
  MORGANA: {
    label: '莫甘娜',
    ability: '你会被梅林看到，并在派西维尔眼中伪装成梅林候选人。',
    guide: [
      '尝试以梅林视角提供有弹性的判断。',
      '从派西维尔的关注与回应中寻找真正的梅林。',
    ],
  },
  MORDRED: {
    label: '莫德雷德',
    ability: '你属于邪恶阵营；梅林无法在开局知识中看到你。',
    guide: [
      '利用梅林看不到你的优势建立可信度。',
      '保持积极且连贯的好人视角推理。',
    ],
  },
  OBERON: {
    label: '奥伯伦',
    ability: '你属于邪恶阵营，但不会获得其他邪恶玩家的同伴信息。',
    guide: [
      '通过组队、投票和任务结果判断潜在同伴。',
      '不要假设其他邪恶玩家已经认出你。',
    ],
  },
};

export function rolePresentation(role: ClientRoleId | null | undefined) {
  return role == null ? undefined : ROLE_PRESENTATION[role];
}
