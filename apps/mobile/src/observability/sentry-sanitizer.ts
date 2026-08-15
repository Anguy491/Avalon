interface StackFrame {
  readonly filename?: string;
  readonly function?: string;
  readonly module?: string;
  readonly lineno?: number;
  readonly colno?: number;
  readonly in_app?: boolean;
  readonly [key: string]: unknown;
}

export interface SanitizableSentryEvent {
  readonly event_id?: string;
  readonly timestamp?: number;
  readonly platform?: string;
  readonly level?: string;
  readonly release?: string;
  readonly dist?: string;
  readonly environment?: string;
  readonly contexts?: Readonly<Record<string, unknown>>;
  readonly exception?: {
    readonly values?: readonly {
      readonly type?: string;
      readonly stacktrace?: { readonly frames?: readonly StackFrame[] };
      readonly [key: string]: unknown;
    }[];
  };
  readonly [key: string]: unknown;
}

const ALLOWED_CONTEXTS = new Set(['app', 'os']);

export function sanitizeSentryEvent(
  event: SanitizableSentryEvent,
): SanitizableSentryEvent {
  const contexts = Object.fromEntries(
    Object.entries(event.contexts ?? {}).filter(([name]) =>
      ALLOWED_CONTEXTS.has(name),
    ),
  );
  const exceptionValues = event.exception?.values?.map((exception) => ({
    type: exception.type,
    stacktrace:
      exception.stacktrace === undefined
        ? undefined
        : {
            frames: exception.stacktrace.frames?.map((frame) => ({
              filename: frame.filename,
              function: frame.function,
              module: frame.module,
              lineno: frame.lineno,
              colno: frame.colno,
              in_app: frame.in_app,
            })),
          },
  }));

  return {
    event_id: event.event_id ?? '00000000000000000000000000000000',
    timestamp: event.timestamp,
    platform: event.platform,
    level: event.level,
    release: event.release,
    dist: event.dist,
    environment: event.environment,
    contexts,
    ...(exceptionValues === undefined
      ? {}
      : { exception: { values: exceptionValues } }),
  } as unknown as SanitizableSentryEvent;
}
