/**
 * Provisioning flow types — the v1 step machine, error model, device model,
 * and configuration shape.
 *
 * The step machine is the single source of truth for "what is the user
 * currently doing"; every visible UI state has a distinct step. Consumers
 * should drive their UI off `step` and never derive their own phase enums.
 */

import type { ScannedNetwork, WifiStatus } from './wifi';
import type { BleTransportConfig } from './ble';
import type { DeviceProtocolConfig } from './protocol';
import type { DeviceProtocol } from '../services/DeviceProtocol';
import type { BleTransport } from '../services/BleTransport';

// ---------------------------------------------------------------------------
// Step machine
// ---------------------------------------------------------------------------

/**
 * Every distinct UI state the user can be in during the provisioning flow.
 *
 * Each step represents one observable user-facing screen or sub-screen.
 * Consumers that want to combine adjacent sub-states (e.g. show one screen
 * for both `scanBle` and `connectingBle`) can do so by mapping multiple
 * steps to the same screen — but the step value itself remains granular
 * so progress, copy, and disabled-state derivations stay deterministic.
 */
export type ProvisioningStep =
  // Pre-flow
  | 'welcome'
  // Picking a device
  | 'scanBle'
  | 'connectingBle'
  // Optional pre-WiFi customization (auto-skipped if config.flow.onConnected absent)
  | 'configuring'
  // Picking a WiFi network
  | 'scanningWifi'
  | 'chooseNetwork'
  // Submitting credentials and joining the network
  | 'enterCredentials'
  | 'joiningWifi'
  // Terminal
  | 'success'
  | 'manage';

/**
 * Ordered list of every step in the canonical wizard sequence (excluding
 * `manage`, which is a post-success branch). Useful for progress dots.
 */
export const PROVISIONING_STEP_ORDER: ProvisioningStep[] = [
  'welcome',
  'scanBle',
  'connectingBle',
  'configuring',
  'scanningWifi',
  'chooseNetwork',
  'enterCredentials',
  'joiningWifi',
  'success',
];

/**
 * Mapping from each step to its user-visible numbered phase (1..N) or `null`
 * for non-numbered states. Sub-states share a number so a "Step 2 of 5"
 * label stays stable across `scanBle`/`connectingBle` etc.
 */
export const STEP_NUMBERS: Record<ProvisioningStep, number | null> = {
  welcome: null,
  scanBle: 1,
  connectingBle: 1,
  configuring: 2,
  scanningWifi: 3,
  chooseNetwork: 3,
  enterCredentials: 4,
  joiningWifi: 5,
  success: null,
  manage: null,
};

/** Total user-visible numbered steps. */
export const VISIBLE_STEP_COUNT = 5;

/**
 * Convert a step into its 1-based user-visible number, or `null` for
 * pre-flow / terminal states.
 */
export function stepNumber(step: ProvisioningStep): number | null {
  return STEP_NUMBERS[step];
}

// ---------------------------------------------------------------------------
// Device connection
// ---------------------------------------------------------------------------

/**
 * Unified device-connection state. `null` means no device interaction; the
 * `connecting` and `connected` variants carry the device identity for
 * stable rendering across BLE handshake transitions.
 */
export type DeviceConnection =
  | null
  | {
      status: 'connecting';
      id: string;
      name: string;
      /** RSSI from the discovered scan record (null if unavailable). */
      rssi: number | null;
    }
  | {
      status: 'connected';
      id: string;
      name: string;
      /** Negotiated MTU, if known. */
      mtu: number | null;
    };

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/** Subsystem that produced an error. */
export type ProvisioningErrorSource = 'ble' | 'protocol' | 'poller' | 'flow';

/**
 * Unified error envelope surfaced to consumers. Replaces the previous
 * fragmented `bleError` / `lastCommandError` / `pollError` /
 * `provisioningError` fields. Consumers should read `store.error` (or use
 * `useCurrentError()`) rather than picking a specific source field.
 */
export interface ProvisioningError {
  /** Subsystem that produced the error. */
  source: ProvisioningErrorSource;
  /**
   * Machine-readable code when available (e.g. `'unauthorized'`,
   * `'powered_off'`, `'connection_failed'`).
   */
  code?: string;
  /** Human-readable message suitable for direct UI display. */
  message: string;
  /**
   * Whether the user can retry from the same step. `true` for transient
   * states like a failed WiFi join; `false` for fatal states that require
   * starting over.
   */
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

/** Final outcome of a successful provisioning run. */
export interface ProvisioningResult {
  success: boolean;
  ssid?: string;
  ip?: string;
  deviceName?: string;
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// onConnected hook
// ---------------------------------------------------------------------------

/**
 * Context handed to a `flow.onConnected` callback. Provides direct access
 * to the protocol and transport so callers can issue any device commands
 * (typically `getVar` / `setVar` for application config) before the WiFi
 * scan begins.
 */
export interface OnConnectedContext {
  /** Protocol instance. Use for typed command helpers (`getVar`, `setVar`, …). */
  protocol: DeviceProtocol;
  /** Transport instance. Use for low-level BLE state if needed. */
  transport: BleTransport;
}

/**
 * Callback fired after BLE connect completes and before the WiFi scan
 * starts. Throwing inside it surfaces as a `ProvisioningError` and
 * leaves the manager parked on `configuring` so the user can retry or
 * back out.
 */
export type OnConnectedCallback = (ctx: OnConnectedContext) => Promise<void>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/**
 * Top-level configuration grouped by subsystem. Every field is optional;
 * defaults are documented on the relevant subsystem.
 */
export interface ProvisioningConfig {
  /** BLE transport options (scan timeout, MTU, name prefix, …). */
  ble?: BleTransportConfig;
  /** Protocol options (command timeouts). */
  protocol?: DeviceProtocolConfig;
  /** WiFi-join polling options. */
  poller?: {
    /** Polling interval while waiting for connection (ms). Default: 2000. */
    intervalMs?: number;
    /** Polling timeout (ms). Default: 30000. */
    timeoutMs?: number;
  };
  /** Wizard flow customization. */
  flow?: {
    /**
     * Async callback invoked between BLE connect and WiFi scan. Use to set
     * device hostname, app variables, or run any pre-provisioning checks.
     * If absent, the `configuring` step is auto-skipped.
     */
    onConnected?: OnConnectedCallback;
    /** Default priority for added networks. Default: 10. */
    defaultNetworkPriority?: number;
    /** Auto-advance past credentials for OPEN networks. Default: true. */
    autoConnectOpenNetworks?: boolean;
  };
}

// ---------------------------------------------------------------------------
// Theming
// ---------------------------------------------------------------------------

/** Visual customization for pre-built screens. */
export interface ProvisioningTheme {
  colors?: {
    primary?: string;
    primaryText?: string;
    background?: string;
    card?: string;
    text?: string;
    textSecondary?: string;
    border?: string;
    error?: string;
    success?: string;
    warning?: string;
  };
  borderRadius?: number;
}

// ---------------------------------------------------------------------------
// Manager events
// ---------------------------------------------------------------------------

/** Events emitted by `ProvisioningManager`. */
export interface ProvisioningManagerEvents {
  stepChanged: (step: ProvisioningStep) => void;
  errorChanged: (error: ProvisioningError | null) => void;
  scannedNetworksUpdated: (networks: ScannedNetwork[]) => void;
  selectedNetworkChanged: (network: ScannedNetwork | null) => void;
  deviceConnectionChanged: (device: DeviceConnection) => void;
  provisioningComplete: (result: ProvisioningResult) => void;
  provisioningReset: () => void;
  wifiStatusUpdated: (status: WifiStatus) => void;
}
