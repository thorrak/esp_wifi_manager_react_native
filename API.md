# API Reference

> **2.x notice — partial freshness.** This reference was authored
> against the v1 custom-protocol surface. The step machine, error
> envelope, store shape, and `useProvisioning` hook are unchanged in
> v2, but `DeviceProtocol`, `BleTransport`, and the protocol commands
> have been rewritten. Until this document is fully updated, prefer:
>
>   - [CLAUDE.md](./CLAUDE.md) for the v2 mental model and pitfalls
>   - [CHANGELOG.md](./CHANGELOG.md) for the exhaustive v1 → v2 diff
>   - the TypeScript types in `src/types/` for the source-of-truth shape
>
> Symbols documented here that are **NOT** in v2: `ConnectionPoller`,
> `useWifiStatus`, `useSavedNetworks`, `useAccessPoint`, `StatusBadge`,
> `ApSettings`, `SavedNetworkList`, `SavedNetworkItem`,
> `DeviceProtocol.{getStatus,listNetworks,addNetwork,delNetwork,connectWifi,disconnectWifi,getApStatus,startAp,stopAp,factoryReset,sendCommand}`,
> store fields `wifiState`/`wifiSsid`/`wifiIp`/`wifiRssi`/`wifiQuality`/`polling`,
> error source `'poller'` (now `'provision'`).

Exhaustive reference for every exported symbol. Generated manually so it stays curated for AI agents — every entry has a one-paragraph description, an example, and `@see` cross-references.

For runnable examples see [examples/](./examples/). For task-oriented walkthroughs see [GUIDES/](./GUIDES/). For the mental model and pitfalls see [CLAUDE.md](./CLAUDE.md).

## Core hooks

### `useProvisioning()`

Primary wizard hook. Returns every piece of provisioning state plus every action verb.

```ts
const {
  step, stepNumber, error, lastResult, device,
  scannedNetworks, selectedNetwork,
  wifiState, wifiSsid, wifiIp, wifiRssi, wifiQuality, polling,
  start, chooseDevice, proceedFromConfigure, rescanWifi,
  chooseNetwork, backToNetworks, submitPassword,
  retryJoin, pickDifferentNetwork, pickDifferentDevice,
  cancel, goToManage,
} = useProvisioning();
```

State fields are reactive (re-render on change). Action verbs are stable references.

`@see` `ProvisioningStep`, `ProvisioningError`, `DeviceConnection`, `ProvisioningResult`.

### `useDeviceScanner()`

Thin selector over BLE scan state. Returns `discoveredDevices`, `scanning`, `lastScanResult`. Use when you only need the device list and not the full wizard.

```ts
const { discoveredDevices, scanning, lastScanResult } = useDeviceScanner();
```

### `useBleConnection()`

Thin selector over the unified `device` shape.

```ts
const { device } = useBleConnection();
if (device?.status === 'connected') { /* ... */ }
```

### `useWifiStatus()`

Live WiFi status during `joiningWifi`.

```ts
const { wifiState, wifiSsid, wifiIp, polling, pollOnce } = useWifiStatus();
```

`pollOnce()` triggers a single `get_status` outside the wizard's poller schedule.

### `useDeviceProtocol()`

Direct access to every device command, with per-instance `loading` and `error`.

```ts
const { getStatus, scan, addNetwork, connectWifi, getVar, setVar, factoryReset, loading, error } = useDeviceProtocol();
```

Each method throws on failure. `loading` is true while ANY call from this hook instance is in flight.

### `useDeviceVariables()`

Convenience hook for `get_var`/`set_var`. Returns `null`/`false` on error rather than throwing.

```ts
const { getVariable, setVariable, loading, error } = useDeviceVariables();
const v = await getVariable('mdns_name');         // DeviceVariable | null
const ok = await setVariable('mdns_name', 'foo'); // boolean
```

`@see` `GUIDES/04-pre-wifi-customization.md` for a full hostname-editor recipe.

### `useSavedNetworks()`

Saved-network list with auto-fetch on mount.

```ts
const { networks, fetchNetworks, deleteNetwork, loading, error } = useSavedNetworks();
```

Use on the `manage` step. Re-fetches after each delete.

### `useAccessPoint()`

Soft access point control.

```ts
const { apStatus, startAp, stopAp, fetchApStatus, loading, error } = useAccessPoint();
```

## Pre-built navigator

### `ProvisioningNavigator`

Drop-in wizard. Imported from `esp-wifi-config-react-native/navigation` to avoid forcing `@react-navigation` deps on hooks-only consumers.

```tsx
import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation';

<ProvisioningNavigator
  config={{ ble: { deviceNamePrefix: 'MyDevice-' } }}
  onComplete={(result) => router.push(`/devices/${result.deviceId}`)}
  onDismiss={() => router.back()}
  theme={{ colors: { primary: '#6366F1' } }}
/>
```

Mounts an isolated `NavigationIndependentTree`. Safe inside Expo Router or any existing navigator.

Props:
| Prop | Type | Description |
|------|------|------|
| `config` | `ProvisioningConfig` | BLE / protocol / poller / flow options |
| `onComplete` | `(result: ProvisioningResult) => void` | Fires once when provisioning succeeds |
| `onDismiss` | `() => void` | User pressed Close on welcome |
| `theme` | `ProvisioningTheme` | Visual customization |

## Pre-built screens

| Screen | Renders steps | Props |
|------|------|------|
| `WelcomeScreen` | welcome | `theme?` |
| `ConnectScreen` | scanBle, connectingBle | `theme?` |
| `ConfigureScreen` | configuring | `theme?` |
| `NetworkScanScreen` | scanningWifi, chooseNetwork | `theme?` |
| `CredentialsScreen` | enterCredentials | `theme?`, `onGoBack?` |
| `ConnectingScreen` | joiningWifi | `theme?` |
| `SuccessScreen` | success | `theme?`, `onComplete?` |
| `ManageScreen` | manage | `theme?` |

All screens consume `useProvisioning()` internally. Compose freely with custom screens if you want a hybrid wizard.

## Pre-built components

`ErrorBanner`, `LoadingSpinner`, `SignalIcon`, `StatusBadge`, `StepIndicator`, `PasswordInput`, `ConfirmDialog`, `NetworkList`, `NetworkListItem`, `SavedNetworkList`, `SavedNetworkItem`, `DeviceListItem`, `ApSettings`, `VariableEditor`. Each accepts a `theme?: ProvisioningTheme` prop.

## Service classes

### `BleTransport`

Layer 1. BLE I/O — scanning, connecting, GATT writes, JSON reassembly.

```ts
const transport = new BleTransport({ deviceNamePrefix: 'MyDevice-' });
transport.on('deviceDiscovered', d => { /* ... */ });
await transport.startScan();
await transport.connect(deviceId);
await transport.writeCommand('{"cmd":"scan"}');
await transport.disconnect();
await transport.destroy();
```

Events: `response`, `status`, `connectionStateChanged`, `deviceDiscovered`, `scanStopped`, `scanCompleted`, `error`.

### `DeviceProtocol`

Layer 2. JSON command/response over the transport with typed helpers.

```ts
const protocol = new DeviceProtocol(transport);
const status = await protocol.getStatus();
const { networks } = await protocol.scan();
await protocol.addNetwork({ ssid, password, priority: 10 });
await protocol.connectWifi(ssid);
```

Commands serialize over a single in-flight slot — calling while busy rejects with `'Command already in progress'`.

### `ConnectionPoller`

Layer 3. Periodic `get_status` with success/failure/timeout detection.

```ts
const poller = new ConnectionPoller(protocol);
poller.on('connectionSucceeded', status => { /* ... */ });
poller.on('connectionFailed', () => { /* ... */ });
poller.on('connectionTimedOut', () => { /* ... */ });
poller.startPolling(30_000, 2000);
```

### `ProvisioningManager`

Layer 4. Wizard state machine. Used internally by the store; useful for headless integration tests.

```ts
const manager = new ProvisioningManager(transport, protocol, poller, config);
manager.on('stepChanged', step => { /* ... */ });
manager.on('provisioningComplete', result => { /* ... */ });
await manager.start();
await manager.chooseDevice({ id, name, rssi });
manager.chooseNetwork(network);
await manager.submitPassword(password);
```

Public methods: `start`, `chooseDevice`, `proceedFromConfigure`, `rescanWifi`, `chooseNetwork`, `backToNetworks`, `submitPassword`, `retryJoin`, `pickDifferentNetwork`, `pickDifferentDevice`, `cancel`, `goToManage`, `destroy`.

## Service factory (singleton access)

```ts
import {
  initializeServices, destroyServices,
  getTransport, getProtocol, getPoller, getManager,
} from 'esp-wifi-config-react-native';

initializeServices({ ble: { deviceNamePrefix: 'X-' } });
const t = getTransport();
await destroyServices();
```

Idempotent — calling `initializeServices` while services exist is a no-op. Call `destroyServices()` first to force re-creation with new config.

## Store

### `useProvisioningStore`

Zustand store. Hooks select from this. Tests can `useProvisioningStore.setState({...})` to override state directly.

Exported types: `ProvisioningStoreState`, `ProvisioningStoreActions`. See `src/store/provisioningStore.ts`.

## Utilities

### `requestBluetoothPermissions()`

Runtime permission helper. Always call before `start()` on Android.

```ts
const r = await requestBluetoothPermissions();
// { granted: true } | { granted: false, reason: 'denied' | 'never_ask_again' }
```

### `setLogLevel(level)`

Library-wide log verbosity. Levels: `'debug' | 'info' | 'warn' | 'error' | 'none'`. Default: `'warn'`.

```ts
import { setLogLevel } from 'esp-wifi-config-react-native';
setLogLevel('debug');
```

## Types

### `ProvisioningStep`

```ts
type ProvisioningStep =
  | 'welcome' | 'scanBle' | 'connectingBle' | 'configuring'
  | 'scanningWifi' | 'chooseNetwork'
  | 'enterCredentials' | 'joiningWifi'
  | 'success' | 'manage';
```

### `ProvisioningError`

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'poller' | 'flow';
  code?: string;
  message: string;
  recoverable: boolean;
};
```

`@see` `GUIDES/05-error-handling.md`.

### `DeviceConnection`

```ts
type DeviceConnection =
  | null
  | { status: 'connecting'; id: string; name: string; rssi: number | null }
  | { status: 'connected'; id: string; name: string; mtu: number | null };
```

### `ProvisioningResult`

```ts
type ProvisioningResult = {
  success: boolean;
  ssid?: string;
  ip?: string;
  deviceName?: string;
  deviceId?: string;
};
```

### `ProvisioningConfig`

```ts
type ProvisioningConfig = {
  ble?: BleTransportConfig;
  protocol?: DeviceProtocolConfig;
  poller?: { intervalMs?: number; timeoutMs?: number };
  flow?: {
    onConnected?: (ctx: OnConnectedContext) => Promise<void>;
    defaultNetworkPriority?: number;       // default 10
    autoConnectOpenNetworks?: boolean;     // default true
  };
};
```

### `BleTransportConfig`

```ts
type BleTransportConfig = {
  deviceNamePrefix?: string | string[];   // default 'ESP32-WiFi-'
  scanTimeoutMs?: number;                 // default 10_000
  gattSettleMs?: number;                  // default 120
  connectionTimeoutMs?: number;           // default 10_000
  requestedMtu?: number;                  // default 517
};
```

### `DeviceProtocolConfig`

```ts
type DeviceProtocolConfig = {
  defaultTimeoutMs?: number;              // default 8_000
  commandTimeouts?: Partial<Record<CommandName, number>>;
};
```

### `OnConnectedContext`

```ts
type OnConnectedContext = {
  protocol: DeviceProtocol;
  transport: BleTransport;
};
```

### `ProvisioningTheme`

```ts
type ProvisioningTheme = {
  colors?: {
    primary?, primaryText?, background?, card?, text?,
    textSecondary?, border?, error?, success?, warning?: string;
  };
  borderRadius?: number;
};
```

### `ScanCompletedInfo`

```ts
type ScanCompletedInfo = {
  matched: number;       // devices matching deviceNamePrefix
  total: number;         // all unique devices observed
  sampleNames: string[]; // up to 5 names from non-matching devices
};
```

### `BleLibraryError`

Extends `Error`. Throwable from BLE-level operations.

```ts
type BleErrorCode =
  | 'unauthorized' | 'powered_off' | 'unsupported'
  | 'scan_error' | 'adapter_timeout' | 'unknown';
```

```ts
import { BleLibraryError } from 'esp-wifi-config-react-native';
try { await transport.connect(id); }
catch (err) {
  if (err instanceof BleLibraryError && err.code === 'unauthorized') { /* ... */ }
}
```

## Constants

| Constant | Value |
|------|------|
| `SERVICE_UUID` | `'0000FFE0-0000-1000-8000-00805F9B34FB'` |
| `STATUS_CHAR_UUID` | `'0000FFE1-0000-1000-8000-00805F9B34FB'` |
| `COMMAND_CHAR_UUID` | `'0000FFE2-0000-1000-8000-00805F9B34FB'` |
| `RESPONSE_CHAR_UUID` | `'0000FFE3-0000-1000-8000-00805F9B34FB'` |
| `DEVICE_NAME_PREFIX` | `'ESP32-WiFi-'` |
| `GATT_SETTLE_MS` | `120` |
| `PROVISIONING_STEP_ORDER` | Array of every step except `manage` |
| `STEP_NUMBERS` | `Record<ProvisioningStep, number \| null>` |
| `VISIBLE_STEP_COUNT` | `5` |

## Helpers

| Function | Returns |
|------|------|
| `stepNumber(step)` | `number \| null` — 1..5 user-visible step number |
| `stepToScreenName(step)` | `ScreenName` for the pre-built navigator |

## Navigation utilities

```ts
import { SCREEN_NAMES, stepToScreenName } from 'esp-wifi-config-react-native';
type ScreenName = (typeof SCREEN_NAMES)[keyof typeof SCREEN_NAMES];
```

`SCREEN_NAMES` keys: `Welcome`, `Connect`, `Configure`, `NetworkScan`, `Credentials`, `Joining`, `Success`, `Manage`.
