import type { CommandName } from '../types/protocol';

/** Default timeout for commands (ms) */
export const DEFAULT_COMMAND_TIMEOUT_MS = 8000;

/** Per-command timeout overrides (ms) */
export const COMMAND_TIMEOUTS: Partial<Record<CommandName, number>> = {
  scan: 15000, // WiFi scan blocks 3-5s on device, allow extra margin
};
