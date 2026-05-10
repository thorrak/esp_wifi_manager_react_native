/**
 * Provisioning flow types — the v2 step machine, error model, device model,
 * and configuration shape.
 *
 * The step machine is the single source of truth for "what is the user
 * currently doing"; every visible UI state has a distinct step. Consumers
 * should drive their UI off `step` and never derive their own phase enums.
 *
 * v2 differences from v1:
 *   - Credentials are exchanged via the SDK's atomic `provision()` call,
 *     which both sends credentials and waits for the device to attempt
 *     STA-connect — no separate poller stage.
 *   - There's no `manage` step that exposes saved-network / AP / factory
 *     reset operations: those endpoints don't exist in the new firmware
 *     protocol. A simplified post-success `manage` step now only exposes
 *     the device-variable editor (custom protocomm endpoint).
 */

import type { ScannedNetwork, ProvisionResult } from './wifi';
import type { BleTransportConfig, SecurityVersion } from './ble';
import type { DeviceProtocolConfig } from './protocol';
import type { DeviceProtocol } from '../services/DeviceProtocol';
import type { BleTransport } from '../services/BleTransport';

// ---------------------------------------------------------------------------
// Step machine
// ---------------------------------------------------------------------------

/**
 * Every distinct UI state the user can be in during the provisioning flow.
 *
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

export const VISIBLE_STEP_COUNT = 5;

export function stepNumber(step: ProvisioningStep): number | null {
  return STEP_NUMBERS[step];
}

// ---------------------------------------------------------------------------
// Device connection
// ---------------------------------------------------------------------------

export type DeviceConnection =
  | null
  | {
      status: 'connecting';
      id: string;
      name: string;
      rssi: number | null;
    }
  | {
      status: 'connected';
      id: string;
      name: string;
      mtu: number | null;
    };

// ---------------------------------------------------------------------------
// Error model
// ---------------------------------------------------------------------------

/**
 * Subsystem that produced an error.
 *
 *  - `ble`        — scanning, connection, or session-init failure
 *  - `protocol`   — custom protocomm endpoint (vars, capabilities, …)
 *  - `provision`  — credential exchange / STA-connect rejected by device
 *  - `flow`       — onConnected callback or wizard sequencing error
 */
export type ProvisioningErrorSource = 'ble' | 'protocol' | 'provision' | 'flow';

export interface ProvisioningError {
  source: ProvisioningErrorSource;
  code?: string;
  message: string;
  recoverable: boolean;
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------

export interface ProvisioningResult {
  success: boolean;
  ssid?: string;
  /**
   * Raw status string returned by the SDK's `provision()` call. The native
   * layer does not surface the device's IP — fetch it from your device
   * over Wi-Fi after provisioning if you need it.
   */
  provisionStatus?: string;
  deviceName?: string;
  deviceId?: string;
}

// ---------------------------------------------------------------------------
// onConnected hook
// ---------------------------------------------------------------------------

export interface OnConnectedContext {
  /** Custom-endpoint protocol helper. */
  protocol: DeviceProtocol;
  /** Transport instance. Use only for low-level diagnostics. */
  transport: BleTransport;
}

/**
 * Callback fired after the protocomm session is established and before
 * the WiFi scan starts. Throwing inside it surfaces as a
 * `ProvisioningError` and leaves the manager parked on `configuring`.
 */
export type OnConnectedCallback = (ctx: OnConnectedContext) => Promise<void>;

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export interface ProvisioningConfig {
  /** BLE transport options. */
  ble?: BleTransportConfig;
  /** Custom protocomm endpoint options. */
  protocol?: DeviceProtocolConfig;
  /** Wizard flow customization. */
  flow?: {
    onConnected?: OnConnectedCallback;
    /** Auto-advance past credentials for OPEN networks. Default: true. */
    autoConnectOpenNetworks?: boolean;
    /** Override the SDK provision()-call timeout (ms). Default: 60000. */
    provisionTimeoutMs?: number;
  };
}

/**
 * Convenience alias re-exported so consumers passing a `security` value
 * don't need to dig into the `ble` namespace.
 */
export type { SecurityVersion };

// ---------------------------------------------------------------------------
// Theming
// ---------------------------------------------------------------------------

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

export interface ProvisioningManagerEvents {
  stepChanged: (step: ProvisioningStep) => void;
  errorChanged: (error: ProvisioningError | null) => void;
  scannedNetworksUpdated: (networks: ScannedNetwork[]) => void;
  selectedNetworkChanged: (network: ScannedNetwork | null) => void;
  deviceConnectionChanged: (device: DeviceConnection) => void;
  provisioningComplete: (result: ProvisioningResult) => void;
  provisioningReset: () => void;
  /** Forwarded SDK provision() result before manager transitions to success/error. */
  provisionResult: (result: ProvisionResult) => void;
}
