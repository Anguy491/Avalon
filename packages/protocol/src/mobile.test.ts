import { describe, expect, it } from 'vitest';

import { roomViewForRole, UUIDS } from './contract-fixtures.js';
import {
  isErrorResponse,
  isReadRoomViewResponse,
  isRoomViewMessage,
  isSessionBootstrap,
  isSessionReady,
} from './mobile.js';

const roomView = roomViewForRole('MERLIN');

describe('M2 mobile-safe protocol boundary', () => {
  it('accepts each supported HTTP and realtime response shape', () => {
    expect(
      isSessionBootstrap({
        protocolVersion: 1,
        roomCode: roomView.public.roomCode,
        playerId: roomView.private.playerId,
        sessionToken: 'abcdefghijklmnopqrstuvwxyz',
        sessionExpiresAt: '2026-08-13T12:00:00.000Z',
        realtimeUrl: 'wss://example.invalid/game-v1',
        roomView,
      }),
    ).toBe(true);
    expect(isReadRoomViewResponse({ protocolVersion: 1, roomView })).toBe(true);
    expect(
      isErrorResponse({
        error: {
          code: 'ROOM_FULL',
          diagnosticId: 'diagnostic-1234',
          retryable: false,
        },
      }),
    ).toBe(true);
    expect(
      isSessionReady({
        protocolVersion: 1,
        delivery: 'RESYNC',
        roomView,
      }),
    ).toBe(true);
    expect(
      isRoomViewMessage({
        protocolVersion: 1,
        delivery: 'LIVE',
        eventId: UUIDS.event,
        roomView: {
          ...roomView,
          private: { ...roomView.private, shouldPlayAudio: true },
        },
      }),
    ).toBe(true);
  });

  it('rejects drift, extra fields, and audible RESYNC payloads', () => {
    expect(
      isReadRoomViewResponse({
        protocolVersion: 1,
        roomView: {
          ...roomView,
          public: { ...roomView.public, stateVersion: -1 },
        },
      }),
    ).toBe(false);
    expect(
      isErrorResponse({
        error: {
          code: 'ROOM_FULL',
          diagnosticId: 'diagnostic-1234',
          retryable: false,
          secret: 'must-not-pass',
        },
      }),
    ).toBe(false);
    expect(
      isSessionReady({
        protocolVersion: 1,
        delivery: 'RESYNC',
        roomView: {
          ...roomView,
          private: { ...roomView.private, shouldPlayAudio: true },
        },
      }),
    ).toBe(false);
  });
});
