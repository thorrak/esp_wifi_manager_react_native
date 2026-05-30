/**
 * BleTransport — Layer 1 of the ESP WiFi Config library.
 *
 * Wraps `@orbital-systems/react-native-esp-idf-provisioning`, which itself
 * wraps Espressif's native iOS / Android provisioning SDKs. Provides:
 *
 *   - BLE scanning filtered by device-name prefix (`PROV_*` by default)
 *   - Connection / session-init using the configured Security 1 / 2 PoP
 *   - Reference holding for the active `ESPDevice` so DeviceProtocol /
 *     ProvisioningManager can hand off scan / provision / sendData calls
 *   - Typed event emission for the store / hooks / screens
 *
 * The native SDK does not stream individual discoveries — `searchESPDevices`
 * resolves with the full list at the end of a scan cycle. We emit
 * `deviceDiscovered` once per matched device when results land, then a
 * single `scanCompleted` — there is no live per-advertisement discovery
 * stream, that is just what the underlying SDK supports.
 */

import {
  ESPDevice,
  ESPProvisionManager,
  ESPSecurity,
  ESPTransport,
} from '@orbital-systems/react-native-esp-idf-provisioning';

import type {
  BleConnectionState,
  ConnectedDeviceInfo,
  DeviceAuthCredentials,
  DiscoveredDevice,
  BleTransportEvents,
  BleTransportConfig,
  SecurityVersion,
} from '../types';

import { BleLibraryError } from '../types/ble';

import {
  DEVICE_NAME_PREFIX,
  DEFAULT_SCAN_TIMEOUT_MS,
  DEFAULT_POP,
  DEFAULT_SECURITY2_USERNAME,
} from '../constants/ble';

import { TypedEventEmitter, createLogger } from '../utils';

const log = createLogger('BleTransport');

interface ResolvedConfig {
  deviceNamePrefixes: string[];
  scanTimeoutMs: number;
  security: SecurityVersion;
  proofOfPossession: string;
  username: string;
  promptForAuth: boolean;
}

function normalizePrefixes(input?: string | string[]): string[] {
  if (input == null) return [DEVICE_NAME_PREFIX];
  return Array.isArray(input) ? input : [input];
}

function resolveConfig(config?: BleTransportConfig): ResolvedConfig {
  return {
    deviceNamePrefixes: normalizePrefixes(config?.deviceNamePrefix),
    scanTimeoutMs: config?.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
    security: config?.security ?? 1,
    proofOfPossession: config?.proofOfPossession ?? DEFAULT_POP,
    username: config?.username ?? DEFAULT_SECURITY2_USERNAME,
    promptForAuth: config?.promptForAuth ?? false,
  };
}

function toEspSecurity(s: SecurityVersion): ESPSecurity {
  switch (s) {
    case 0:
      return ESPSecurity.unsecure;
    case 2:
      return ESPSecurity.secure2;
    case 1:
    default:
      return ESPSecurity.secure;
  }
}

export class BleTransport extends TypedEventEmitter<BleTransportEvents> {
  private readonly config: ResolvedConfig;

  private _connectionState: BleConnectionState = 'disconnected';
  private _device: ESPDevice | null = null;
  private _connectedDeviceInfo: ConnectedDeviceInfo | null = null;
  private scanTimeoutId: ReturnType<typeof setTimeout> | null = null;
  private _destroyed = false;

  // ────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────

  constructor(config?: BleTransportConfig) {
    super();
    this.config = resolveConfig(config);
    log.info('BleTransport created', {
      prefixes: this.config.deviceNamePrefixes,
      security: this.config.security,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Public getters
  // ────────────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get connectedDevice(): ConnectedDeviceInfo | null {
    return this._connectedDeviceInfo;
  }

  get connectionState(): BleConnectionState {
    return this._connectionState;
  }

  /**
   * The active `ESPDevice` reference, if connected.
   *
   * Exposed (unstable) so the protocol / manager layers can call
   * `provision()` / `scanWifiList()` / `sendData()` on it. Most
   * application code should not touch this directly.
   */
  get espDevice(): ESPDevice | null {
    return this._device;
  }

  /** Resolved configuration (after defaults applied). */
  get resolvedConfig(): Readonly<ResolvedConfig> {
    return this.config;
  }

  // ────────────────────────────────────────────────────────────────────
  // Scanning
  // ────────────────────────────────────────────────────────────────────

  /**
   * Start a BLE scan for devices matching any configured prefix. The
   * native SDK does not stream individual discoveries — once the scan
   * resolves, every matched device is emitted as a separate
   * `deviceDiscovered` event followed by a single `scanCompleted`.
   *
   * The scan is implicitly bounded by `scanTimeoutMs`; we race the SDK
   * call against a setTimeout that calls `stopScan()` if the SDK doesn't
   * return on its own.
   */
  async startScan(): Promise<void> {
    if (this._connectionState === 'scanning') {
      log.warn('Scan already in progress');
      return;
    }
    if (
      this._connectionState === 'connected' ||
      this._connectionState === 'connecting'
    ) {
      log.warn('Cannot scan while connected or connecting');
      return;
    }

    log.info('Starting BLE scan', { prefixes: this.config.deviceNamePrefixes });
    this.setConnectionState('scanning');

    // Schedule a hard cap so the UI never hangs on a stuck scan.
    this.scanTimeoutId = setTimeout(() => {
      log.warn(`Scan timeout after ${this.config.scanTimeoutMs}ms — cancelling`);
      try {
        ESPProvisionManager.stopESPDevicesSearch();
      } catch {
        // SDK may have already finished.
      }
    }, this.config.scanTimeoutMs);

    const matched = new Map<string, ESPDevice>();

    // Run one searchESPDevices() call per prefix. The SDK API only accepts a
    // single prefix per call, so we serialise — but each prefix MUST be
    // isolated. The native SDK *rejects* a search when a prefix matches no
    // device; that is an empty result for that prefix, not a scan failure. If
    // we let one rejection escape (e.g. 'BrewPiESP-' when only a 'TiltBridge-'
    // device is present) it would abort the remaining prefixes and discard
    // devices already matched. So we catch per-prefix, treat "not found" as
    // empty, and collect only genuinely actionable failures (Bluetooth off /
    // unauthorized) to surface if nothing matched at all.
    const realErrors: BleLibraryError[] = [];

    for (const prefix of this.config.deviceNamePrefixes) {
      if (this._destroyed) break;
      try {
        const devices = await ESPProvisionManager.searchESPDevices(
          prefix,
          ESPTransport.ble,
          toEspSecurity(this.config.security),
        );
        for (const d of devices) {
          if (!matched.has(d.name)) matched.set(d.name, d);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (/unauth/i.test(message)) {
          realErrors.push(
            new BleLibraryError('unauthorized', `BLE scan error: ${message}`),
          );
        } else if (/off|disabled/i.test(message)) {
          realErrors.push(
            new BleLibraryError('powered_off', `BLE scan error: ${message}`),
          );
        } else {
          // Almost always "no device found for prefix" — a benign empty
          // result for this prefix, not a failure. Just move on.
          log.debug(`Prefix "${prefix}" matched no devices: ${message}`);
        }
      }
    }

    this.clearScanTimeout();
    if (this._destroyed) return;

    // Surface a hard error only when nothing matched AND at least one prefix
    // failed for an actionable reason. "No devices found" is reported via
    // scanCompleted (matched: 0), never the error event — see CLAUDE.md.
    if (matched.size === 0 && realErrors.length > 0) {
      const scanError = realErrors[0];
      log.error('Scan failed:', scanError.message);
      this.emit('error', scanError);
      this.setConnectionState('disconnected');
      this.emit('scanStopped');
      return;
    }

    for (const device of matched.values()) {
      const discovered: DiscoveredDevice = {
        id: device.name, // SDK uses name as the connection key on iOS
        name: device.name,
        rssi: null, // not surfaced by the SDK
      };
      this.emit('deviceDiscovered', discovered);
    }

    this.emit('scanCompleted', {
      matched: matched.size,
      total: matched.size,
      sampleNames: [],
    });

    this.setConnectionState('disconnected');
    this.emit('scanStopped');
    log.info(`Scan completed: ${matched.size} matched device(s)`);
  }

  /**
   * Cancel an in-flight scan. Safe to call when no scan is running.
   */
  stopScan(): void {
    if (this._connectionState !== 'scanning') {
      return;
    }
    log.info('Stop scan requested');
    this.clearScanTimeout();
    try {
      ESPProvisionManager.stopESPDevicesSearch();
    } catch {
      // SDK may have already finished.
    }
    // The startScan() promise will resolve naturally once the SDK returns;
    // it will emit scanStopped and reset state then.
  }

  // ────────────────────────────────────────────────────────────────────
  // Connection
  // ────────────────────────────────────────────────────────────────────

  /**
   * Connect to a discovered device. Combines BLE link establishment with
   * the protocomm session-init handshake (Security 0/1/2 negotiation,
   * PoP / SRP exchange).
   *
   * `overrides` lets the caller supply per-flow credentials (typically
   * captured from a UI prompt) that take precedence over the values
   * configured at construction time. Useful for the `enterDeviceAuth`
   * wizard step and for unauthorized-retry flows.
   *
   * Returns a `ConnectedDeviceInfo` describing the active device. Throws
   * a `BleLibraryError` on failure.
   */
  async connect(
    deviceId: string,
    overrides?: DeviceAuthCredentials,
  ): Promise<ConnectedDeviceInfo> {
    log.info('Connecting to device:', deviceId);

    // Stop any active scan before connecting.
    if (this._connectionState === 'scanning') {
      this.stopScan();
    }

    this.setConnectionState('connecting');

    const device = new ESPDevice({
      name: deviceId,
      transport: ESPTransport.ble,
      security: toEspSecurity(this.config.security),
    });

    const pop = overrides?.pop ?? this.config.proofOfPossession;
    const username =
      this.config.security === 2
        ? overrides?.username ?? this.config.username
        : null;

    try {
      await device.connect(pop, null, username);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error('Connect failed:', message);
      this._device = null;
      this._connectedDeviceInfo = null;
      this.setConnectionState('disconnected');
      // Heuristic — the native SDK surfaces a variety of strings for
      // failed handshakes; anything that looks like an auth/PoP/SRP
      // failure is treated as 'unauthorized' so the manager can bounce
      // back to the auth step instead of cancelling the whole flow.
      const code: 'unauthorized' | 'connect_error' = /unauth|pop|proof|verifier|invalid (?:password|credential)/i.test(
        message,
      )
        ? 'unauthorized'
        : 'connect_error';
      throw new BleLibraryError(code, `BLE connect error: ${message}`);
    }

    this._device = device;
    this._connectedDeviceInfo = {
      id: deviceId,
      name: deviceId,
      mtu: null, // not surfaced by the SDK
    };
    this.setConnectionState('connected');
    log.info('Connected successfully', this._connectedDeviceInfo);
    return this._connectedDeviceInfo;
  }

  // ────────────────────────────────────────────────────────────────────
  // Disconnection
  // ────────────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    log.info('Disconnect requested');
    if (this._device) {
      try {
        this._device.disconnect();
      } catch (err) {
        log.debug('Ignoring disconnect error:', err);
      }
    }
    this._device = null;
    this._connectedDeviceInfo = null;
    this.setConnectionState('disconnected');
  }

  // ────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ────────────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    if (this._destroyed) return;
    this._destroyed = true;
    log.info('Destroying transport');

    this.clearScanTimeout();
    try {
      ESPProvisionManager.stopESPDevicesSearch();
    } catch {
      /* ignore */
    }

    if (this._device) {
      try {
        this._device.disconnect();
      } catch {
        /* ignore */
      }
    }
    this._device = null;
    this._connectedDeviceInfo = null;
    this._connectionState = 'disconnected';
    this.removeAllListeners();
  }

  // ────────────────────────────────────────────────────────────────────
  // Internals
  // ────────────────────────────────────────────────────────────────────

  private setConnectionState(state: BleConnectionState): void {
    if (this._connectionState === state) return;
    this._connectionState = state;
    this.emit('connectionStateChanged', state);
  }

  private clearScanTimeout(): void {
    if (this.scanTimeoutId !== null) {
      clearTimeout(this.scanTimeoutId);
      this.scanTimeoutId = null;
    }
  }
}
