import { CLIENT_ROLE_IDS } from '@avalon/client-core';
import {
  ErrorCodeSchema,
  GameOutcomeReasonSchema,
  GamePhaseSchema,
  WinnerSchema,
} from '@avalon/protocol';
import { describe, expect, it } from 'vitest';

import { ERROR_MESSAGE_KEYS } from '../api/error-messages';
import {
  ALIGNMENT_KEYS,
  KNOWLEDGE_LABEL_KEYS,
  OUTCOME_REASON_KEYS,
  PHASE_KEYS,
  ROLE_ABILITY_KEYS,
  ROLE_NAME_KEYS,
  WINNER_KEYS,
} from './game-messages';
import { enMessages, zhCNMessages, type MessageKey } from './messages';

function literalValues(schema: unknown): readonly string[] {
  return (
    schema as { readonly anyOf: readonly { readonly const: string }[] }
  ).anyOf.map((entry) => entry.const);
}

function expectCompleteMapping(
  mapping: Readonly<Record<string, MessageKey>>,
  values: readonly string[],
) {
  expect(Object.keys(mapping).sort()).toEqual([...values].sort());
  for (const messageKey of Object.values(mapping)) {
    expect(zhCNMessages[messageKey]).toBeDefined();
    expect(enMessages[messageKey]).toBeDefined();
  }
}

describe('AC-020 localized semantic mappings', () => {
  it('covers every protocol error code', () => {
    expectCompleteMapping(ERROR_MESSAGE_KEYS, literalValues(ErrorCodeSchema));
  });

  it('covers every role, alignment, knowledge label, phase, outcome, and winner', () => {
    expectCompleteMapping(ROLE_NAME_KEYS, CLIENT_ROLE_IDS);
    expectCompleteMapping(ROLE_ABILITY_KEYS, CLIENT_ROLE_IDS);
    expectCompleteMapping(ALIGNMENT_KEYS, ['GOOD', 'EVIL']);
    expectCompleteMapping(KNOWLEDGE_LABEL_KEYS, [
      'EVIL_PLAYER',
      'MERLIN_CANDIDATE',
      'KNOWN_EVIL_ALLY',
    ]);
    expectCompleteMapping(PHASE_KEYS, literalValues(GamePhaseSchema));
    expectCompleteMapping(
      OUTCOME_REASON_KEYS,
      literalValues(GameOutcomeReasonSchema),
    );
    expectCompleteMapping(WINNER_KEYS, literalValues(WinnerSchema));
  });
});
