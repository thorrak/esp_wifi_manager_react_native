/**
 * BLE-related types for ESP-IDF Network Provisioning.
 *
 * The transport now wraps `@orbital-systems/react-native-esp-idf-provisioning`
 * (which in turn wraps Espressif's native iOS / Android SDKs). The events
 * exposed here mirror the v1 transport API as closely as possible so the
 * surrounding store / hooks / screens continue to work — but the
 * underlying mechanism is fundamentally different (no live discovery
 * stream, no GATT writes from JS, no JSON reassembly).
 */

export type BleErrorCode =
  | 'unauthorized'
  | 'powered_off'
  | 'unsupported'
  | 'scan_error'
  | 'connect_error'
  | 'provision_error'
  | 'unknown';

export class BleLibraryError extends Error {
  readonly code: BleErrorCode;

  constructor(code: BleErrorCode, message: string) {
    super(message);
    this.name = 'BleLibraryError';
    this.code = code;
  }
}

export type BleConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected';

/**
 * A device found by the SDK during a scan. The `id` is whatever the SDK
 * returns (BLE peripheral identifier on iOS, MAC address on Android), and
 * `name` is the GAP-advertised name (typically `PROV_xxxxxx`).
 */
export interface DiscoveredDevice {
  id: string;
  /** Advertised device name, e.g. "PROV_AB12CD" */
  name: string;
  /**
   * RSSI at discovery time. The native SDK does not always surface this;
   * `null` when unknown.
   */
  rssi: number | null;
}

export interface ConnectedDeviceInfo {
  id: string;
  name: string;
  /**
   * Reported negotiated MTU. Always `null` for the SDK transport — the
   * native layer manages MTU internally and doesn't surface it. Kept on
   * the type so the store/UI shape stays stable from v1.
   */
  mtu: number | null;
}

/** Diagnostic info emitted by `BleTransport` after a scan completes. */
export interface ScanCompletedInfo {
  /** Number of devices that matched the configured name prefix(es). */
  matched: number;
  /**
   * Total number of unique devices observed during the scan. The native
   * SDK only surfaces matched devices, so `total` always equals `matched`.
   */
  total: number;
  /**
   * Names of non-matching devices seen during the scan. Always empty for
   * the SDK transport — kept for shape compatibility with v1.
   */
  sampleNames: string[];
}

export interface BleTransportEvents {
  connectionStateChanged: (state: BleConnectionState) => void;
  /**
   * Emitted once per matched device after the SDK scan completes. The SDK
   * does not stream individual discoveries — devices land in the store
   * as a batch.
   */
  deviceDiscovered: (device: DiscoveredDevice) => void;
  /** Fires once per scan cycle when results are in (or timeout fires). */
  scanCompleted: (info: ScanCompletedInfo) => void;
  scanStopped: () => void;
  /** Emitted only for genuine failures (BLE off, unauthorized, scan_error). */
  error: (error: Error) => void;
}

/**
 * Security version selector. Maps onto the SDK's `ESPSecurity` enum and
 * the firmware's `CONFIG_WIFI_CFG_NETWORK_PROVISIONING_SECURITY_*` choice.
 */
export type SecurityVersion = 0 | 1 | 2;

export interface BleTransportConfig {
  /** Device name prefix(es) to filter during scanning. Default: `"PROV_"`. */
  deviceNamePrefix?: string | string[];
  /** Scan timeout in ms. Default: 10000. */
  scanTimeoutMs?: number;
  /**
   * Security version used during the protocomm session.
   * Default: 1 (matches the firmware's default).
   */
  security?: SecurityVersion;
  /**
   * Proof-of-possession (Security 1) or SRP password (Security 2).
   * Default: `"abcd1234"` (Kconfig default; override per-device for production).
   */
  proofOfPossession?: string;
  /** SRP6a username for Security 2. Default: `"wificfg"`. */
  username?: string;
  /**
   * Force the wizard to insert an `enterDeviceAuth` step where the user
   * enters the PoP (sec1) or SRP password + username (sec2) before
   * connecting. When false (the default), the configured values above
   * are used as-is and the auth step is skipped — unless the required
   * fields are missing or a previous connect attempt was rejected as
   * `unauthorized`, in which case the auth step is inserted regardless.
   * Has no effect when `security === 0`.
   */
  promptForAuth?: boolean;
}

/**
 * Per-flow auth credentials submitted from the `enterDeviceAuth` screen.
 * Override the config-level defaults for one connect attempt.
 */
export interface DeviceAuthCredentials {
  /** PoP (sec1) or SRP password (sec2). */
  pop?: string;
  /** SRP6a username (sec2 only). */
  username?: string;
}
