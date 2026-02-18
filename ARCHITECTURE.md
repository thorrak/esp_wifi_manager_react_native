# esp-wifi-manager-react-native -- Architecture

React Native library for BLE-based WiFi provisioning of ESP32 devices running `esp_wifi_manager`. Provides both headless hooks and pre-built UI components.

---

## Table of Contents

- [Design Principles](#design-principles)
- [Layer Diagram](#layer-diagram)
- [File Tree](#file-tree)
- [TypeScript Types](#typescript-types)
- [Layer 1: BleTransport](#layer-1-bletransport)
- [Layer 2: DeviceProtocol](#layer-2-deviceprotocol)
- [Layer 3: ConnectionPoller](#layer-3-connectionpoller)
- [Layer 4: ProvisioningManager](#layer-4-provisioningmanager)
- [Zustand Store](#zustand-store)
- [React Hooks](#react-hooks)
- [Pre-Built UI](#pre-built-ui)
- [Public API / Exports](#public-api--exports)
- [Key Design Decisions](#key-design-decisions)
- [Dependencies](#dependencies)
- [Migration Notes from Vue Reference](#migration-notes-from-vue-reference)

---

## Design Principles

1. **Core services are plain TypeScript classes** -- no React dependency. `BleTransport`, `DeviceProtocol`, `ConnectionPoller`, and `ProvisioningManager` can run headlessly in a background task or test harness.

2. **Zustand bridges services to React** -- a single store subscribes to service events and exposes reactive state. Zustand was chosen because it works outside React components (services can call `getState()`/`setState()` directly), has no provider boilerplate, and is tiny (~1KB).

3. **Pre-built UI is optional** -- consumers can use hooks alone, hooks + their own UI, or the full pre-built wizard screens. The library exports all three layers.

4. **Singleton services, factory hooks** -- core service instances are created once and shared. React hooks are thin wrappers that select from the Zustand store and delegate actions to services.

5. **Base64 encoding for BLE** -- `react-native-ble-plx` encodes characteristic values as base64 strings. The transport layer handles encode/decode transparently.

---

## Layer Diagram

```
+------------------------------------------------------------------+
|  Pre-Built UI Screens (optional)                                  |
|  WelcomeScreen, ConnectScreen, NetworkScanScreen,                |
|  CredentialsScreen, ConnectingScreen, SuccessScreen, ManageScreen|
+------------------------------------------------------------------+
        |  uses hooks
+------------------------------------------------------------------+
|  React Hooks                                                      |
|  useProvisioning, useDeviceScanner, useWifiStatus,               |
|  useDeviceProtocol, useBleConnection, useSavedNetworks,          |
|  useAccessPoint, useDeviceVariables                              |
+------------------------------------------------------------------+
        |  selects from store, delegates to services
+------------------------------------------------------------------+
|  Zustand Store (provisioningStore)                                |
|  Single store with slices: ble, protocol, poller, provisioning   |
+------------------------------------------------------------------+
        |  subscribes to service events
+------------------------------------------------------------------+
|  Layer 4: ProvisioningManager                                     |
|  Orchestrates wizard flow, manages step state                    |
+------------------------------------------------------------------+
        |  uses
+------------------------------------------------------------------+
|  Layer 3: ConnectionPoller                                        |
|  Polls get_status, detects connection success/failure/timeout    |
+------------------------------------------------------------------+
        |  uses
+------------------------------------------------------------------+
|  Layer 2: DeviceProtocol                                          |
|  JSON command/response, command queue, timeouts, typed methods    |
+------------------------------------------------------------------+
        |  uses
+------------------------------------------------------------------+
|  Layer 1: BleTransport                                            |
|  BLE scanning, connect, GATT discovery, read/write/notify,      |
|  chunked response reassembly, base64 encode/decode               |
+------------------------------------------------------------------+
        |  uses
+------------------------------------------------------------------+
|  react-native-ble-plx                                             |
+------------------------------------------------------------------+
```

---

## File Tree

```
src/
  index.ts                              # Public API -- re-exports everything

  # ── Types ────────────────────────────────────────────────────
  types/
    ble.ts                              # BLE-level types (device, connection state, characteristics)
    protocol.ts                         # Command/response protocol types (commands, responses, errors)
    wifi.ts                             # WiFi domain types (status, network, auth, AP)
    provisioning.ts                     # Provisioning flow types (step, wizard state, config)
    store.ts                            # Zustand store state and action types
    index.ts                            # Re-exports all types

  # ── Constants ────────────────────────────────────────────────
  constants/
    ble.ts                              # Service/characteristic UUIDs, device name prefix, timeouts
    protocol.ts                         # Command names, default timeouts per command
    provisioning.ts                     # Default polling intervals, step definitions
    index.ts                            # Re-exports all constants

  # ── Utilities ────────────────────────────────────────────────
  utils/
    base64.ts                           # Base64 encode/decode for BLE characteristic values
    logger.ts                           # Configurable logger (debug/info/warn/error with tag prefix)
    EventEmitter.ts                     # Minimal typed EventEmitter for service-to-store communication
    index.ts                            # Re-exports all utilities

  # ── Layer 1: BLE Transport ──────────────────────────────────
  services/
    BleTransport.ts                     # BLE scanning, connect/disconnect, GATT discovery,
                                        # characteristic read/write/notify, chunked response
                                        # reassembly, GATT settle delay, base64 encode/decode.
                                        # Pure TypeScript class, no React dependency.
                                        # Emits: 'response', 'status', 'connectionStateChanged',
                                        #        'deviceDiscovered', 'error'

  # ── Layer 2: Device Protocol ────────────────────────────────
    DeviceProtocol.ts                   # JSON command/response protocol. Accepts a BleTransport.
                                        # One-at-a-time command queue with GATT settle delay.
                                        # Timeout per command. Typed methods for all 13 commands.
                                        # Emits: 'busy', 'commandError'

  # ── Layer 3: Connection Poller ──────────────────────────────
    ConnectionPoller.ts                 # Polls get_status via DeviceProtocol at configurable
                                        # interval. Tracks wifi state transitions (disconnected ->
                                        # connecting -> connected). Detects connection failure
                                        # (connecting -> disconnected) and timeout.
                                        # Emits: 'wifiStateChanged', 'connectionSucceeded',
                                        #        'connectionFailed', 'connectionTimedOut', 'pollError'

  # ── Layer 4: Provisioning Manager ──────────────────────────
    ProvisioningManager.ts              # Orchestrates the full provisioning flow. Manages wizard
                                        # step state. Coordinates scan -> select -> credentials ->
                                        # connect -> poll -> success. Handles retry, delete-and-
                                        # return, and reset. Navigation-agnostic (emits step
                                        # changes; the store/hooks/screens handle actual navigation).
                                        # Emits: 'stepChanged', 'provisioningError',
                                        #        'scannedNetworksUpdated', 'provisioningComplete',
                                        #        'provisioningReset'

    index.ts                            # Re-exports all service classes

  # ── Service Singleton Factory ───────────────────────────────
  serviceFactory.ts                     # Creates and wires singleton service instances.
                                        # Lazy initialization -- services are created on first
                                        # access. Provides getTransport(), getProtocol(),
                                        # getPoller(), getManager(). Also provides destroy()
                                        # to tear down all services (for cleanup/testing).

  # ── Zustand Store ───────────────────────────────────────────
  store/
    provisioningStore.ts                # Single Zustand store with slices:
                                        #   ble:          { connectionState, deviceName, deviceId,
                                        #                   discoveredDevices, scanning, bleError }
                                        #   protocol:     { busy, lastCommandError }
                                        #   poller:       { wifiState, wifiSsid, wifiIp, wifiRssi,
                                        #                   wifiQuality, polling, pollError,
                                        #                   connectionFailed }
                                        #   provisioning: { step, selectedNetwork, scannedNetworks,
                                        #                   provisioningError }
                                        #
                                        # Actions delegate to service singletons.
                                        # Subscribes to service EventEmitter events to sync state.

    index.ts                            # Re-exports store and selector hooks

  # ── React Hooks ─────────────────────────────────────────────
  hooks/
    useProvisioning.ts                  # Full wizard flow: scanForDevices, connectToDevice,
                                        # scanWifiNetworks, selectNetwork, submitCredentials,
                                        # retryConnection, deleteNetworkAndReturn, reset.
                                        # Returns step, selectedNetwork, scannedNetworks, error.

    useDeviceScanner.ts                 # BLE device scanning: startScan, stopScan.
                                        # Returns discoveredDevices, scanning.
                                        # For custom device picker UI (not needed if using
                                        # the pre-built screens).

    useBleConnection.ts                 # BLE connection management: connect, disconnect.
                                        # Returns connectionState, deviceName, deviceId, error.

    useWifiStatus.ts                    # WiFi status from poller: wifiState, ssid, ip, rssi,
                                        # quality, polling, connectionFailed, pollError.
                                        # Also exposes pollOnce() for manual refresh.

    useDeviceProtocol.ts                # Direct protocol access for advanced use: sendCommand,
                                        # getStatus, scan, listNetworks, addNetwork, delNetwork,
                                        # connectWifi, disconnectWifi, getApStatus, startAp,
                                        # stopAp, getVar, setVar, factoryReset.
                                        # Returns busy, lastError.

    useSavedNetworks.ts                 # Saved network management: networks, loading, error,
                                        # fetchNetworks, deleteNetwork. Self-contained -- calls
                                        # listNetworks on mount, refreshes after delete.

    useAccessPoint.ts                   # AP management: apStatus, loading, error, fetchApStatus,
                                        # startAp, stopAp. Self-contained -- fetches on mount.

    useDeviceVariables.ts               # Variable read/write: getVar, setVar. Stateless wrapper
                                        # around protocol commands.

    index.ts                            # Re-exports all hooks

  # ── Pre-Built UI Components ─────────────────────────────────
  components/
    # -- Primitives --
    ErrorBanner.tsx                      # Red banner with message and optional dismiss. Props:
                                        # message: string | null, onDismiss?: () => void

    LoadingSpinner.tsx                  # Activity indicator with optional message. Props:
                                        # message?: string

    SignalIcon.tsx                       # 4-bar signal strength icon. Props: rssi: number.
                                        # Levels: >= -50 (4 bars), >= -60 (3), >= -70 (2),
                                        # >= -80 (1), else 0.

    StatusBadge.tsx                      # Colored dot + label for wifi state. Props:
                                        # state: WifiConnectionState. Pulse animation on
                                        # 'connecting'.

    StepIndicator.tsx                    # Dot progress bar. Props: currentStep: number,
                                        # totalSteps: number.

    PasswordInput.tsx                    # Password field with show/hide toggle. Props:
                                        # value: string, onChangeText: (text: string) => void,
                                        # authType?: WifiAuthType.

    ConfirmDialog.tsx                    # Modal confirmation dialog. Props: visible: boolean,
                                        # title: string, message: string, confirmLabel?: string,
                                        # destructive?: boolean, onConfirm: () => void,
                                        # onCancel: () => void.

    # -- Composite components --
    NetworkList.tsx                      # Scrollable list of scanned WiFi networks. Props:
                                        # networks: ScannedNetwork[], loading: boolean,
                                        # onSelectNetwork: (network: ScannedNetwork) => void.
                                        # Renders NetworkListItem for each.

    NetworkListItem.tsx                  # Single network row: SSID, auth badge, signal icon,
                                        # lock icon for encrypted. Props: network: ScannedNetwork,
                                        # onPress: () => void.

    SavedNetworkList.tsx                # List of saved networks with swipe-to-delete or delete
                                        # button. Props: networks: SavedNetwork[],
                                        # loading: boolean,
                                        # onDeleteNetwork: (ssid: string) => void.

    SavedNetworkItem.tsx                # Single saved network row: SSID, priority badge,
                                        # delete button. Props: network: SavedNetwork,
                                        # onDelete: () => void.

    ApSettings.tsx                       # Self-contained AP management card. Uses useAccessPoint
                                        # internally. Shows active/inactive status, SSID, IP,
                                        # client count, start/stop buttons.

    VariableEditor.tsx                   # Self-contained get/set variable form. Uses
                                        # useDeviceVariables internally. Key input, value
                                        # input/output, get/set buttons.

    index.ts                            # Re-exports all components

  # ── Pre-Built Screens ───────────────────────────────────────
  screens/
    WelcomeScreen.tsx                    # Step 1. "Find Devices" button. Calls
                                        # provisioning.scanForDevices(). Shows library branding
                                        # and purpose text.

    ConnectScreen.tsx                    # Step 2. Shows connecting spinner while BLE GATT
                                        # connects. Auto-advances to NetworkScanScreen on
                                        # success. Shows error + retry on failure.

    NetworkScanScreen.tsx                # Step 3. Renders NetworkList with scanned results.
                                        # "Scan Again" button. Calls provisioning.selectNetwork()
                                        # on tap.

    CredentialsScreen.tsx                # Step 4. Shows selected SSID. PasswordInput for
                                        # password entry (skipped for OPEN networks -- auto-
                                        # advances). "Connect" button calls
                                        # provisioning.submitCredentials(). "Back" returns to
                                        # network list.

    ConnectingScreen.tsx                 # Step 5. LoadingSpinner while polling. Three states:
                                        # (a) polling -- spinner + "Connecting to {ssid}"
                                        # (b) connection failed -- error icon + retry/delete/leave
                                        # (c) timed out -- warning icon + retry/back
                                        # Auto-navigates to SuccessScreen on connected.

    SuccessScreen.tsx                    # Step 6. Shows device name, connected SSID, IP address,
                                        # signal strength. "Done" button. "Manage Device" button
                                        # navigates to ManageScreen.

    ManageScreen.tsx                     # Device management. Tabs or sections for:
                                        # - Saved networks (list + delete)
                                        # - Access point (status + start/stop)
                                        # - Custom variables (get/set form)
                                        # - Factory reset (with confirmation dialog)
                                        # "Back to Setup" button.

    index.ts                            # Re-exports all screens

  # ── Navigation ──────────────────────────────────────────────
  navigation/
    ProvisioningNavigator.tsx           # Pre-wired React Navigation native stack navigator.
                                        # Configures all 7 screens with proper transitions.
                                        # Navigation is driven by provisioning step changes
                                        # (subscribes to store). Includes header with device
                                        # name and disconnect button.
                                        # Props: onComplete?: (result: ProvisioningResult) => void,
                                        #        onDismiss?: () => void,
                                        #        theme?: ProvisioningTheme

    navigationConfig.ts                 # Screen name constants, transition config, header options.

    index.ts                            # Re-exports navigator and config
```

---

## TypeScript Types

### `src/types/ble.ts`

```typescript
// ── BLE Connection State ──────────────────────────────────────
export type BleConnectionState = 'disconnected' | 'scanning' | 'connecting' | 'connected';

// ── Discovered BLE Device ─────────────────────────────────────
export interface DiscoveredDevice {
  /** Platform device ID (UUID on iOS, MAC on Android) */
  id: string;
  /** Advertised device name, e.g. "ESP32-WiFi-A1B2C3" */
  name: string;
  /** RSSI at discovery time */
  rssi: number;
  /** Raw advertisement data (platform-specific) */
  advertisementData?: Record<string, unknown>;
}

// ── Connected Device Info ─────────────────────────────────────
export interface ConnectedDeviceInfo {
  id: string;
  name: string;
  /** Negotiated MTU (null if not yet negotiated) */
  mtu: number | null;
}

// ── BLE Transport Events ─────────────────────────────────────
export interface BleTransportEvents {
  /** Reassembled JSON response string from Response characteristic (0xFFE3) */
  response: (json: string) => void;
  /** Reassembled JSON status string from Status characteristic (0xFFE1) */
  status: (json: string) => void;
  /** BLE connection state changed */
  connectionStateChanged: (state: BleConnectionState) => void;
  /** New device discovered during scanning */
  deviceDiscovered: (device: DiscoveredDevice) => void;
  /** Transport-level error */
  error: (error: Error) => void;
}

// ── BLE Transport Configuration ──────────────────────────────
export interface BleTransportConfig {
  /** Device name prefix to filter during scanning. Default: "ESP32-WiFi-" */
  deviceNamePrefix?: string;
  /** Scan timeout in ms. Default: 15000 */
  scanTimeoutMs?: number;
  /** Minimum delay between GATT writes in ms. Default: 120 */
  gattSettleMs?: number;
  /** Connection timeout in ms. Default: 10000 */
  connectionTimeoutMs?: number;
  /** MTU to request. Default: 517 */
  requestedMtu?: number;
}
```

### `src/types/protocol.ts`

```typescript
// ── Command Names ─────────────────────────────────────────────
export type CommandName =
  | 'get_status'
  | 'scan'
  | 'list_networks'
  | 'add_network'
  | 'del_network'
  | 'connect'
  | 'disconnect'
  | 'get_ap_status'
  | 'start_ap'
  | 'stop_ap'
  | 'get_var'
  | 'set_var'
  | 'factory_reset';

// ── Command Payloads (params field) ──────────────────────────
export interface AddNetworkParams {
  ssid: string;
  password?: string;
  priority?: number;
}

export interface DelNetworkParams {
  ssid: string;
}

export interface ConnectParams {
  ssid?: string;
}

export interface StartApParams {
  ssid?: string;
  password?: string;
}

export interface GetVarParams {
  key: string;
}

export interface SetVarParams {
  key: string;
  value: string;
}

// ── Command Envelope ─────────────────────────────────────────
export interface CommandEnvelope {
  cmd: CommandName;
  params?: Record<string, unknown>;
}

// ── Response Envelope ─────────────────────────────────────────
export interface ResponseEnvelopeOk<T = Record<string, unknown>> {
  status: 'ok';
  data: T;
}

export interface ResponseEnvelopeError {
  status: 'error';
  error: string;
}

export type ResponseEnvelope<T = Record<string, unknown>> =
  | ResponseEnvelopeOk<T>
  | ResponseEnvelopeError;

// ── Protocol Events ──────────────────────────────────────────
export interface DeviceProtocolEvents {
  /** Command queue busy state changed */
  busyChanged: (busy: boolean) => void;
  /** A command resulted in an error response or timeout */
  commandError: (error: Error, command: CommandName) => void;
}

// ── Protocol Configuration ───────────────────────────────────
export interface DeviceProtocolConfig {
  /** Default command timeout in ms. Default: 8000 */
  defaultTimeoutMs?: number;
  /** Per-command timeout overrides */
  commandTimeouts?: Partial<Record<CommandName, number>>;
}
```

### `src/types/wifi.ts`

```typescript
// ── WiFi Connection State ────────────────────────────────────
export type WifiConnectionState = 'connected' | 'connecting' | 'disconnected';

// ── WiFi Auth Types ──────────────────────────────────────────
export type WifiAuthType = 'OPEN' | 'WEP' | 'WPA' | 'WPA2' | 'WPA/WPA2' | 'WPA3' | 'UNKNOWN';

// ── WiFi Status (from get_status response) ───────────────────
export interface WifiStatus {
  state: WifiConnectionState;
  ssid: string;
  rssi: number;
  quality: number;
  ip: string;
  channel: number;
  netmask: string;
  gateway: string;
  dns: string;
  mac: string;
  hostname: string;
  uptime_ms: number;
  ap_active: boolean;
}

// ── Scanned Network (from scan response) ─────────────────────
export interface ScannedNetwork {
  ssid: string;
  rssi: number;
  auth: WifiAuthType;
}

// ── Saved Network (from list_networks response) ──────────────
export interface SavedNetwork {
  ssid: string;
  priority: number;
}

// ── Scan Response Data ───────────────────────────────────────
export interface ScanResponseData {
  networks: ScannedNetwork[];
}

// ── List Networks Response Data ──────────────────────────────
export interface ListNetworksResponseData {
  networks: SavedNetwork[];
}

// ── AP Status (from get_ap_status response) ──────────────────
export interface ApStatus {
  active: boolean;
  ssid: string;
  ip: string;
  sta_count: number;
}

// ── Variable (from get_var response) ─────────────────────────
export interface DeviceVariable {
  key: string;
  value: string;
}
```

### `src/types/provisioning.ts`

```typescript
import type { ScannedNetwork, WifiConnectionState } from './wifi';

// ── Provisioning Steps ───────────────────────────────────────
export type ProvisioningStep =
  | 'welcome'         // Step 1: Landing page, find devices
  | 'connect'         // Step 2: BLE connecting + auto WiFi scan
  | 'networks'        // Step 3: Network selection
  | 'credentials'     // Step 4: Password entry
  | 'connecting'      // Step 5: Polling for connection
  | 'success'         // Step 6: Connected confirmation
  | 'manage';         // Management screen (not a numbered step)

export const PROVISIONING_STEP_ORDER: ProvisioningStep[] = [
  'welcome', 'connect', 'networks', 'credentials', 'connecting', 'success',
];

/** Numeric step (1-6) for a given provisioning step, or null for 'manage' */
export function stepNumber(step: ProvisioningStep): number | null {
  const idx = PROVISIONING_STEP_ORDER.indexOf(step);
  return idx >= 0 ? idx + 1 : null;
}

// ── Provisioning Result ──────────────────────────────────────
export interface ProvisioningResult {
  success: boolean;
  ssid?: string;
  ip?: string;
  deviceName?: string;
  deviceId?: string;
}

// ── Provisioning Configuration ───────────────────────────────
export interface ProvisioningConfig {
  /** BLE transport config */
  ble?: import('./ble').BleTransportConfig;
  /** Protocol config */
  protocol?: import('./protocol').DeviceProtocolConfig;
  /** Polling interval while waiting for connection (ms). Default: 2000 */
  pollIntervalMs?: number;
  /** Polling timeout (ms). Default: 30000 */
  pollTimeoutMs?: number;
  /** Auto-advance past credentials for OPEN networks. Default: true */
  autoConnectOpenNetworks?: boolean;
  /** Default priority for added networks. Default: 10 */
  defaultNetworkPriority?: number;
}

// ── Provisioning Theme (for pre-built UI) ────────────────────
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
  fonts?: {
    regular?: string;
    medium?: string;
    bold?: string;
  };
  /** Border radius for cards and buttons */
  borderRadius?: number;
}

// ── Provisioning Manager Events ──────────────────────────────
export interface ProvisioningManagerEvents {
  stepChanged: (step: ProvisioningStep) => void;
  provisioningError: (error: string | null) => void;
  scannedNetworksUpdated: (networks: ScannedNetwork[]) => void;
  selectedNetworkChanged: (network: ScannedNetwork | null) => void;
  provisioningComplete: (result: ProvisioningResult) => void;
  provisioningReset: () => void;
}
```

### `src/types/store.ts`

```typescript
import type { BleConnectionState, DiscoveredDevice, ConnectedDeviceInfo } from './ble';
import type { CommandName } from './protocol';
import type { WifiConnectionState, ScannedNetwork, WifiStatus } from './wifi';
import type { ProvisioningStep, ProvisioningResult } from './provisioning';

// ── Store State ──────────────────────────────────────────────

export interface BleSlice {
  connectionState: BleConnectionState;
  deviceName: string;
  deviceId: string | null;
  discoveredDevices: DiscoveredDevice[];
  scanning: boolean;
  bleError: string | null;
}

export interface ProtocolSlice {
  busy: boolean;
  lastCommandError: string | null;
}

export interface PollerSlice {
  wifiState: WifiConnectionState;
  wifiSsid: string;
  wifiIp: string;
  wifiRssi: number;
  wifiQuality: number;
  polling: boolean;
  pollError: string | null;
  connectionFailed: boolean;
}

export interface ProvisioningSlice {
  step: ProvisioningStep;
  selectedNetwork: ScannedNetwork | null;
  scannedNetworks: ScannedNetwork[];
  provisioningError: string | null;
}

export interface StoreState extends BleSlice, ProtocolSlice, PollerSlice, ProvisioningSlice {}

// ── Store Actions ────────────────────────────────────────────

export interface StoreActions {
  // BLE actions
  startScan: () => Promise<void>;
  stopScan: () => void;
  connectToDevice: (deviceId: string) => Promise<void>;
  disconnectDevice: () => void;

  // Protocol actions (direct command access)
  getStatus: () => Promise<WifiStatus>;
  scanNetworks: () => Promise<ScannedNetwork[]>;
  listNetworks: () => Promise<import('./wifi').SavedNetwork[]>;
  addNetwork: (params: import('./protocol').AddNetworkParams) => Promise<void>;
  delNetwork: (ssid: string) => Promise<void>;
  connectWifi: (ssid?: string) => Promise<void>;
  disconnectWifi: () => Promise<void>;
  getApStatus: () => Promise<import('./wifi').ApStatus>;
  startAp: (params?: import('./protocol').StartApParams) => Promise<void>;
  stopAp: () => Promise<void>;
  getVar: (key: string) => Promise<import('./wifi').DeviceVariable>;
  setVar: (key: string, value: string) => Promise<void>;
  factoryReset: () => Promise<void>;

  // Provisioning flow actions
  provisioningScanForDevices: () => Promise<void>;
  provisioningConnectToDevice: (deviceId: string) => Promise<void>;
  provisioningScanWifiNetworks: () => Promise<void>;
  provisioningSelectNetwork: (network: ScannedNetwork) => void;
  provisioningSubmitCredentials: (password: string) => Promise<void>;
  provisioningRetryConnection: () => Promise<void>;
  provisioningDeleteNetworkAndReturn: () => Promise<void>;
  provisioningReset: () => void;

  // Poller actions
  startPolling: (timeoutMs?: number, intervalMs?: number) => void;
  stopPolling: () => void;
  pollOnce: () => Promise<WifiStatus>;
}

export type ProvisioningStore = StoreState & StoreActions;
```

---

## Layer 1: BleTransport

**File:** `src/services/BleTransport.ts`

Plain TypeScript class. Wraps `react-native-ble-plx` `BleManager`.

### Responsibilities

1. **Scanning** -- starts/stops BLE scan filtered by device name prefix ("ESP32-WiFi-"). Emits `deviceDiscovered` for each matching peripheral. Auto-stops after timeout.

2. **Connecting** -- connects to a device by ID, negotiates MTU, discovers the provisioning service (0xFFE0) and its three characteristics. Stores characteristic references internally.

3. **Notification setup** -- enables notifications on Response (0xFFE3) and Status (0xFFE1) characteristics. Handles chunked response reassembly (buffer until JSON ends with `}`).

4. **Writing commands** -- encodes a JSON string to base64, writes to Command characteristic (0xFFE2) with response. Enforces GATT settle delay (120ms minimum between writes).

5. **Disconnecting** -- tears down notifications, disconnects GATT, resets internal state. Safe to call multiple times.

6. **Unexpected disconnection** -- monitors `react-native-ble-plx` disconnect events and emits `connectionStateChanged('disconnected')`.

### Key Implementation Details

```typescript
class BleTransport extends TypedEventEmitter<BleTransportEvents> {
  private bleManager: BleManager;
  private config: Required<BleTransportConfig>;
  private device: Device | null = null;
  private responseBuffer: string = '';
  private statusBuffer: string = '';
  private lastWriteTime: number = 0;
  private subscriptions: Subscription[] = [];

  constructor(config?: BleTransportConfig);

  // Scanning
  async startScan(): Promise<void>;
  stopScan(): void;

  // Connection
  async connect(deviceId: string): Promise<ConnectedDeviceInfo>;
  async disconnect(): Promise<void>;
  get isConnected(): boolean;
  get connectedDevice(): ConnectedDeviceInfo | null;

  // Write (internal -- used by DeviceProtocol)
  async writeCommand(jsonString: string): Promise<void>;

  // Notification listeners (internal -- used by DeviceProtocol)
  onResponse(callback: (json: string) => void): () => void;
  onStatus(callback: (json: string) => void): () => void;

  // Lifecycle
  destroy(): void;
}
```

### Base64 Handling

`react-native-ble-plx` returns characteristic values as base64-encoded strings and expects base64 for writes. The transport converts transparently:

- **Write:** `JSON string -> TextEncoder -> Uint8Array -> base64 string -> writeWithResponse`
- **Read/Notify:** `base64 string -> Uint8Array -> TextDecoder -> JSON string -> buffer -> reassemble`

Uses `src/utils/base64.ts` which wraps React Native's `Buffer` or a minimal polyfill (`base64-js`).

### Chunked Response Reassembly

Identical logic to the Vue reference:

```typescript
private handleNotification(buffer: 'response' | 'status', base64Value: string): void {
  const decoded = base64ToString(base64Value);
  this[buffer + 'Buffer'] += decoded;

  const trimmed = this[buffer + 'Buffer'].trimEnd();
  if (trimmed.endsWith('}')) {
    const complete = this[buffer + 'Buffer'];
    this[buffer + 'Buffer'] = '';
    this.emit(buffer === 'response' ? 'response' : 'status', complete);
  }
}
```

---

## Layer 2: DeviceProtocol

**File:** `src/services/DeviceProtocol.ts`

Plain TypeScript class. Accepts a `BleTransport` instance.

### Responsibilities

1. **Command serialization** -- builds `{ cmd, params }` JSON envelope, writes via transport.
2. **Response deserialization** -- subscribes to transport `response` events, parses JSON, resolves/rejects pending promise based on `status` field.
3. **One-at-a-time command queue** -- rejects if a command is already in flight (matches Vue behavior). Exposes `busy` state.
4. **GATT settle delay** -- waits `max(0, GATT_SETTLE_MS - elapsed)` before writing a new command (delegated to transport's writeCommand).
5. **Per-command timeouts** -- `scan` gets 15s, everything else 8s by default. Configurable via `DeviceProtocolConfig`.
6. **Typed command methods** -- one method per command with proper params and return types.

### Public API

```typescript
class DeviceProtocol extends TypedEventEmitter<DeviceProtocolEvents> {
  constructor(transport: BleTransport, config?: DeviceProtocolConfig);

  get isBusy(): boolean;

  // Generic
  sendCommand<T>(cmd: CommandName, params?: Record<string, unknown>, timeoutMs?: number): Promise<T>;

  // Typed command methods
  getStatus(): Promise<WifiStatus>;
  scan(): Promise<ScanResponseData>;
  listNetworks(): Promise<ListNetworksResponseData>;
  addNetwork(params: AddNetworkParams): Promise<void>;
  delNetwork(ssid: string): Promise<void>;
  connectWifi(ssid?: string): Promise<void>;
  disconnectWifi(): Promise<void>;
  getApStatus(): Promise<ApStatus>;
  startAp(params?: StartApParams): Promise<void>;
  stopAp(): Promise<void>;
  getVar(key: string): Promise<DeviceVariable>;
  setVar(key: string, value: string): Promise<void>;
  factoryReset(): Promise<void>;

  destroy(): void;
}
```

---

## Layer 3: ConnectionPoller

**File:** `src/services/ConnectionPoller.ts`

Plain TypeScript class. Accepts a `DeviceProtocol` instance.

### Responsibilities

1. **Interval polling** -- calls `protocol.getStatus()` every N ms (default 2000).
2. **State transition tracking** -- tracks `sawConnecting` flag. Detects:
   - `connected` -- emits `connectionSucceeded`, stops polling.
   - `connecting -> disconnected` -- emits `connectionFailed`, stops polling.
3. **Timeout** -- if polling duration exceeds limit (default 30s), emits `connectionTimedOut`, stops polling.
4. **Error tolerance** -- individual poll errors are logged but do not stop polling (matches Vue behavior).
5. **One-shot poll** -- `pollOnce()` for manual status refresh without starting interval.

### Public API

```typescript
class ConnectionPoller extends TypedEventEmitter<ConnectionPollerEvents> {
  constructor(protocol: DeviceProtocol);

  // State
  get wifiState(): WifiConnectionState;
  get wifiSsid(): string;
  get wifiIp(): string;
  get wifiRssi(): number;
  get wifiQuality(): number;
  get isPolling(): boolean;
  get hasConnectionFailed(): boolean;

  // Control
  startPolling(timeoutMs?: number, intervalMs?: number): void;
  stopPolling(): void;
  pollOnce(): Promise<WifiStatus>;
  reset(): void;

  destroy(): void;
}
```

### Events

```typescript
interface ConnectionPollerEvents {
  wifiStateChanged: (status: WifiStatus) => void;
  connectionSucceeded: (status: WifiStatus) => void;
  connectionFailed: () => void;
  connectionTimedOut: () => void;
  pollError: (error: Error) => void;
}
```

---

## Layer 4: ProvisioningManager

**File:** `src/services/ProvisioningManager.ts`

Plain TypeScript class. Coordinates BleTransport, DeviceProtocol, and ConnectionPoller.

### Responsibilities

1. **Wizard step management** -- tracks current step, emits `stepChanged`.
2. **Flow orchestration** -- implements the same flow as the Vue `useProvisioning`:
   - `scanForDevices()` -> start BLE scan, emit step `welcome`
   - `connectToDevice(id)` -> BLE connect, auto-trigger WiFi scan, emit step `connect` then `networks`
   - `selectNetwork(network)` -> store selection, emit step `credentials`
   - `submitCredentials(password)` -> addNetwork + connectWifi + startPolling, emit step `connecting`
   - On `connectionSucceeded` -> emit step `success`
3. **Error recovery** -- `retryConnection()`, `deleteNetworkAndReturn()`, `reset()`
4. **Navigation-agnostic** -- emits step changes. The Zustand store syncs these to React state. The pre-built `ProvisioningNavigator` uses step state to drive navigation. Custom UIs can use the step to implement their own navigation.

### Key Difference from Vue

The Vue reference bakes `router.push()` into the composable. The React Native version does NOT. The `ProvisioningManager` emits events; navigation is handled in the view layer (`ProvisioningNavigator` subscribes to step changes and calls `navigation.navigate()`). This makes the manager testable and reusable across different navigation setups.

### Public API

```typescript
class ProvisioningManager extends TypedEventEmitter<ProvisioningManagerEvents> {
  constructor(
    transport: BleTransport,
    protocol: DeviceProtocol,
    poller: ConnectionPoller,
    config?: ProvisioningConfig,
  );

  // State
  get currentStep(): ProvisioningStep;
  get selectedNetwork(): ScannedNetwork | null;
  get scannedNetworks(): ScannedNetwork[];

  // Flow control
  scanForDevices(): Promise<void>;
  connectToDevice(deviceId: string): Promise<void>;
  scanWifiNetworks(): Promise<void>;
  selectNetwork(network: ScannedNetwork): void;
  submitCredentials(password: string): Promise<void>;
  retryConnection(): Promise<void>;
  deleteNetworkAndReturn(): Promise<void>;
  goToManage(): void;
  reset(): void;

  destroy(): void;
}
```

---

## Zustand Store

**File:** `src/store/provisioningStore.ts`

Single store that bridges all four service layers to React.

### Design

```typescript
import { create } from 'zustand';

export const useProvisioningStore = create<ProvisioningStore>((set, get) => {
  // Lazy-init services on first action call
  // Subscribe to service events and sync to store state

  return {
    // ── Initial State ──
    // BLE
    connectionState: 'disconnected',
    deviceName: '',
    deviceId: null,
    discoveredDevices: [],
    scanning: false,
    bleError: null,

    // Protocol
    busy: false,
    lastCommandError: null,

    // Poller
    wifiState: 'disconnected',
    wifiSsid: '',
    wifiIp: '',
    wifiRssi: 0,
    wifiQuality: 0,
    polling: false,
    pollError: null,
    connectionFailed: false,

    // Provisioning
    step: 'welcome',
    selectedNetwork: null,
    scannedNetworks: [],
    provisioningError: null,

    // ── Actions ──
    // Each action delegates to the appropriate service singleton
    // and updates store state via set()
    ...bleActions(set, get),
    ...protocolActions(set, get),
    ...pollerActions(set, get),
    ...provisioningActions(set, get),
  };
});
```

### Service Event Subscriptions

When services are initialized, the store subscribes to their events:

```typescript
function subscribeToServices(set: SetState) {
  const transport = getTransport();
  const protocol = getProtocol();
  const poller = getPoller();
  const manager = getManager();

  transport.on('connectionStateChanged', (state) =>
    set({ connectionState: state })
  );

  transport.on('deviceDiscovered', (device) =>
    set((s) => ({
      discoveredDevices: [...s.discoveredDevices.filter(d => d.id !== device.id), device]
    }))
  );

  protocol.on('busyChanged', (busy) => set({ busy }));

  poller.on('wifiStateChanged', (status) =>
    set({
      wifiState: status.state,
      wifiSsid: status.ssid,
      wifiIp: status.ip,
      wifiRssi: status.rssi,
      wifiQuality: status.quality,
    })
  );

  poller.on('connectionFailed', () => set({ connectionFailed: true }));
  poller.on('connectionTimedOut', () => set({ pollError: 'Connection timed out' }));

  manager.on('stepChanged', (step) => set({ step }));
  manager.on('scannedNetworksUpdated', (networks) => set({ scannedNetworks: networks }));
  manager.on('selectedNetworkChanged', (network) => set({ selectedNetwork: network }));
  manager.on('provisioningError', (error) => set({ provisioningError: error }));
}
```

---

## React Hooks

All hooks are thin selectors over the Zustand store. They use Zustand's `useShallow` for efficient re-rendering.

### `useProvisioning`

The primary hook for the provisioning wizard flow.

```typescript
export function useProvisioning() {
  const step = useProvisioningStore((s) => s.step);
  const selectedNetwork = useProvisioningStore((s) => s.selectedNetwork);
  const scannedNetworks = useProvisioningStore((s) => s.scannedNetworks);
  const provisioningError = useProvisioningStore((s) => s.provisioningError);
  const connectionState = useProvisioningStore((s) => s.connectionState);
  const deviceName = useProvisioningStore((s) => s.deviceName);
  const wifiState = useProvisioningStore((s) => s.wifiState);
  const wifiIp = useProvisioningStore((s) => s.wifiIp);
  const wifiRssi = useProvisioningStore((s) => s.wifiRssi);
  const wifiQuality = useProvisioningStore((s) => s.wifiQuality);
  const connectionFailed = useProvisioningStore((s) => s.connectionFailed);
  const pollError = useProvisioningStore((s) => s.pollError);
  const polling = useProvisioningStore((s) => s.polling);
  const busy = useProvisioningStore((s) => s.busy);

  // Actions are stable references (from Zustand)
  const scanForDevices = useProvisioningStore((s) => s.provisioningScanForDevices);
  const connectToDevice = useProvisioningStore((s) => s.provisioningConnectToDevice);
  const selectNetwork = useProvisioningStore((s) => s.provisioningSelectNetwork);
  const submitCredentials = useProvisioningStore((s) => s.provisioningSubmitCredentials);
  const retryConnection = useProvisioningStore((s) => s.provisioningRetryConnection);
  const deleteNetworkAndReturn = useProvisioningStore((s) => s.provisioningDeleteNetworkAndReturn);
  const reset = useProvisioningStore((s) => s.provisioningReset);

  const stepNum = stepNumber(step);

  return {
    // State
    step,
    stepNumber: stepNum,
    selectedNetwork,
    scannedNetworks,
    provisioningError,
    connectionState,
    deviceName,
    wifiState,
    wifiIp,
    wifiRssi,
    wifiQuality,
    connectionFailed,
    pollError,
    polling,
    busy,
    // Actions
    scanForDevices,
    connectToDevice,
    selectNetwork,
    submitCredentials,
    retryConnection,
    deleteNetworkAndReturn,
    reset,
  };
}
```

### `useDeviceScanner`

For building custom device picker UIs.

```typescript
export function useDeviceScanner() {
  const discoveredDevices = useProvisioningStore((s) => s.discoveredDevices);
  const scanning = useProvisioningStore((s) => s.scanning);
  const startScan = useProvisioningStore((s) => s.startScan);
  const stopScan = useProvisioningStore((s) => s.stopScan);

  return { discoveredDevices, scanning, startScan, stopScan };
}
```

### `useBleConnection`

For monitoring/controlling the BLE connection directly.

```typescript
export function useBleConnection() {
  const connectionState = useProvisioningStore((s) => s.connectionState);
  const deviceName = useProvisioningStore((s) => s.deviceName);
  const deviceId = useProvisioningStore((s) => s.deviceId);
  const bleError = useProvisioningStore((s) => s.bleError);
  const connect = useProvisioningStore((s) => s.connectToDevice);
  const disconnect = useProvisioningStore((s) => s.disconnectDevice);

  return { connectionState, deviceName, deviceId, bleError, connect, disconnect };
}
```

### `useWifiStatus`

For displaying current WiFi state.

```typescript
export function useWifiStatus() {
  const wifiState = useProvisioningStore((s) => s.wifiState);
  const wifiSsid = useProvisioningStore((s) => s.wifiSsid);
  const wifiIp = useProvisioningStore((s) => s.wifiIp);
  const wifiRssi = useProvisioningStore((s) => s.wifiRssi);
  const wifiQuality = useProvisioningStore((s) => s.wifiQuality);
  const polling = useProvisioningStore((s) => s.polling);
  const pollError = useProvisioningStore((s) => s.pollError);
  const connectionFailed = useProvisioningStore((s) => s.connectionFailed);
  const pollOnce = useProvisioningStore((s) => s.pollOnce);

  return {
    wifiState, wifiSsid, wifiIp, wifiRssi, wifiQuality,
    polling, pollError, connectionFailed, pollOnce,
  };
}
```

### `useDeviceProtocol`

Direct access to all 13 commands for advanced users and the Manage screen.

```typescript
export function useDeviceProtocol() {
  const busy = useProvisioningStore((s) => s.busy);
  const lastCommandError = useProvisioningStore((s) => s.lastCommandError);

  return {
    busy,
    lastCommandError,
    getStatus: useProvisioningStore((s) => s.getStatus),
    scanNetworks: useProvisioningStore((s) => s.scanNetworks),
    listNetworks: useProvisioningStore((s) => s.listNetworks),
    addNetwork: useProvisioningStore((s) => s.addNetwork),
    delNetwork: useProvisioningStore((s) => s.delNetwork),
    connectWifi: useProvisioningStore((s) => s.connectWifi),
    disconnectWifi: useProvisioningStore((s) => s.disconnectWifi),
    getApStatus: useProvisioningStore((s) => s.getApStatus),
    startAp: useProvisioningStore((s) => s.startAp),
    stopAp: useProvisioningStore((s) => s.stopAp),
    getVar: useProvisioningStore((s) => s.getVar),
    setVar: useProvisioningStore((s) => s.setVar),
    factoryReset: useProvisioningStore((s) => s.factoryReset),
  };
}
```

### `useSavedNetworks`

Self-contained hook for the Manage screen's saved networks section.

```typescript
export function useSavedNetworks() {
  const [networks, setNetworks] = useState<SavedNetwork[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { listNetworks, delNetwork } = useDeviceProtocol();

  const fetchNetworks = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await listNetworks();
      setNetworks(result.networks ?? []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load networks');
    } finally {
      setLoading(false);
    }
  }, [listNetworks]);

  const deleteNetwork = useCallback(async (ssid: string) => {
    setError(null);
    try {
      await delNetwork(ssid);
      await fetchNetworks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete network');
    }
  }, [delNetwork, fetchNetworks]);

  // Fetch on mount
  useEffect(() => { fetchNetworks(); }, [fetchNetworks]);

  return { networks, loading, error, fetchNetworks, deleteNetwork };
}
```

### `useAccessPoint`

Self-contained hook for AP management.

```typescript
export function useAccessPoint() {
  const [apStatus, setApStatus] = useState<ApStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const protocol = useDeviceProtocol();

  const fetchApStatus = useCallback(async () => { /* ... */ }, []);
  const startAp = useCallback(async (params?) => { /* ... refresh after */ }, []);
  const stopAp = useCallback(async () => { /* ... refresh after */ }, []);

  useEffect(() => { fetchApStatus(); }, [fetchApStatus]);

  return { apStatus, loading, error, fetchApStatus, startAp, stopAp };
}
```

### `useDeviceVariables`

Stateless wrapper for variable get/set.

```typescript
export function useDeviceVariables() {
  const { getVar, setVar, busy } = useDeviceProtocol();
  const [error, setError] = useState<string | null>(null);

  const get = useCallback(async (key: string) => {
    setError(null);
    try {
      return await getVar(key);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      throw err;
    }
  }, [getVar]);

  const set = useCallback(async (key: string, value: string) => {
    setError(null);
    try {
      await setVar(key, value);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed');
      throw err;
    }
  }, [setVar]);

  return { getVariable: get, setVariable: set, busy, error };
}
```

---

## Pre-Built UI

### Screens

All screens are React functional components that use the hooks above. They accept no mandatory props -- all state comes from hooks. Screens are designed to be used with `ProvisioningNavigator` but can also be rendered standalone.

| Screen | Step | Hook(s) Used | Key Behavior |
|--------|------|-------------|--------------|
| `WelcomeScreen` | 1 | `useProvisioning` | "Find Devices" button. Calls `scanForDevices()`. |
| `ConnectScreen` | 2 | `useProvisioning`, `useDeviceScanner` | Shows discovered devices list. User taps a device -> `connectToDevice(id)`. Shows connecting spinner. |
| `NetworkScanScreen` | 3 | `useProvisioning` | Renders `NetworkList`. "Scan Again" button. Tap -> `selectNetwork()`. |
| `CredentialsScreen` | 4 | `useProvisioning` | Password input for selected SSID. Auto-submits for OPEN. "Connect" -> `submitCredentials()`. |
| `ConnectingScreen` | 5 | `useProvisioning`, `useWifiStatus` | Spinner while polling. Three sub-states: polling / failed / timed out. |
| `SuccessScreen` | 6 | `useProvisioning`, `useWifiStatus` | Shows IP, signal. "Done" / "Manage Device" buttons. |
| `ManageScreen` | -- | `useSavedNetworks`, `useAccessPoint`, `useDeviceVariables`, `useDeviceProtocol` | Sections: saved networks, AP, variables, factory reset. |

### Navigation

**`ProvisioningNavigator`** is a pre-wired `@react-navigation/native-stack` navigator.

```typescript
interface ProvisioningNavigatorProps {
  /** Called when provisioning completes (user taps Done on success screen) */
  onComplete?: (result: ProvisioningResult) => void;
  /** Called when user dismisses the flow (back from welcome) */
  onDismiss?: () => void;
  /** Custom theme colors */
  theme?: ProvisioningTheme;
  /** Override the provisioning config */
  config?: ProvisioningConfig;
}
```

**Navigation is driven by step state.** The navigator subscribes to `step` from the store and uses `navigation.navigate()` to switch screens. This mirrors the Vue pattern where composables drive `router.push()`, but decouples the logic from the navigation library.

```typescript
function ProvisioningNavigator({ onComplete, onDismiss, theme, config }: ProvisioningNavigatorProps) {
  const step = useProvisioningStore((s) => s.step);
  const navigation = useNavigation();

  // Navigate when step changes
  useEffect(() => {
    const screenName = stepToScreenName(step);
    if (screenName) {
      navigation.navigate(screenName);
    }
  }, [step, navigation]);

  return (
    <Stack.Navigator screenOptions={buildScreenOptions(theme)}>
      <Stack.Screen name="Welcome" component={WelcomeScreen} />
      <Stack.Screen name="Connect" component={ConnectScreen} />
      <Stack.Screen name="NetworkScan" component={NetworkScanScreen} />
      <Stack.Screen name="Credentials" component={CredentialsScreen} />
      <Stack.Screen name="Connecting" component={ConnectingScreen} />
      <Stack.Screen name="Success" component={SuccessScreen} />
      <Stack.Screen name="Manage" component={ManageScreen} />
    </Stack.Navigator>
  );
}
```

### Device Discovery Difference: Web Bluetooth vs react-native-ble-plx

The Vue reference uses the Web Bluetooth `requestDevice()` API, which shows a **browser-native device picker** -- the app has no control over the UI. In React Native with `react-native-ble-plx`, there is no system picker. The library scans for devices and builds its own list.

This means `ConnectScreen` (Step 2) in the React Native version is significantly different from the Vue version:

- **Vue:** Step 1 triggers the browser picker, Step 2 auto-connects.
- **React Native:** Step 1 shows a "Find Devices" button that starts a BLE scan, then a list of discovered devices appears. User taps one. Step 2 connects to the selected device.

The `WelcomeScreen` calls `startScan()` and the `ConnectScreen` shows the discovered device list and handles device selection. Alternatively, `WelcomeScreen` can show both the scan trigger and the results list directly.

---

## Public API / Exports

**`src/index.ts`** -- the single entry point for the library:

```typescript
// ── Types ──
export type {
  // BLE
  BleConnectionState, DiscoveredDevice, ConnectedDeviceInfo,
  BleTransportConfig, BleTransportEvents,
  // Protocol
  CommandName, AddNetworkParams, DelNetworkParams, ConnectParams,
  StartApParams, GetVarParams, SetVarParams,
  CommandEnvelope, ResponseEnvelope, ResponseEnvelopeOk, ResponseEnvelopeError,
  DeviceProtocolConfig, DeviceProtocolEvents,
  // WiFi
  WifiConnectionState, WifiAuthType, WifiStatus, ScannedNetwork, SavedNetwork,
  ScanResponseData, ListNetworksResponseData, ApStatus, DeviceVariable,
  // Provisioning
  ProvisioningStep, ProvisioningResult, ProvisioningConfig, ProvisioningTheme,
  ProvisioningManagerEvents,
  // Store
  StoreState, StoreActions, ProvisioningStore,
  BleSlice, ProtocolSlice, PollerSlice, ProvisioningSlice,
} from './types';

// ── Constants ──
export {
  SERVICE_UUID, STATUS_CHAR_UUID, COMMAND_CHAR_UUID, RESPONSE_CHAR_UUID,
  DEVICE_NAME_PREFIX, GATT_SETTLE_MS,
} from './constants';
export { PROVISIONING_STEP_ORDER, stepNumber } from './types/provisioning';

// ── Service Classes (for headless / advanced use) ──
export { BleTransport } from './services/BleTransport';
export { DeviceProtocol } from './services/DeviceProtocol';
export { ConnectionPoller } from './services/ConnectionPoller';
export { ProvisioningManager } from './services/ProvisioningManager';

// ── Service Factory (singleton access) ──
export {
  getTransport, getProtocol, getPoller, getManager,
  initializeServices, destroyServices,
} from './serviceFactory';

// ── Zustand Store ──
export { useProvisioningStore } from './store';

// ── React Hooks ──
export { useProvisioning } from './hooks/useProvisioning';
export { useDeviceScanner } from './hooks/useDeviceScanner';
export { useBleConnection } from './hooks/useBleConnection';
export { useWifiStatus } from './hooks/useWifiStatus';
export { useDeviceProtocol } from './hooks/useDeviceProtocol';
export { useSavedNetworks } from './hooks/useSavedNetworks';
export { useAccessPoint } from './hooks/useAccessPoint';
export { useDeviceVariables } from './hooks/useDeviceVariables';

// ── Pre-Built UI Components ──
export {
  ErrorBanner, LoadingSpinner, SignalIcon, StatusBadge, StepIndicator,
  PasswordInput, ConfirmDialog,
  NetworkList, NetworkListItem,
  SavedNetworkList, SavedNetworkItem,
  ApSettings, VariableEditor,
} from './components';

// ── Pre-Built Screens ──
export {
  WelcomeScreen, ConnectScreen, NetworkScanScreen, CredentialsScreen,
  ConnectingScreen, SuccessScreen, ManageScreen,
} from './screens';

// ── Navigation ──
export { ProvisioningNavigator } from './navigation';
```

### Usage Examples

**Minimal -- full pre-built UI:**

```typescript
import { ProvisioningNavigator } from 'esp-wifi-manager-react-native';

function App() {
  return (
    <NavigationContainer>
      <ProvisioningNavigator
        onComplete={(result) => console.log('Provisioned!', result)}
        onDismiss={() => console.log('Dismissed')}
      />
    </NavigationContainer>
  );
}
```

**Hooks only -- custom UI:**

```typescript
import { useProvisioning, useWifiStatus } from 'esp-wifi-manager-react-native';

function MyProvisioningScreen() {
  const { step, scannedNetworks, scanForDevices, selectNetwork, submitCredentials } = useProvisioning();
  const { wifiState, wifiIp } = useWifiStatus();

  // Build entirely custom UI using these hooks
}
```

**Headless -- no React at all:**

```typescript
import { BleTransport, DeviceProtocol, ConnectionPoller } from 'esp-wifi-manager-react-native';

const transport = new BleTransport({ deviceNamePrefix: 'ESP32-WiFi-' });
const protocol = new DeviceProtocol(transport);
const poller = new ConnectionPoller(protocol);

await transport.startScan();
transport.on('deviceDiscovered', async (device) => {
  transport.stopScan();
  await transport.connect(device.id);
  const status = await protocol.getStatus();
  console.log('WiFi status:', status);
});
```

---

## Key Design Decisions

### 1. Plain TypeScript services vs. React-coupled

**Decision:** Core services are plain TypeScript classes with no React imports.

**Rationale:** The Vue reference ties state to Vue's reactivity system (`ref`, `readonly`, `watch`). In React Native, this would mean hooks everywhere, making the logic untestable without React and unusable outside components. Plain classes with event emitters are universally usable.

### 2. Zustand over Context/Redux/Jotai

**Decision:** Zustand for state management.

**Rationale:**
- Works outside React components (services can call `useProvisioningStore.getState()` and `setState()`)
- No Provider wrapper needed (unlike Context or Redux)
- Selector-based re-renders (like Redux, unlike Context)
- Tiny bundle size (~1KB)
- Actions are just functions in the store (no action creators / reducers / sagas)

### 3. Single store with slices vs. multiple stores

**Decision:** One store with four logical slices (ble, protocol, poller, provisioning).

**Rationale:** The services are tightly coupled in practice (provisioning needs BLE state, poller needs protocol, etc.). A single store avoids cross-store subscription complexity. Slices are a logical grouping in the type system, not separate Zustand stores.

### 4. Navigation-agnostic ProvisioningManager

**Decision:** The `ProvisioningManager` emits `stepChanged` events instead of calling navigation directly.

**Rationale:** React Navigation APIs require being inside a navigation context. Services run outside React. The store bridges this gap -- it syncs `step` to React state, and the `ProvisioningNavigator` component (inside React) reacts to step changes by calling `navigation.navigate()`. This also means custom UIs can implement their own navigation logic.

### 5. Device scanning UX

**Decision:** Build a custom device list UI instead of relying on a system picker.

**Rationale:** Unlike Web Bluetooth which forces a system picker, `react-native-ble-plx` gives full control over scanning. The library provides a pre-built device list in `ConnectScreen` and the `useDeviceScanner` hook for custom UIs.

### 6. Base64 handling

**Decision:** Transparent base64 encode/decode in `BleTransport`.

**Rationale:** `react-native-ble-plx` uses base64 for all characteristic values. Upper layers should work with plain strings. The transport layer handles conversion using a `base64.ts` utility that wraps `react-native`'s `Buffer` (available via Hermes) or falls back to `base64-js`.

### 7. EventEmitter for service-to-store communication

**Decision:** A minimal typed `EventEmitter` class instead of callbacks or observables.

**Rationale:** Services need to push state changes to the store (and potentially other consumers). An event emitter is the simplest pattern that supports multiple listeners, is easy to type, and does not add dependencies (no RxJS). The `TypedEventEmitter<T>` generic ensures events and their handler signatures are type-safe.

### 8. Pre-built UI is tree-shakeable

**Decision:** Components, screens, and navigation are in separate directories and individually exported.

**Rationale:** Users who only need hooks should not pay for UI components in their bundle. Each export is independent. `react-navigation` is a peer dependency, only needed if using `ProvisioningNavigator`.

---

## Dependencies

### Dependencies (bundled)

| Package | Purpose | Version |
|---------|---------|---------|
| `zustand` | State management | ^5.x |

### Peer Dependencies (consumer must install)

| Package | Purpose | Required When |
|---------|---------|---------------|
| `react` | React core | Always |
| `react-native` | React Native core | Always |
| `react-native-ble-plx` | BLE communication | Always |
| `@react-navigation/native` | Navigation core | Using pre-built screens |
| `@react-navigation/native-stack` | Stack navigator | Using pre-built screens |
| `react-native-screens` | Native screen containers | Using pre-built screens |
| `react-native-safe-area-context` | Safe area insets | Using pre-built screens |

### Dev Dependencies

| Package | Purpose |
|---------|---------|
| `typescript` | Type checking |
| `@types/react` | React type definitions |
| `@types/react-native` | React Native type definitions |
| `jest` | Testing |
| `@testing-library/react-native` | Component testing |
| `react-native-builder-bob` | Library build tooling |
| `eslint` | Linting |
| `prettier` | Formatting |

---

## Migration Notes from Vue Reference

### Mapping: Vue composable -> React Native layers

| Vue Composable | React Native Equivalent |
|---------------|------------------------|
| `useBluetooth.js` (module-scope refs + methods) | `BleTransport` class + `BleSlice` in store + `useBleConnection` hook |
| `useDeviceProtocol.js` (module-scope refs + methods) | `DeviceProtocol` class + `ProtocolSlice` in store + `useDeviceProtocol` hook |
| `useConnectionPoller.js` (module-scope refs + methods) | `ConnectionPoller` class + `PollerSlice` in store + `useWifiStatus` hook |
| `useProvisioning.js` (module-scope refs + router.push) | `ProvisioningManager` class + `ProvisioningSlice` in store + `useProvisioning` hook + `ProvisioningNavigator` |

### Key behavioral differences

1. **Device discovery:** Web Bluetooth has a system picker. React Native has manual scanning + custom UI.
2. **Singleton pattern:** Vue uses module-scope `ref()`. React Native uses Zustand (module-scope store) + service singletons.
3. **Navigation:** Vue composable calls `router.push()` directly. React Native service emits events, navigator component handles routing.
4. **Reactivity:** Vue `watch()` maps to Zustand `subscribe()` for store-to-store reactivity, and `useEffect` for component-level reactions.
5. **Encoding:** Web Bluetooth uses `TextEncoder`/`TextDecoder` on raw `DataView`. `react-native-ble-plx` uses base64 strings.

---

## Implementation Order

The recommended implementation sequence, respecting dependencies:

1. **Types + Constants + Utilities** -- no dependencies, foundational
2. **BleTransport** -- depends on types, constants, utils, react-native-ble-plx
3. **DeviceProtocol** -- depends on BleTransport
4. **ConnectionPoller** -- depends on DeviceProtocol
5. **ProvisioningManager** -- depends on all three services
6. **Service Factory** -- wires singletons together
7. **Zustand Store** -- bridges services to React
8. **React Hooks** -- thin selectors over store
9. **UI Components** -- reusable primitives (no service dependency)
10. **Screens** -- compose hooks + components
11. **ProvisioningNavigator** -- wires screens with navigation
12. **index.ts** -- public API exports
