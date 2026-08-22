import type { MessageDescriptor } from '@/localization/localization-provider';

import { ApiError } from './client';
import { ERROR_MESSAGE_KEYS } from './error-messages';

export { ERROR_MESSAGE_KEYS } from './error-messages';

export function userFacingError(error: unknown): MessageDescriptor {
  return {
    key:
      error instanceof ApiError
        ? (ERROR_MESSAGE_KEYS[error.detail.code] ?? 'errorRequestFailed')
        : 'errorInternal',
  };
}

export function isInvalidSession(error: unknown): boolean {
  return (
    error instanceof ApiError &&
    (error.detail.code === 'SESSION_INVALID' ||
      error.detail.code === 'ROOM_EXPIRED' ||
      error.detail.code === 'UNAUTHORIZED')
  );
}
