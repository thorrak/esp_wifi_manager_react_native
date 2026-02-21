import type {
  CommandName,
  DeviceProtocolEvents,
  DeviceProtocolConfig,
  AddNetworkParams,
  StartApParams,
  WifiStatus,
  ScanResponseData,
  ListNetworksResponseData,
  ApStatus,
  DeviceVariable,
  ResponseEnvelope,
  ResponseEnvelopeOk,
  ResponseEnvelopeError,
} from '../types';
import {
  DEFAULT_COMMAND_TIMEOUT_MS,
  COMMAND_TIMEOUTS,
} from '../constants/protocol';
import { TypedEventEmitter, createLogger } from '../utils';
import type { BleTransport } from './BleTransport';

const log = createLogger('DeviceProtocol');

/**
 * Layer 2 — JSON command/response protocol over BLE.
 *
 * Sends structured command envelopes to the device via {@link BleTransport}
 * and resolves the corresponding promise when a response arrives.
 * Only one command may be in-flight at a time.
 */
export class DeviceProtocol extends TypedEventEmitter<DeviceProtocolEvents> {
  private readonly transport: BleTransport;
  private readonly config: Required<
    Pick<DeviceProtocolConfig, 'defaultTimeoutMs'>
  > &
    Pick<DeviceProtocolConfig, 'commandTimeouts'>;

  private _busy = false;
  private pendingResolve: ((value: unknown) => void) | null = null;
  private pendingReject: ((reason: Error) => void) | null = null;
  private pendingCommand: CommandName | null = null;
  private timeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private lastCommandTime = 0;
  /** Monotonically increasing nonce to guard against stale .catch() handlers */
  private commandNonce = 0;

  constructor(transport: BleTransport, config?: DeviceProtocolConfig) {
    super();
    this.transport = transport;
    this.config = {
      defaultTimeoutMs:
        config?.defaultTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
      commandTimeouts: config?.commandTimeouts,
    };

    // Bind once so we can remove the exact reference in destroy().
    this.handleResponse = this.handleResponse.bind(this);
    this.transport.on('response', this.handleResponse);
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /** Whether a command is currently in-flight. */
  get isBusy(): boolean {
    return this._busy;
  }

  /** Timestamp (ms since epoch) of the last completed command. */
  get lastCommand(): number {
    return this.lastCommandTime;
  }

  /**
   * Send a command to the device and await the response.
   *
   * Only one command may be pending at a time; calling while busy will reject
   * immediately.
   */
  sendCommand<T>(
    cmd: CommandName,
    params?: Record<string, unknown>,
    timeoutMs?: number,
  ): Promise<T> {
    if (this._busy) {
      return Promise.reject(new Error('Command already in progress'));
    }

    this.setBusy(true);
    this.pendingCommand = cmd;

    return new Promise<T>((resolve, reject) => {
      this.pendingResolve = resolve as (value: unknown) => void;
      this.pendingReject = reject;

      // Build the command envelope.
      const envelope: Record<string, unknown> = { cmd };
      if (params) {
        envelope.params = params;
      }

      const ms = this.resolveTimeout(cmd, timeoutMs);

      // Start the timeout timer before writing so that slow writes are covered.
      this.timeoutTimer = setTimeout(() => {
        this.timeoutTimer = null;
        const error = new Error(
          `Command '${cmd}' timed out after ${ms}ms`,
        );
        log.warn(error.message);
        this.settlePending(null, error);
      }, ms);

      log.debug('sendCommand', cmd, params ?? '');
      const nonce = this.commandNonce;
      this.transport.writeCommand(JSON.stringify(envelope)).catch((err) => {
        // Guard against stale .catch() handlers: if the command was already
        // settled (e.g. by timeout) and a new command was started, this
        // handler must not reject the new command's promise.
        if (nonce !== this.commandNonce) {
          log.debug('Ignoring stale writeCommand error (nonce mismatch)');
          return;
        }
        log.error('writeCommand failed', err);
        this.settlePending(
          null,
          err instanceof Error ? err : new Error(String(err)),
        );
      });
    });
  }

  // ---------------------------------------------------------------------------
  // Typed command helpers
  // ---------------------------------------------------------------------------

  getStatus(): Promise<WifiStatus> {
    return this.sendCommand<WifiStatus>('get_status');
  }

  scan(): Promise<ScanResponseData> {
    return this.sendCommand<ScanResponseData>('scan', undefined, 15000);
  }

  listNetworks(): Promise<ListNetworksResponseData> {
    return this.sendCommand<ListNetworksResponseData>('list_networks');
  }

  addNetwork(params: AddNetworkParams): Promise<void> {
    return this.sendCommand<void>(
      'add_network',
      params as unknown as Record<string, unknown>,
    );
  }

  delNetwork(ssid: string): Promise<void> {
    return this.sendCommand<void>('del_network', { ssid });
  }

  connectWifi(ssid?: string): Promise<void> {
    return this.sendCommand<void>(
      'connect',
      ssid ? { ssid } : undefined,
    );
  }

  disconnectWifi(): Promise<void> {
    return this.sendCommand<void>('disconnect');
  }

  getApStatus(): Promise<ApStatus> {
    return this.sendCommand<ApStatus>('get_ap_status');
  }

  startAp(params?: StartApParams): Promise<void> {
    return this.sendCommand<void>(
      'start_ap',
      params as unknown as Record<string, unknown> | undefined,
    );
  }

  stopAp(): Promise<void> {
    return this.sendCommand<void>('stop_ap');
  }

  getVar(key: string): Promise<DeviceVariable> {
    return this.sendCommand<DeviceVariable>('get_var', { key });
  }

  setVar(key: string, value: string): Promise<void> {
    return this.sendCommand<void>('set_var', { key, value });
  }

  factoryReset(): Promise<void> {
    return this.sendCommand<void>('factory_reset');
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  /**
   * Tear down the protocol layer.
   *
   * Unsubscribes from transport events, rejects any in-flight command, and
   * removes all listeners on this emitter.
   */
  destroy(): void {
    log.debug('destroy');
    this.transport.off('response', this.handleResponse);

    // Abandon any in-flight command without rejecting — this is a controlled
    // teardown, not an error.  Calling reject() here would surface as an
    // unhandled promise rejection when the caller (store action / UI) has
    // already moved on.  Incrementing the nonce invalidates any outstanding
    // writeCommand .catch() handler so it won't call settlePending later.
    if (this.pendingCommand) {
      log.debug('Abandoning pending command during destroy:', this.pendingCommand);
    }
    this.commandNonce++;
    this.clearTimeout();
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingCommand = null;
    this._busy = false;

    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  /**
   * Handle an incoming JSON response from the transport layer.
   *
   * Bound in the constructor so the reference is stable for event
   * subscription/unsubscription.
   */
  private handleResponse(jsonText: string): void {
    if (!this.pendingResolve || !this.pendingReject) {
      log.warn('Received stray response with no pending command:', jsonText);
      return;
    }

    let response: ResponseEnvelope;
    try {
      response = JSON.parse(jsonText) as ResponseEnvelope;
    } catch {
      this.settlePending(null, new Error('Invalid JSON response'));
      return;
    }

    if (response.status === 'ok' || response.status === 'success') {
      this.settlePending((response as ResponseEnvelopeOk).data ?? {}, null);
    } else {
      const errResp = response as ResponseEnvelopeError;
      const msg = errResp.error || errResp.message || 'Command failed';
      const error = new Error(msg);
      this.settlePending(null, error);
    }
  }

  /**
   * Resolve or reject the pending command promise and reset bookkeeping.
   *
   * Exactly one of `data` or `error` should be non-null.
   */
  private settlePending(data: unknown, error: Error | null): void {
    const resolve = this.pendingResolve;
    const reject = this.pendingReject;
    const cmd = this.pendingCommand;

    // Clear state before calling callbacks to allow re-entrant sendCommand.
    // Increment the nonce so any stale .catch() handlers are invalidated.
    this.commandNonce++;
    this.clearTimeout();
    this.pendingResolve = null;
    this.pendingReject = null;
    this.pendingCommand = null;
    this.lastCommandTime = Date.now();
    this.setBusy(false);

    if (error) {
      log.error('Command failed:', cmd, error.message);
      if (cmd) {
        this.emit('commandError', error, cmd);
      }
      reject?.(error);
    } else {
      log.debug('Command succeeded:', cmd);
      resolve?.(data);
    }
  }

  private setBusy(busy: boolean): void {
    if (this._busy !== busy) {
      this._busy = busy;
      this.emit('busyChanged', busy);
    }
  }

  /**
   * Determine the effective timeout for a given command.
   *
   * Priority: explicit `timeoutMs` arg > per-command config override >
   * per-command constant > global config default.
   */
  private resolveTimeout(cmd: CommandName, explicit?: number): number {
    if (explicit !== undefined) {
      return explicit;
    }
    if (this.config.commandTimeouts?.[cmd] !== undefined) {
      return this.config.commandTimeouts[cmd]!;
    }
    if (COMMAND_TIMEOUTS[cmd] !== undefined) {
      return COMMAND_TIMEOUTS[cmd]!;
    }
    return this.config.defaultTimeoutMs;
  }

  private clearTimeout(): void {
    if (this.timeoutTimer !== null) {
      clearTimeout(this.timeoutTimer);
      this.timeoutTimer = null;
    }
  }
}
