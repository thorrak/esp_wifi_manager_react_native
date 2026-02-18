import type { WifiConnectionState, WifiStatus } from '../types';
import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
} from '../constants/provisioning';
import { TypedEventEmitter, createLogger } from '../utils';
import type { DeviceProtocol } from './DeviceProtocol';

// ---------------------------------------------------------------------------
// Events
// ---------------------------------------------------------------------------

export interface ConnectionPollerEvents {
  wifiStateChanged: (status: WifiStatus) => void;
  connectionSucceeded: (status: WifiStatus) => void;
  connectionFailed: () => void;
  connectionTimedOut: () => void;
  pollError: (error: Error) => void;
}

// ---------------------------------------------------------------------------
// Logger
// ---------------------------------------------------------------------------

const log = createLogger('ConnectionPoller');

// ---------------------------------------------------------------------------
// ConnectionPoller
// ---------------------------------------------------------------------------

/**
 * Polls `get_status` at a regular interval to track WiFi connection progress.
 *
 * Emits state-change events so higher layers (stores / UI) can react without
 * coupling directly to the transport or protocol details.
 */
export class ConnectionPoller extends TypedEventEmitter<ConnectionPollerEvents> {
  // -- Protocol reference ---------------------------------------------------
  private readonly protocol: DeviceProtocol;

  // -- Polling timers -------------------------------------------------------
  private pollInterval: ReturnType<typeof setInterval> | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;

  // -- Internal state -------------------------------------------------------
  private _polling = false;
  private _sawConnecting = false;
  private _connectionFailed = false;
  private _pollError: string | null = null;

  private _wifiState: WifiConnectionState = 'disconnected';
  private _wifiSsid = '';
  private _wifiIp = '';
  private _wifiRssi = 0;
  private _wifiQuality = 0;

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(protocol: DeviceProtocol) {
    super();
    this.protocol = protocol;
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Begin polling `get_status` at a fixed interval.
   *
   * If already polling this call is a no-op, preventing duplicate timers.
   */
  startPolling(
    timeoutMs: number = DEFAULT_POLL_TIMEOUT_MS,
    intervalMs: number = DEFAULT_POLL_INTERVAL_MS,
  ): void {
    if (this._polling) {
      log.debug('startPolling called while already polling — ignoring');
      return;
    }

    log.info(
      `Starting connection polling (interval=${intervalMs}ms, timeout=${timeoutMs}ms)`,
    );

    this._polling = true;
    this._connectionFailed = false;
    this._pollError = null;
    this._sawConnecting = false;

    // Set up recurring poll
    this.pollInterval = setInterval(() => {
      void this.doPoll();
    }, intervalMs);

    // Set up overall timeout
    this.timeoutTimer = setTimeout(() => {
      this.handleTimeout();
    }, timeoutMs);

    // Immediate first poll
    void this.doPoll();
  }

  /**
   * Stop all polling timers without resetting tracked state.
   */
  stopPolling(): void {
    if (this.pollInterval !== null) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
    this._polling = false;
    log.debug('Polling stopped');
  }

  /**
   * Execute a single manual poll without starting the interval loop.
   *
   * Useful for one-shot status checks (e.g. on initial connect).
   */
  async pollOnce(): Promise<WifiStatus> {
    const status = await this.protocol.getStatus();
    this.applyStatus(status);
    this.emit('wifiStateChanged', status);
    return status;
  }

  /**
   * Stop polling and reset all tracked state to defaults.
   */
  reset(): void {
    this.stopPolling();

    this._wifiState = 'disconnected';
    this._wifiSsid = '';
    this._wifiIp = '';
    this._wifiRssi = 0;
    this._wifiQuality = 0;
    this._sawConnecting = false;
    this._connectionFailed = false;
    this._pollError = null;

    log.debug('State reset to defaults');
  }

  /**
   * Tear down the poller entirely — stop timers and remove all listeners.
   */
  destroy(): void {
    this.stopPolling();
    this.removeAllListeners();
    log.debug('ConnectionPoller destroyed');
  }

  // -----------------------------------------------------------------------
  // Getters
  // -----------------------------------------------------------------------

  get wifiState(): WifiConnectionState {
    return this._wifiState;
  }

  get wifiSsid(): string {
    return this._wifiSsid;
  }

  get wifiIp(): string {
    return this._wifiIp;
  }

  get wifiRssi(): number {
    return this._wifiRssi;
  }

  get wifiQuality(): number {
    return this._wifiQuality;
  }

  get isPolling(): boolean {
    return this._polling;
  }

  get hasConnectionFailed(): boolean {
    return this._connectionFailed;
  }

  get pollError(): string | null {
    return this._pollError;
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  /**
   * Core polling function invoked on each interval tick (and once immediately).
   */
  private async doPoll(): Promise<void> {
    try {
      const status = await this.protocol.getStatus();

      // The firmware may surface the state under `state` or `wifi_state`.
      // We normalise to `state` so downstream code sees a consistent shape.
      const state: WifiConnectionState =
        status.state ?? (status as unknown as Record<string, unknown>).wifi_state as WifiConnectionState ?? 'disconnected';

      this.applyStatus(status, state);
      this.emit('wifiStateChanged', status);

      if (state === 'connecting') {
        this._sawConnecting = true;
      }

      if (state === 'connected') {
        log.info('WiFi connected', { ssid: this._wifiSsid, ip: this._wifiIp });
        this.emit('connectionSucceeded', status);
        this.stopPolling();
        return;
      }

      if (this._sawConnecting && state === 'disconnected') {
        log.warn('Connection failed — saw connecting then disconnected');
        this._connectionFailed = true;
        this.emit('connectionFailed');
        this.stopPolling();
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      this._pollError = error.message;
      log.warn('Poll error (will retry):', error.message);
      this.emit('pollError', error);
      // Intentionally do NOT stop polling — transient errors are tolerated.
    }
  }

  /**
   * Called when the overall timeout fires before a terminal state is reached.
   */
  private handleTimeout(): void {
    log.warn('Connection polling timed out');
    this.stopPolling();
    this.emit('connectionTimedOut');
  }

  /**
   * Apply a status response to internal tracked values.
   */
  private applyStatus(
    status: WifiStatus,
    stateOverride?: WifiConnectionState,
  ): void {
    this._wifiState = stateOverride ?? status.state ?? 'disconnected';
    this._wifiSsid = status.ssid ?? '';
    this._wifiIp = status.ip ?? '';
    this._wifiRssi = status.rssi ?? 0;
    this._wifiQuality = status.quality ?? 0;
  }
}
