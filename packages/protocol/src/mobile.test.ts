import { describe, expect, it } from 'vitest';

import { roomViewForRole, UUIDS } from './contract-fixtures.js';
import {
  isErrorResponse,
  isReadRoomViewResponse,
  isRoomViewMessage,
  isAudioTelemetry,
  isServerMaintenance,
  isSessionPing,
  isSessionPong,
  isSessionRevoked,
  isSessionBootstrap,
  isSessionReady,
  isTerminalViewAckResult,
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
    expect(isTerminalViewAckResult({ accepted: true })).toBe(true);
    expect(isSessionPing({ protocolVersion: 1 })).toBe(true);
    expect(
      isSessionPong({
        protocolVersion: 1,
        serverTime: '2026-08-13T12:00:00.000Z',
        sessionExpiresAt: '2026-08-13T12:30:00.000Z',
      }),
    ).toBe(true);
    expect(
      isSessionRevoked({
        protocolVersion: 1,
        reason: 'SESSION_REPLACED',
        diagnosticId: 'diagnostic-1234',
      }),
    ).toBe(true);
    expect(
      isServerMaintenance({
        protocolVersion: 1,
        startsAt: '2026-08-13T12:00:00.000Z',
        retryAfterMs: 1_000,
        diagnosticId: 'diagnostic-1234',
      }),
    ).toBe(true);
    expect(
      isAudioTelemetry({
        protocolVersion: 1,
        category: 'LOAD_FAILED',
        platform: 'ios',
        appVersion: '1.0.0',
        voicePackVersion: 'zh-CN-v1',
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
    expect(
      isTerminalViewAckResult({ accepted: true, unexpected: 'secret' }),
    ).toBe(false);
    expect(isSessionPing({ protocolVersion: 1, clientTime: 'untrusted' })).toBe(
      false,
    );
    expect(
      isAudioTelemetry({
        protocolVersion: 1,
        category: 'LOAD_FAILED',
        platform: 'ios',
        appVersion: '1.0.0',
        voicePackVersion: 'zh-CN-v1',
        roomId: UUIDS.room,
      }),
    ).toBe(false);
  });
});
