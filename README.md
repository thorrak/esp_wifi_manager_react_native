# esp-wifi-manager-react-native

BLE-based WiFi provisioning for ESP32 devices from React Native apps.

## Overview

`esp-wifi-manager-react-native` is a React Native library that lets your mobile app configure WiFi on ESP32 IoT devices over Bluetooth Low Energy. It communicates with ESP32 devices running the [esp_wifi_manager](https://github.com/tuanpmt/esp_wifi_manager) firmware using a structured JSON protocol over BLE GATT characteristics.

The library supports three usage modes to fit any integration need:

| Mode | Best for | What you get |
|------|----------|--------------|
| **Pre-built UI wizard** | Ship fast with zero UI work | Drop-in `ProvisioningNavigator` with full screen flow |
| **Custom UI with hooks** | Full control over look and feel | React hooks for every provisioning operation |
| **Headless service classes** | Non-React code, background tasks, testing | Plain TypeScript classes with no React dependency |

**Platforms:** iOS and Android.

> **Expo:** Fully supported with [custom development builds](https://docs.expo.dev/develop/development-builds/introduction/). Not compatible with Expo Go (requires native BLE module). See [Expo Setup](#expo-setup) below.

## Features

- **BLE scanning and connection** -- discover ESP32 devices by name prefix, connect with MTU negotiation, automatic Bluetooth adapter readiness checks
- **WiFi network scanning** -- trigger a WiFi scan on the device and retrieve visible networks with signal strength and auth type
- **Network provisioning** -- add a network with password, instruct the device to connect, and poll until connected
- **Connection status polling** -- monitor WiFi state, IP address, signal quality, and uptime in real time
- **Saved network management** -- list, add, and delete saved networks stored on the device
- **Access Point control** -- start/stop the device's soft AP and monitor connected stations
- **Custom variable get/set** -- read and write application-defined key/value pairs on the device
- **Factory reset** -- restore device to factory defaults over BLE
- **Full TypeScript support** -- every type, hook, and class is fully typed and exported
- **Theming** -- customize colors and border radius on the pre-built screens
- **Pre-built screens OR hooks-only** -- use the complete wizard or build your own UI from scratch

## Installation

```bash
npm install esp-wifi-manager-react-native react-native-ble-plx
# or
yarn add esp-wifi-manager-react-native react-native-ble-plx
```

### Peer dependencies

`react-native-ble-plx` is always required. The following are only needed if you use the pre-built screens (`ProvisioningNavigator`):

```bash
npm install @react-navigation/native @react-navigation/native-stack react-native-screens react-native-safe-area-context
```

| Dependency | Required when |
|------------|--------------|
| `react-native-ble-plx` >= 3.0.0 | Always |
| `@react-navigation/native` >= 7.0.0 | Pre-built screens only |
| `@react-navigation/native-stack` >= 7.0.0 | Pre-built screens only |
| `react-native-screens` >= 4.0.0 | Pre-built screens only |
| `react-native-safe-area-context` >= 4.0.0 | Pre-built screens only |

### iOS setup

Add BLE usage descriptions to your `Info.plist`:

```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>This app uses Bluetooth to configure WiFi on your device</string>
<key>NSBluetoothPeripheralUsageDescription</key>
<string>This app uses Bluetooth to configure WiFi on your device</string>
```

Then install pods:

```bash
cd ios && pod install
```

### Android setup

Add permissions to `AndroidManifest.xml`:

```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```

> **Note:** Android 12+ (API 31+) requires runtime permission requests for `BLUETOOTH_SCAN` and `BLUETOOTH_CONNECT`. Your app must request these permissions before calling any library methods. The library does not handle runtime permission prompts itself.

### Expo setup

This library requires `react-native-ble-plx`, a native module that is **not available in Expo Go**. You must use a [custom development build](https://docs.expo.dev/develop/development-builds/introduction/).

**1. Install dependencies:**

```bash
npx expo install react-native-ble-plx expo-build-properties
npm install esp-wifi-manager-react-native
```

**2. Configure permissions in `app.json`:**

```json
{
  "expo": {
    "plugins": [
      [
        "expo-build-properties",
        {
          "ios": {
            "deploymentTarget": "13.4"
          }
        }
      ],
      [
        "react-native-ble-plx",
        {
          "isBackgroundEnabled": false,
          "neverForLocation": true
        }
      ]
    ],
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "This app uses Bluetooth to configure WiFi on your device"
      }
    },
    "android": {
      "permissions": [
        "android.permission.BLUETOOTH_SCAN",
        "android.permission.BLUETOOTH_CONNECT",
        "android.permission.ACCESS_FINE_LOCATION"
      ]
    }
  }
}
```

**3. Build and run:**

```bash
npx expo prebuild
npx expo run:ios    # or: npx expo run:android
```

## Quick Start -- Pre-built UI

The fastest way to get WiFi provisioning working. `ProvisioningNavigator` renders a complete multi-step wizard: device scanning, network selection, password entry, connection monitoring, and a success/manage screen.

> **Note:** `ProvisioningNavigator` is exported from a separate entry point to avoid requiring `@react-navigation` for hooks-only users.

### With React Navigation (classic)

```tsx
import { NavigationContainer } from '@react-navigation/native';
import { ProvisioningNavigator } from 'esp-wifi-manager-react-native/navigation';

function App() {
  return (
    <NavigationContainer>
      <ProvisioningNavigator
        onComplete={(result) => {
          console.log('Provisioned!', result.ssid, result.ip);
        }}
        onDismiss={() => console.log('User dismissed')}
      />
    </NavigationContainer>
  );
}
```

### With Expo Router

Expo Router provides its own `NavigationContainer`, so you should **not** wrap `ProvisioningNavigator` in one. Instead, render it inside a route:

```tsx
// app/provision.tsx
import { ProvisioningNavigator } from 'esp-wifi-manager-react-native/navigation';

export default function ProvisionScreen() {
  return (
    <ProvisioningNavigator
      onComplete={(result) => {
        console.log('Provisioned!', result.ssid, result.ip);
      }}
      onDismiss={() => router.back()}
    />
  );
}
```

### With Expo Router (hooks-only)

For full control over navigation, use hooks without the pre-built navigator:

```tsx
// app/provision/index.tsx
import { useProvisioning, useDeviceScanner } from 'esp-wifi-manager-react-native';

export default function ProvisionScreen() {
  const { step, scannedNetworks, scanForDevices, connectToDevice, submitCredentials } = useProvisioning();
  const { discoveredDevices, scanning, startScan } = useDeviceScanner();

  // Build your own UI and handle navigation with expo-router...
}
```

### ProvisioningNavigator props

| Prop | Type | Description |
|------|------|-------------|
| `onComplete` | `(result: ProvisioningResult) => void` | Called when provisioning succeeds |
| `onDismiss` | `() => void` | Called when the user taps Close/dismiss |
| `theme` | `ProvisioningTheme` | Custom colors and border radius |
| `config` | `ProvisioningConfig` | BLE, protocol, and polling configuration |

## Usage -- Custom UI with Hooks

Use hooks to build your own provisioning flow with full control over the UI.

```tsx
import {
  useProvisioning,
  useDeviceScanner,
  useWifiStatus,
} from 'esp-wifi-manager-react-native';

function MyProvisioningScreen() {
  const {
    step,
    stepNumber,
    scannedNetworks,
    provisioningError,
    scanForDevices,
    connectToDevice,
    selectNetwork,
    submitCredentials,
    reset,
  } = useProvisioning();

  const { discoveredDevices, scanning, startScan, stopScan } = useDeviceScanner();
  const { wifiState, wifiIp, wifiSsid, wifiQuality } = useWifiStatus();

  // Build your own UI using these values and actions...
}
```

### Available hooks

| Hook | Purpose |
|------|---------|
| `useProvisioning` | Full wizard state machine: step, networks, actions (scanForDevices, connectToDevice, selectNetwork, submitCredentials, reset, etc.) |
| `useDeviceScanner` | BLE device discovery: discoveredDevices, scanning, startScan, stopScan |
| `useBleConnection` | BLE connection management: connectionState, deviceName, deviceId, connectToDevice, disconnectDevice |
| `useWifiStatus` | WiFi state from the device: wifiState, wifiSsid, wifiIp, wifiRssi, wifiQuality, polling, pollOnce |
| `useDeviceProtocol` | Direct access to all device commands: getStatus, scanNetworks, addNetwork, delNetwork, connectWifi, startAp, stopAp, getVar, setVar, factoryReset |
| `useSavedNetworks` | Saved network CRUD: networks, fetchNetworks, deleteNetwork, loading, error |
| `useAccessPoint` | Soft AP control: apStatus, startAp, stopAp, fetchApStatus, loading, error |
| `useDeviceVariables` | Custom key/value pairs: getVariable, setVariable, error |

## Usage -- Headless (No React)

Use the service classes directly for non-React code, background tasks, or testing.

```typescript
import { BleTransport, DeviceProtocol } from 'esp-wifi-manager-react-native';

const transport = new BleTransport();
const protocol = new DeviceProtocol(transport);

// Register listeners before starting the scan.
transport.on('deviceDiscovered', async (device) => {
  console.log('Found:', device.name, device.rssi);
  transport.stopScan();

  // Connect
  const info = await transport.connect(device.id);
  console.log('Connected:', info.name, 'MTU:', info.mtu);

  // Get WiFi status
  const status = await protocol.getStatus();
  console.log('WiFi:', status.state, status.ssid, status.ip);

  // Scan WiFi networks
  const { networks } = await protocol.scan();
  networks.forEach((n) => console.log(n.ssid, n.rssi, n.auth));

  // Provision a network
  await protocol.addNetwork({ ssid: 'MyNetwork', password: 'secret123' });
  await protocol.connectWifi('MyNetwork');

  // Clean up
  await transport.disconnect();
  await transport.destroy();
});

// Scan for devices (waits for BLE adapter to be ready).
await transport.startScan();
```

### Service class overview

| Class | Layer | Responsibility |
|-------|-------|----------------|
| `BleTransport` | 1 -- Transport | BLE scanning, connection, GATT read/write, chunked JSON reassembly, notification monitoring |
| `DeviceProtocol` | 2 -- Protocol | JSON command/response envelope, typed command helpers (getStatus, scan, addNetwork, etc.), timeout management |
| `ConnectionPoller` | 3 -- Polling | Periodic status polling with configurable interval and timeout, connection success/failure detection |
| `ProvisioningManager` | 4 -- Orchestration | Wizard state machine, coordinates transport + protocol + poller for the full provisioning flow |

### Service factory (singleton access)

For convenience, the library provides singleton accessors so you do not need to wire services manually:

```typescript
import {
  initializeServices,
  getTransport,
  getProtocol,
  getPoller,
  getManager,
  destroyServices,
} from 'esp-wifi-manager-react-native';

// Optional: pass config before first access
initializeServices({ ble: { scanTimeoutMs: 20000 } });

const transport = getTransport();
const protocol = getProtocol();

// When done
destroyServices();
```

## API Reference

### Types

```typescript
// BLE
BleConnectionState    // 'disconnected' | 'scanning' | 'connecting' | 'connected'
DiscoveredDevice      // { id, name, rssi }
ConnectedDeviceInfo   // { id, name, mtu }
BleTransportConfig    // { deviceNamePrefix?, scanTimeoutMs?, gattSettleMs?, connectionTimeoutMs?, requestedMtu? }
BleTransportEvents    // Event map: response, status, connectionStateChanged, deviceDiscovered, scanStopped, error

// Protocol
CommandName           // 'get_status' | 'scan' | 'list_networks' | 'add_network' | 'del_network' | 'connect' | 'disconnect' | 'get_ap_status' | 'start_ap' | 'stop_ap' | 'get_var' | 'set_var' | 'factory_reset'
AddNetworkParams      // { ssid, password?, priority? }
DelNetworkParams      // { ssid }
ConnectParams         // { ssid? }
StartApParams         // { ssid?, password? }
GetVarParams          // { key }
SetVarParams          // { key, value }
CommandEnvelope       // { cmd, params? }
ResponseEnvelope      // ResponseEnvelopeOk | ResponseEnvelopeError
ResponseEnvelopeOk    // { status: 'ok' | 'success', data }
ResponseEnvelopeError // { status: 'error', error, message? }
DeviceProtocolConfig  // { defaultTimeoutMs?, commandTimeouts? }
DeviceProtocolEvents  // Event map: busyChanged, commandError

// WiFi
WifiConnectionState   // 'connected' | 'connecting' | 'disconnected'
WifiAuthType          // 'OPEN' | 'WEP' | 'WPA' | 'WPA2' | 'WPA/WPA2' | 'WPA3' | 'UNKNOWN'
WifiStatus            // { state, ssid, rssi, quality, ip, channel, netmask, gateway, dns, mac, hostname, uptime_ms, ap_active }
ScannedNetwork        // { ssid, rssi, auth }
SavedNetwork          // { ssid, priority }
ScanResponseData      // { networks: ScannedNetwork[] }
ListNetworksResponseData // { networks: SavedNetwork[] }
ApStatus              // { active, ssid, ip, sta_count }
DeviceVariable        // { key, value }

// Provisioning
ProvisioningStep      // 'welcome' | 'connect' | 'networks' | 'credentials' | 'connecting' | 'success' | 'manage'
ProvisioningResult    // { success, ssid?, ip?, deviceName?, deviceId? }
ProvisioningConfig    // { ble?, protocol?, pollIntervalMs?, pollTimeoutMs?, autoConnectOpenNetworks?, defaultNetworkPriority? }
ProvisioningTheme     // { colors?, borderRadius? }
ProvisioningManagerEvents // Event map: stepChanged, provisioningError, scannedNetworksUpdated, selectedNetworkChanged, provisioningComplete, provisioningReset, wifiStatusUpdated

// Navigation
ScreenName            // Type for pre-built screen names
ConnectionPollerEvents // Event map for ConnectionPoller
LogLevel              // Log level configuration type
```

### Components

Pre-built UI components that can be used independently or composed into a custom flow:

| Component | Description |
|-----------|-------------|
| `ProvisioningNavigator` | Complete provisioning wizard with navigation (import from `esp-wifi-manager-react-native/navigation`) |
| `NetworkList` | Scrollable list of scanned WiFi networks |
| `NetworkListItem` | Single network row with signal icon and auth badge |
| `SavedNetworkList` | List of saved networks with delete actions |
| `SavedNetworkItem` | Single saved network row |
| `DeviceListItem` | BLE device row with signal strength |
| `SignalIcon` | WiFi signal strength indicator (0-4 bars) |
| `StatusBadge` | Connection state badge (connected/connecting/disconnected) |
| `StepIndicator` | Wizard progress dots |
| `PasswordInput` | Password field with show/hide toggle |
| `ConfirmDialog` | Modal confirmation dialog |
| `ErrorBanner` | Dismissible error message banner |
| `LoadingSpinner` | Activity indicator with optional label |
| `ApSettings` | Access Point configuration panel |
| `VariableEditor` | Key/value variable editor |

### Pre-built Screens

| Screen | Description |
|--------|-------------|
| `WelcomeScreen` | Introduction and start button |
| `ConnectScreen` | BLE device scanning and selection |
| `NetworkScanScreen` | WiFi network scanning and selection |
| `CredentialsScreen` | Password entry for selected network |
| `ConnectingScreen` | Connection progress with polling |
| `SuccessScreen` | Provisioning success with device info |
| `ManageScreen` | Post-provisioning device management |

### Constants

```typescript
SERVICE_UUID        // '0000FFE0-0000-1000-8000-00805F9B34FB'
STATUS_CHAR_UUID    // '0000FFE1-0000-1000-8000-00805F9B34FB'
COMMAND_CHAR_UUID   // '0000FFE2-0000-1000-8000-00805F9B34FB'
RESPONSE_CHAR_UUID  // '0000FFE3-0000-1000-8000-00805F9B34FB'
DEVICE_NAME_PREFIX  // 'ESP32-WiFi-'
GATT_SETTLE_MS      // 120

PROVISIONING_STEP_ORDER  // ['welcome', 'connect', 'networks', 'credentials', 'connecting', 'success']
stepNumber(step)         // Convert ProvisioningStep to 1-based index (null for 'manage')
SCREEN_NAMES             // Map of step names to screen names
stepToScreenName(step)   // Convert ProvisioningStep to screen name
```

### Utilities

```typescript
setLogLevel(level: LogLevel)  // Set library-wide log verbosity
```

## Theming

Pass a custom theme to `ProvisioningNavigator` or directly to individual screens:

```tsx
<ProvisioningNavigator
  theme={{
    colors: {
      primary: '#6366F1',
      primaryText: '#FFFFFF',
      background: '#0F172A',
      card: '#1E293B',
      text: '#F8FAFC',
      textSecondary: '#94A3B8',
      border: '#334155',
      error: '#EF4444',
      success: '#22C55E',
      warning: '#F59E0B',
    },
    borderRadius: 16,
  }}
/>
```

### Default theme

| Token | Default |
|-------|---------|
| `primary` | `#2563EB` |
| `primaryText` | `#FFFFFF` |
| `background` | `#F8FAFC` |
| `card` | `#FFFFFF` |
| `text` | `#1E293B` |
| `textSecondary` | `#64748B` |
| `border` | `#E2E8F0` |
| `error` | `#EF4444` |
| `success` | `#22C55E` |
| `warning` | `#F59E0B` |
| `borderRadius` | `12` |

## Architecture

The library is organized in layers. Each layer only depends on the one below it.

```
BleTransport  ->  DeviceProtocol  ->  ConnectionPoller  ->  ProvisioningManager
                                                                    |
                                                              Zustand Store
                                                                    |
                                                              React Hooks
                                                                    |
                                                          UI Components / Screens
```

| Layer | Module | Role |
|-------|--------|------|
| 1 | `BleTransport` | Raw BLE I/O: scanning, connecting, GATT writes, notification chunking |
| 2 | `DeviceProtocol` | JSON command/response protocol: envelope formatting, typed helpers, timeouts |
| 3 | `ConnectionPoller` | Periodic `get_status` polling with success/failure/timeout detection |
| 4 | `ProvisioningManager` | Wizard state machine orchestrating layers 1-3 |
| Store | Zustand | Reactive state shared between hooks and the manager |
| Hooks | React hooks | Thin selectors over the Zustand store for use in components |
| UI | Components + Screens | Pre-built React Native views wired to hooks |

See [ARCHITECTURE.md](./ARCHITECTURE.md) for full details.

## ESP32 Device Requirements

Your ESP32 must be running [esp_wifi_manager](https://github.com/tuanpmt/esp_wifi_manager) with BLE provisioning enabled.

| Requirement | Value |
|-------------|-------|
| BLE service UUID | `0xFFE0` (full: `0000FFE0-0000-1000-8000-00805F9B34FB`) |
| Status characteristic | `0xFFE1` -- Read, Notify |
| Command characteristic | `0xFFE2` -- Write |
| Response characteristic | `0xFFE3` -- Read, Notify |
| Device name prefix | `ESP32-WiFi-` (configurable via `BleTransportConfig.deviceNamePrefix`) |
| Protocol | JSON command/response envelopes over BLE GATT |

The device must expose all three characteristics under the service UUID. The library validates this on connection and will throw a descriptive error if any are missing.

### Bluetooth adapter state

`startScan()` and `connect()` automatically wait for the Bluetooth adapter to reach `PoweredOn` state (up to 10 seconds). If the adapter is off or unavailable:

- `startScan()` emits an `error` event and `scanStopped`, then returns without scanning.
- `connect()` throws with a descriptive error message.

Your app should still request runtime Bluetooth permissions (Android 12+) and check that the user has enabled Bluetooth before calling library methods. The adapter readiness check handles transient states like the adapter still initializing on app launch.

See [bluetooth-provisioning.md](./bluetooth-provisioning.md) for the full BLE protocol specification.

## Development

```bash
# Install dependencies
npm install

# Type check
npm run typecheck

# Run tests
npm test

# Lint
npm run lint

# Build (CommonJS + ES modules + TypeScript declarations)
npm run build
```

## License

MIT
