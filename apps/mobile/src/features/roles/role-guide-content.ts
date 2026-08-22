import type { RoleId } from './role-reveal-state';
import type { MessageKey } from '@/localization/messages';

export interface RoleGuide {
  readonly title: MessageKey;
  readonly summary: MessageKey;
  readonly tips: readonly MessageKey[];
}

export const ROLE_GUIDES: Readonly<Record<RoleId, RoleGuide>> = {
  MERLIN: {
    title: 'guideMerlinTitle',
    summary: 'guideMerlinSummary',
    tips: [
      'guideMerlinTip1',
      'guideMerlinTip2',
      'guideMerlinTip3',
      'guideMerlinTip4',
    ],
  },
  PERCIVAL: {
    title: 'guidePercivalTitle',
    summary: 'guidePercivalSummary',
    tips: [
      'guidePercivalTip1',
      'guidePercivalTip2',
      'guidePercivalTip3',
      'guidePercivalTip4',
    ],
  },
  LOYAL_SERVANT: {
    title: 'guideLoyalTitle',
    summary: 'guideLoyalSummary',
    tips: [
      'guideLoyalTip1',
      'guideLoyalTip2',
      'guideLoyalTip3',
      'guideLoyalTip4',
      'guideLoyalTip5',
    ],
  },
  MORDRED: {
    title: 'guideMordredTitle',
    summary: 'guideMordredSummary',
    tips: ['guideMordredTip1', 'guideMordredTip2', 'guideMordredTip3'],
  },
  MORGANA: {
    title: 'guideMorganaTitle',
    summary: 'guideMorganaSummary',
    tips: ['guideMorganaTip1', 'guideMorganaTip2', 'guideMorganaTip3'],
  },
  OBERON: {
    title: 'guideOberonTitle',
    summary: 'guideOberonSummary',
    tips: [
      'guideOberonTip1',
      'guideOberonTip2',
      'guideOberonTip3',
      'guideOberonTip4',
    ],
  },
  ASSASSIN: {
    title: 'guideAssassinTitle',
    summary: 'guideAssassinSummary',
    tips: ['guideAssassinTip1', 'guideAssassinTip2', 'guideAssassinTip3'],
  },
  MINION: {
    title: 'guideMinionTitle',
    summary: 'guideMinionSummary',
    tips: [
      'guideMinionTip1',
      'guideMinionTip2',
      'guideMinionTip3',
      'guideMinionTip4',
    ],
  },
};

export function roleGuideFor(
  roleId: RoleId | null | undefined,
): RoleGuide | undefined {
  return roleId == null ? undefined : ROLE_GUIDES[roleId];
}
