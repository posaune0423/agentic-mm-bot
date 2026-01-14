/**
 * Define log levels
 * Can be controlled by environment variable `LOG_LEVEL`.
 * Examples: LOG_LEVEL=DEBUG, LOG_LEVEL=INFO, LOG_LEVEL=WARN, LOG_LEVEL=ERROR
 *
 * Priority: ERROR > WARN > INFO > DEBUG > LOG
 * Only logs at or above the set level will be output
 */

export enum LogLevel {
  ERROR = "ERROR",
  WARN = "WARN",
  INFO = "INFO",
  DEBUG = "DEBUG",
  LOG = "LOG",
}

export type LogRecord = {
  tsMs: number;
  level: LogLevel;
  message: string;
  fields?: Record<string, string>;
};

export interface LogSink {
  write(record: LogRecord): void;
}

// Define log level priority (lower number = higher priority)
const LOG_LEVEL_PRIORITY = {
  [LogLevel.ERROR]: 0,
  [LogLevel.WARN]: 1,
  [LogLevel.LOG]: 2,
  [LogLevel.INFO]: 3,
  [LogLevel.DEBUG]: 4,
} as const;

const getTimestamp = () => {
  return new Date().toISOString();
};

const getCurrentLogLevel = (): LogLevel => {
  const envLevel = process.env.LOG_LEVEL?.toUpperCase();

  if (envLevel && Object.values(LogLevel).includes(envLevel as LogLevel)) {
    return envLevel as LogLevel;
  }

  // Default is INFO
  return LogLevel.INFO;
};

// Check if a log at the specified level should be output
const shouldLog = (level: LogLevel): boolean => {
  const currentLevel = getCurrentLogLevel();
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
};

const colorize = (message: string, level: LogLevel): string => {
  const colors = {
    [LogLevel.ERROR]: "\x1b[31m", // Red
    [LogLevel.WARN]: "\x1b[33m", // Yellow
    [LogLevel.INFO]: "\x1b[36m", // Cyan
    [LogLevel.DEBUG]: "\x1b[32m", // Green
    [LogLevel.LOG]: null, // No color (standard)
  };

  const reset = "\x1b[0m";
  const color = colors[level];

  if (color === null) {
    return message; // No color for LOG
  }

  return `${color}${message}${reset}`;
};

const formatHeader = (level: LogLevel): string => {
  const timestamp = `[${getTimestamp()}]`;
  const levelTag = `[${level}]`;
  return colorize(`${timestamp} ${levelTag}`, level);
};

let sink: LogSink | null = null;

function toFields(args: unknown[]): Record<string, string> | undefined {
  // Common case in this codebase: logger.info("msg", { ...fields })
  const maybeFields = args[1];
  if (maybeFields && typeof maybeFields === "object" && !(maybeFields instanceof Error)) {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(maybeFields as Record<string, unknown>)) {
      out[k] = typeof v === "string" ? v : JSON.stringify(v);
    }
    return Object.keys(out).length > 0 ? out : undefined;
  }
  return undefined;
}

function toMessage(args: unknown[]): string {
  if (args.length === 0) return "";
  const [first, ...rest] = args;

  const head =
    typeof first === "string" ? first
    : first instanceof Error ? first.message
    : JSON.stringify(first);

  if (rest.length === 0) return head;

  // Avoid duplicating the common fields object in the message; store it in `fields`.
  const tail =
    rest.length >= 1 && rest[0] && typeof rest[0] === "object" && !(rest[0] instanceof Error) ? rest.slice(1) : rest;

  if (tail.length === 0) return head;

  return `${head} ${tail
    .map(a =>
      typeof a === "string" ? a
      : a instanceof Error ? a.message
      : JSON.stringify(a),
    )
    .join(" ")}`.trim();
}

function emit(level: LogLevel, args: unknown[], consoleFn: (...a: unknown[]) => void): void {
  if (!shouldLog(level)) return;

  const record: LogRecord = {
    tsMs: Date.now(),
    level,
    message: toMessage(args),
    fields: toFields(args),
  };

  if (sink) {
    sink.write(record);
    return;
  }

  const header = formatHeader(level);
  consoleFn(header, ...args);
}

export const logger = {
  log: (...args: unknown[]) => {
    emit(LogLevel.LOG, args, console.log);
  },
  info: (...args: unknown[]) => {
    emit(LogLevel.INFO, args, console.info);
  },
  debug: (...args: unknown[]) => {
    emit(LogLevel.DEBUG, args, console.log);
  },
  warn: (...args: unknown[]) => {
    emit(LogLevel.WARN, args, console.warn);
  },
  error: (...args: unknown[]) => {
    emit(LogLevel.ERROR, args, console.error);
  },
  /**
   * Get the currently set log level
   */
  getCurrentLevel: (): LogLevel => getCurrentLogLevel(),
  /**
   * Get list of available log levels
   */
  getLevels: () => Object.values(LogLevel),
  /**
   * Route logs to a custom sink (e.g., CLI dashboard).
   *
   * When a sink is set, logs are sent to it instead of printing to console,
   * except ERROR logs which still print to stderr for debugging.
   */
  setSink: (next: LogSink) => {
    sink = next;
  },
  /**
   * Restore default console logging.
   */
  clearSink: () => {
    sink = null;
  },
};
