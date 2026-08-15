import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import {
  MeterProvider,
  PeriodicExportingMetricReader,
} from '@opentelemetry/sdk-metrics';

import type { ServerConfig } from './config.js';

type Outcome = 'accepted' | 'rejected' | 'error';

export interface MetricsPort {
  recordHttp(
    operation: 'create' | 'join',
    durationMs: number,
    outcome: Outcome,
  ): void;
  recordHandshake(durationMs: number, outcome: Outcome): void;
  changeConnections(delta: 1 | -1): void;
  recordCommand(
    commandType: string,
    durationMs: number,
    outcome: Outcome,
  ): void;
  recordProjection(durationMs: number, outcome: Outcome): void;
  recordProjectionRecipientMismatch(): void;
  recordVersionConflict(): void;
  recordOutboxAge(ageMs: number): void;
  recordPause(): void;
  recordAudioError(category: string): void;
  recordTerminalCleanup(delayMs: number, trigger: string): void;
  recordGameEnd(reason: string): void;
  shutdown(): Promise<void>;
}

export function createMetricsPort(
  config: Pick<ServerConfig, 'otlpMetricsEndpoint'>,
): MetricsPort {
  const readers =
    config.otlpMetricsEndpoint === undefined
      ? []
      : [
          new PeriodicExportingMetricReader({
            exporter: new OTLPMetricExporter({
              url: config.otlpMetricsEndpoint,
            }),
            exportIntervalMillis: 15_000,
            exportTimeoutMillis: 5_000,
            cardinalityLimits: { default: 64 },
          }),
        ];
  const provider = new MeterProvider({ readers });
  const meter = provider.getMeter('avalon-server', '1');
  const httpDuration = meter.createHistogram('avalon_http_duration_ms');
  const handshakeDuration = meter.createHistogram(
    'avalon_realtime_handshake_duration_ms',
  );
  const activeConnections = meter.createUpDownCounter(
    'avalon_realtime_active_connections',
  );
  const commandDuration = meter.createHistogram('avalon_command_duration_ms');
  const projectionDuration = meter.createHistogram(
    'avalon_projection_duration_ms',
  );
  const projectionRecipientMismatches = meter.createCounter(
    'avalon_projection_recipient_mismatch_total',
  );
  const versionConflicts = meter.createCounter(
    'avalon_command_version_conflicts_total',
  );
  const outboxAge = meter.createHistogram('avalon_outbox_age_ms');
  const pauses = meter.createCounter('avalon_pauses_total');
  const audioErrors = meter.createCounter('avalon_audio_errors_total');
  const terminalCleanup = meter.createHistogram(
    'avalon_terminal_cleanup_delay_ms',
  );
  const gameEnds = meter.createCounter('avalon_game_ends_total');

  return {
    recordHttp(operation, durationMs, outcome) {
      httpDuration.record(durationMs, { operation, outcome });
    },
    recordHandshake(durationMs, outcome) {
      handshakeDuration.record(durationMs, { outcome });
    },
    changeConnections(delta) {
      activeConnections.add(delta);
    },
    recordCommand(commandType, durationMs, outcome) {
      commandDuration.record(durationMs, {
        command_type: commandType,
        outcome,
      });
    },
    recordProjection(durationMs, outcome) {
      projectionDuration.record(durationMs, { outcome });
    },
    recordProjectionRecipientMismatch() {
      projectionRecipientMismatches.add(1);
    },
    recordVersionConflict() {
      versionConflicts.add(1);
    },
    recordOutboxAge(ageMs) {
      outboxAge.record(ageMs);
    },
    recordPause() {
      pauses.add(1);
    },
    recordAudioError(category) {
      audioErrors.add(1, { category });
    },
    recordTerminalCleanup(delayMs, trigger) {
      terminalCleanup.record(delayMs, { trigger });
    },
    recordGameEnd(reason) {
      gameEnds.add(1, { reason });
    },
    shutdown: () => provider.shutdown(),
  };
}
