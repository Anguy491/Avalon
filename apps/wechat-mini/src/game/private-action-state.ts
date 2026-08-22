export type PrivateAction = 'TEAM_VOTE' | 'QUEST' | 'PAUSE_TERMINATION';

export interface PrivateActionState {
  readonly action?: PrivateAction;
  readonly choice?: string;
}

export type PrivateActionEvent =
  | { readonly type: 'OPEN'; readonly action: PrivateAction }
  | { readonly type: 'SELECT'; readonly choice: string }
  | { readonly type: 'RESET' };

export const EMPTY_PRIVATE_ACTION: PrivateActionState = {};

export function privateActionReducer(
  state: PrivateActionState,
  event: PrivateActionEvent,
): PrivateActionState {
  if (event.type === 'RESET') return EMPTY_PRIVATE_ACTION;
  if (event.type === 'OPEN') return { action: event.action };
  if (state.action === undefined) return EMPTY_PRIVATE_ACTION;
  return { action: state.action, choice: event.choice };
}
