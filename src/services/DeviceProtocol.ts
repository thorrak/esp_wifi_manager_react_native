/**
 * DeviceProtocol — Layer 2 of the ESP WiFi Config library.
 *
 * Handles the four custom protocomm endpoints registered by
 * esp_wifi_config 0.1.0+ (`esp-wifi-config-version`, `…-capabilities`,
 * `…-vars`, `…-network-policy`) plus thin wrappers around the SDK's
 * `scanWifiList()` and `provision()` so callers can stay at one
 * abstraction level.
 *
 * Custom endpoint payloads are JSON encoded as UTF-8, then sent through
 * `ESPDevice.sendData()` which handles base64 framing and protocomm
 * encryption. The SDK serialises requests internally — there is no need
 * for our own busy flag, but we still surface a `busyChanged` event for
 * UI affordances.
 */

import {
  ESPWifiAuthMode,
  type ESPWifiList,
} from '@orbital-systems/react-native-esp-idf-provisioning';

import type {
  DeviceCapabilities,
  DeviceNetworkPolicy,
  DeviceProtocolConfig,
  DeviceProtocolEvents,
  DeviceVariable,
  DeviceVersionInfo,
  ScannedNetwork,
  ProvisionResult,
  VarsRequest,
  VarsResponse,
  WifiAuthType,
} from '../types';

import {
  PROV_ENDPOINT_VERSION,
  PROV_ENDPOINT_CAPABILITIES,
  PROV_ENDPOINT_VARS,
  PROV_ENDPOINT_NETWORK_POLICY,
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  DEFAULT_WIFI_SCAN_TIMEOUT_MS,
  DEFAULT_PROVISION_TIMEOUT_MS,
} from '../constants/protocol';

import { TypedEventEmitter, createLogger } from '../utils';
import { Buffer } from 'buffer';

import type { BleTransport } from './BleTransport';

const log = createLogger('DeviceProtocol');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authModeToString(mode: ESPWifiAuthMode | number): WifiAuthType {
  switch (mode) {
    case ESPWifiAuthMode.open:
      return 'OPEN';
    case ESPWifiAuthMode.wep:
      return 'WEP';
    case ESPWifiAuthMode.wpa2Enterprise:
      return 'WPA2_ENTERPRISE';
    case ESPWifiAuthMode.wpa2Psk:
      return 'WPA2';
    case ESPWifiAuthMode.wpaPsk:
      return 'WPA';
    case ESPWifiAuthMode.wpaWpa2Psk:
      return 'WPA/WPA2';
    case ESPWifiAuthMode.wpa3Psk:
      return 'WPA3';
    case ESPWifiAuthMode.wpa2Wpa3Psk:
      return 'WPA2/WPA3';
    default:
      return 'UNKNOWN';
  }
}

function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => {
    if (timer !== null) clearTimeout(timer);
  });
}

// ---------------------------------------------------------------------------
// DeviceProtocol
// ---------------------------------------------------------------------------

export class DeviceProtocol extends TypedEventEmitter<DeviceProtocolEvents> {
  private readonly transport: BleTransport;
  private readonly config: Required<Pick<DeviceProtocolConfig, 'defaultTimeoutMs'>> &
    Pick<DeviceProtocolConfig, 'endpointTimeouts'>;
  private inFlight = 0;

  constructor(transport: BleTransport, config?: DeviceProtocolConfig) {
    super();
    this.transport = transport;
    this.config = {
      defaultTimeoutMs: config?.defaultTimeoutMs ?? DEFAULT_ENDPOINT_TIMEOUT_MS,
      endpointTimeouts: config?.endpointTimeouts,
    };
  }

  // ---------------------------------------------------------------------------
  // Public API — standard endpoints (delegated to SDK)
  // ---------------------------------------------------------------------------

  /**
   * Run a Wi-Fi scan from the device. Uses the SDK's `scanWifiList()`
   * (which talks to the standard `prov-scan` protocomm endpoint).
   */
  async scanWifi(): Promise<ScannedNetwork[]> {
    const device = this.requireDevice();
    this.setBusy(true);
    try {
      const raw = await withTimeout<ESPWifiList[]>(
        device.scanWifiList(),
        DEFAULT_WIFI_SCAN_TIMEOUT_MS,
        'scanWifi',
      );
      return raw.map((n) => ({
        ssid: n.ssid,
        rssi: n.rssi,
        auth: authModeToString(n.auth),
        bssid: n.bssid,
        channel: n.channel,
      }));
    } finally {
      this.setBusy(false);
    }
  }

  /**
   * Send credentials to the device and wait for STA-connect to complete.
   * Wraps the SDK's atomic `provision()` call (which handles the
   * `prov-config` exchange + waits for the device's STA result).
   */
  async provision(
    ssid: string,
    password: string,
    timeoutMs?: number,
  ): Promise<ProvisionResult> {
    const device = this.requireDevice();
    this.setBusy(true);
    try {
      const ms = timeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS;
      const resp: { status: string } = await withTimeout(
        device.provision(ssid, password),
        ms,
        'provision',
      );
      log.info('provision result:', resp.status);
      return { ssid, status: resp.status };
    } finally {
      this.setBusy(false);
    }
  }

  // ---------------------------------------------------------------------------
  // Public API — custom protocomm endpoints
  // ---------------------------------------------------------------------------

  /**
   * Read the firmware/library version metadata from
   * `esp-wifi-config-version`.
   */
  async getVersion(): Promise<DeviceVersionInfo> {
    return this.readJsonEndpoint<DeviceVersionInfo>(PROV_ENDPOINT_VERSION);
  }

  /**
   * Read the device's enabled feature flags + storage limits from
   * `esp-wifi-config-capabilities`.
   */
  async getCapabilities(): Promise<DeviceCapabilities> {
    return this.readJsonEndpoint<DeviceCapabilities>(
      PROV_ENDPOINT_CAPABILITIES,
    );
  }

  /**
   * Read the device's effective provisioning policy (mode + retries).
   */
  async getNetworkPolicy(): Promise<DeviceNetworkPolicy> {
    return this.readJsonEndpoint<DeviceNetworkPolicy>(
      PROV_ENDPOINT_NETWORK_POLICY,
    );
  }

  // ---- Custom variable store ------------------------------------------------

  /** List every saved variable. */
  async listVars(): Promise<DeviceVariable[]> {
    const resp = await this.callVars({ op: 'list' });
    if ('error' in resp) throw new Error(resp.error);
    if ('vars' in resp) {
      return resp.vars.map((v) => ({ key: v.k, value: v.v }));
    }
    return [];
  }

  /** Read a single variable. Returns `null` if it doesn't exist. */
  async getVar(key: string): Promise<DeviceVariable | null> {
    const resp = await this.callVars({ op: 'get', key });
    if ('error' in resp) {
      if (resp.error === 'not_found') return null;
      throw new Error(resp.error);
    }
    if ('value' in resp) {
      return { key: resp.key, value: resp.value };
    }
    return null;
  }

  /** Set (insert or update) a variable. */
  async setVar(key: string, value: string): Promise<void> {
    const resp = await this.callVars({ op: 'set', key, value });
    if ('error' in resp) throw new Error(resp.error);
  }

  /** Delete a variable. */
  async delVar(key: string): Promise<void> {
    const resp = await this.callVars({ op: 'del', key });
    if ('error' in resp) throw new Error(resp.error);
  }

  // ---------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------

  destroy(): void {
    this.removeAllListeners();
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private requireDevice() {
    const device = this.transport.espDevice;
    if (!device) {
      throw new Error('No device connected');
    }
    return device;
  }

  private setBusy(busy: boolean): void {
    if (busy) {
      this.inFlight++;
    } else {
      this.inFlight = Math.max(0, this.inFlight - 1);
    }
    this.emit('busyChanged', this.inFlight > 0);
  }

  private resolveTimeout(endpoint: string): number {
    return (
      this.config.endpointTimeouts?.[endpoint] ?? this.config.defaultTimeoutMs
    );
  }

  /**
   * Call a custom protocomm endpoint with a JSON request and parse a JSON
   * response. The SDK's `sendData()` takes/returns base64 strings — we
   * encode the request body and decode the response.
   */
  private async sendJson<TRes>(
    endpoint: string,
    body: unknown,
  ): Promise<TRes> {
    const device = this.requireDevice();
    const ms = this.resolveTimeout(endpoint);
    // IMPORTANT: never send a zero-length payload. The ESP32 protocomm BLE
    // transport does not dispatch an empty write to its endpoint handler, so
    // the device produces no response and the read returns empty (the call
    // then times out / throws "Empty response"). The read-only custom
    // endpoints (version/capabilities/network-policy) ignore the body but
    // still need at least one byte — send "{}" for an empty request.
    // (Hardware-verified; see bluetooth_spec.md §12 and §18.5.)
    const requestStr = body === undefined ? '{}' : JSON.stringify(body);
    const requestB64 = Buffer.from(requestStr, 'utf-8').toString('base64');

    this.setBusy(true);
    try {
      const responseB64: string = await withTimeout(
        device.sendData(endpoint, requestB64),
        ms,
        endpoint,
      );

      // Some native bridges return the raw UTF-8 string instead of base64.
      // Try base64-decode first; fall back to using the string as-is.
      let responseStr: string;
      try {
        responseStr = Buffer.from(responseB64, 'base64').toString('utf-8');
        // Heuristic: if the decoded body is empty but the input wasn't, the
        // SDK probably already gave us the decoded string.
        if (!responseStr && responseB64) {
          responseStr = responseB64;
        }
      } catch {
        responseStr = responseB64;
      }

      if (!responseStr) {
        throw new Error(`Empty response from ${endpoint}`);
      }

      try {
        return JSON.parse(responseStr) as TRes;
      } catch (err) {
        throw new Error(
          `Invalid JSON response from ${endpoint}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn(`Endpoint ${endpoint} failed:`, error.message);
      this.emit('endpointError', error, endpoint);
      throw error;
    } finally {
      this.setBusy(false);
    }
  }

  /** Convenience: GET-style call that sends an empty body and parses JSON. */
  private readJsonEndpoint<T>(endpoint: string): Promise<T> {
    return this.sendJson<T>(endpoint, undefined);
  }

  private callVars(req: VarsRequest): Promise<VarsResponse> {
    return this.sendJson<VarsResponse>(PROV_ENDPOINT_VARS, req);
  }
}
