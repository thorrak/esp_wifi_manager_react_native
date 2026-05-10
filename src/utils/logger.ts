export type LogLevel = 'debug' | 'info' | 'warn' | 'error' | 'none';

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};

declare const __DEV__: boolean | undefined;

// Jest / Node test runs don't set the React Native `__DEV__` global, so
// guard the access. Defaults to 'warn' in any non-RN context.
let currentLevel: LogLevel =
  typeof __DEV__ !== 'undefined' && __DEV__ ? 'debug' : 'warn';

export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

export function createLogger(tag: string) {
  const prefix = `[esp-wifi-mgr:${tag}]`;

  return {
    debug: (...args: unknown[]) => {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.debug) {
        console.debug(prefix, ...args);
      }
    },
    info: (...args: unknown[]) => {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.info) {
        console.info(prefix, ...args);
      }
    },
    warn: (...args: unknown[]) => {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.warn) {
        console.warn(prefix, ...args);
      }
    },
    error: (...args: unknown[]) => {
      if (LOG_LEVELS[currentLevel] <= LOG_LEVELS.error) {
        console.error(prefix, ...args);
      }
    },
  };
}
