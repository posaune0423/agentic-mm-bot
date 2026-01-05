export const LOG_LEVELS = ["ERROR", "WARN", "LOG", "INFO", "DEBUG"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

// Define log level priority (lower number = higher priority)
const LOG_LEVEL_PRIORITY = {
  ERROR: 0,
  WARN: 1,
  LOG: 2,
  INFO: 3,
  DEBUG: 4,
} as const;

const getTimestamp = () => {
  return new Date().toISOString();
};

type LoggerConfig = Readonly<{
  level: LogLevel;
}>;

let loggerConfig: LoggerConfig = { level: "INFO" };

/**
 * Initialize logger configuration at app startup.
 *
 * Important:
 * - This should be called with a validated log level (e.g. via env.ts/@t3-oss/env-core)
 * - The logger does not read `process.env` directly; config is stored once and reused.
 */
export function initLogger(config: LoggerConfig): void {
  loggerConfig = config;
}

const getCurrentLevel = (): LogLevel => loggerConfig.level;

// Check if a log at the specified level should be output
const shouldLog = (level: LogLevel): boolean => {
  const currentLevel = getCurrentLevel();
  return LOG_LEVEL_PRIORITY[level] <= LOG_LEVEL_PRIORITY[currentLevel];
};

const colorize = (message: string, level: LogLevel): string => {
  const colors = {
    ERROR: "\x1b[31m", // Red
    WARN: "\x1b[33m", // Yellow
    INFO: "\x1b[36m", // Cyan
    DEBUG: "\x1b[32m", // Green
    LOG: null, // No color (standard)
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

export const logger = {
  log: (...args: unknown[]) => {
    if (!shouldLog("LOG")) return;
    const header = formatHeader("LOG");
    console.log(header, ...args);
  },
  info: (...args: unknown[]) => {
    if (!shouldLog("INFO")) return;
    const header = formatHeader("INFO");
    console.info(header, ...args);
  },
  debug: (...args: unknown[]) => {
    if (!shouldLog("DEBUG")) return;
    const header = formatHeader("DEBUG");
    console.log(header, ...args);
  },
  warn: (...args: unknown[]) => {
    if (!shouldLog("WARN")) return;
    const header = formatHeader("WARN");
    console.warn(header, ...args);
  },
  error: (...args: unknown[]) => {
    if (!shouldLog("ERROR")) return;
    const header = formatHeader("ERROR");
    console.error(header, ...args);
  },
  /**
   * Get the currently set log level
   */
  getCurrentLevel: (): LogLevel => getCurrentLevel(),
  /**
   * Get list of available log levels
   */
  getLevels: () => [...LOG_LEVELS],
};
