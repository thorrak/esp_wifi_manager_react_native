# esp-wifi-config-react-native

BLE-based WiFi provisioning for ESP32 devices from React Native apps.

Talks to ESP32 devices running [esp_wifi_config](https://github.com/thorrak/esp_wifi_config) firmware over BLE GATT, drives a 10-step state machine, and ships pre-built screens you can drop in or replace.

**Platforms:** iOS, Android, Expo (custom development build).

> **AI agents:** read [CLAUDE.md](./CLAUDE.md) first.

## Picking the right integration path

| You want… | Use | Code |
|------|------|------|
| A working wizard, zero UI work | `ProvisioningNavigator` | `import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation'` |
| Full UI control, library state machine | `useProvisioning` | `import { useProvisioning } from 'esp-wifi-config-react-native'` |
| Non-React or headless | Service classes | `import { BleTransport, DeviceProtocol } from 'esp-wifi-config-react-native'` |

See [GUIDES/](./GUIDES/) for end-to-end walkthroughs of each path.

## Installation

```bash
npm install esp-wifi-config-react-native react-native-ble-plx
```

For pre-built screens add the navigation deps:

```bash
npm install @react-navigation/native @react-navigation/native-stack \
            react-native-screens react-native-safe-area-context
```

### iOS

`Info.plist`:
```xml
<key>NSBluetoothAlwaysUsageDescription</key>
<string>This app uses Bluetooth to configure WiFi on your device</string>
```
Then `cd ios && pod install`.

### Android

`AndroidManifest.xml`:
```xml
<uses-permission android:name="android.permission.BLUETOOTH_SCAN" />
<uses-permission android:name="android.permission.BLUETOOTH_CONNECT" />
<uses-permission android:name="android.permission.ACCESS_FINE_LOCATION" />
```
Use `requestBluetoothPermissions()` from this library to handle the runtime prompt.

### Expo

```bash
npx expo install react-native-ble-plx expo-build-properties
npm install esp-wifi-config-react-native
```

`app.json`:
```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "ios": { "deploymentTarget": "13.4" } }],
      ["react-native-ble-plx", { "isBackgroundEnabled": false, "neverForLocation": true }]
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

Then `npx expo prebuild && npx expo run:ios`.

## Quick start — pre-built navigator

```tsx
import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation';

export default function ProvisionScreen() {
  return (
    <ProvisioningNavigator
      config={{
        ble: { deviceNamePrefix: ['MyDevice-', 'OtherDevice-'] },
      }}
      onComplete={(result) => console.log('Provisioned!', result.ssid, result.ip)}
      onDismiss={() => router.back()}
    />
  );
}
```

`ProvisioningNavigator` mounts an isolated React Navigation tree so it works inside Expo Router or any existing navigator without conflict.

See `examples/minimal-app.tsx` for the complete Expo file.

## Quick start — custom UI

```tsx
import {
  useProvisioning,
  useDeviceScanner,
  requestBluetoothPermissions,
} from 'esp-wifi-config-react-native';

export default function MyWizard() {
  const {
    step, error, device, scannedNetworks, selectedNetwork,
    start, chooseDevice, chooseNetwork, submitPassword, cancel,
  } = useProvisioning();
  const { discoveredDevices } = useDeviceScanner();

  const handleStart = async () => {
    const r = await requestBluetoothPermissions();
    if (!r.granted) return;
    await start();
  };

  switch (step) {
    case 'welcome': return <Welcome onStart={handleStart} error={error} />;
    case 'scanBle':
    case 'connectingBle':
      return <Devices devices={discoveredDevices} onPick={chooseDevice} device={device} />;
    case 'configuring': return <Configuring />;
    case 'scanningWifi':
    case 'chooseNetwork':
      return <Networks list={scannedNetworks} onPick={chooseNetwork} />;
    case 'enterCredentials':
      return <Credentials network={selectedNetwork} onSubmit={submitPassword} />;
    case 'joiningWifi':
      return <Joining error={error} />;
    case 'success':
      return <Done onClose={cancel} />;
  }
}
```

Full version: `examples/custom-wizard.tsx`. Step-by-step walkthrough: `GUIDES/02-custom-ui-with-hooks.md`.

## The step machine

```
welcome → scanBle ⇄ connectingBle → configuring → scanningWifi ⇄ chooseNetwork
                                                                       ↓
                                       success ← joiningWifi ← enterCredentials
                                          ↓
                                        manage
```

Adjacent sub-steps share a screen (e.g. `scanBle`/`connectingBle` both render the device list); the granularity exists so spinner overlays, button states, and progress copy are deterministic. See [CLAUDE.md](./CLAUDE.md) for the full mapping table.

## Action verbs

`useProvisioning()` returns these. Each maps directly to user intent.

| Verb | Use from step | Goes to |
|------|------|------|
| `start()` | any | scanBle |
| `chooseDevice(d)` | scanBle | connectingBle → … → chooseNetwork |
| `proceedFromConfigure()` | configuring | scanningWifi → chooseNetwork |
| `chooseNetwork(n)` | chooseNetwork | enterCredentials |
| `backToNetworks()` | enterCredentials | chooseNetwork |
| `submitPassword(pw)` | enterCredentials | joiningWifi |
| `retryJoin()` | joiningWifi | (re-run) |
| `pickDifferentNetwork()` | joiningWifi | chooseNetwork (deletes failed network) |
| `pickDifferentDevice()` | any | scanBle |
| `cancel()` | any | welcome |
| `goToManage()` | success | manage |
| `rescanWifi()` | chooseNetwork | scanningWifi → chooseNetwork |

## Configuration

```ts
type ProvisioningConfig = {
  ble?: BleTransportConfig;        // scan timeout, MTU, deviceNamePrefix
  protocol?: DeviceProtocolConfig; // command timeouts
  poller?: { intervalMs?; timeoutMs? };
  flow?: {
    onConnected?: (ctx) => Promise<void>; // pre-WiFi customization
    defaultNetworkPriority?: number;       // default 10
    autoConnectOpenNetworks?: boolean;     // default true
  };
};
```

Multi-prefix scanning:
```ts
config={{ ble: { deviceNamePrefix: ['BrewPi-', 'TiltBridge-'] } }}
```

Pre-WiFi setup (e.g. set hostname before provisioning):
```ts
config={{
  flow: {
    onConnected: async ({ protocol }) => {
      await protocol.setVar('mdns_name', 'my-device');
    },
  },
}}
```

See `GUIDES/04-pre-wifi-customization.md` for the full pattern.

## Error handling

Single envelope, no field-merging:
```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'poller' | 'flow';
  code?: string;
  message: string;
  recoverable: boolean;
};
```

```tsx
const { error } = useProvisioning();
return (
  <>
    {error && <Banner severity={error.recoverable ? 'warning' : 'error'}>{error.message}</Banner>}
    {error?.code === 'unauthorized' && <OpenSettingsLink />}
  </>
);
```

Full guide: `GUIDES/05-error-handling.md`.

## Hooks

| Hook | Returns |
|------|------|
| `useProvisioning` | step, device, error, lastResult, action verbs (full wizard) |
| `useDeviceScanner` | discoveredDevices, scanning, lastScanResult |
| `useBleConnection` | device |
| `useWifiStatus` | wifiState, wifiSsid, wifiIp, wifiRssi, wifiQuality, polling, pollOnce |
| `useDeviceProtocol` | every command + per-instance loading + error |
| `useDeviceVariables` | getVariable, setVariable + per-instance loading + error |
| `useSavedNetworks` | networks, fetchNetworks, deleteNetwork, loading, error |
| `useAccessPoint` | apStatus, startAp, stopAp, fetchApStatus, loading, error |

## Pre-built screens

Each screen renders one or two adjacent steps. Compose into `ProvisioningNavigator` or use individually.

| Screen | Renders steps |
|------|------|
| `WelcomeScreen` | welcome |
| `ConnectScreen` | scanBle, connectingBle |
| `ConfigureScreen` | configuring |
| `NetworkScanScreen` | scanningWifi, chooseNetwork |
| `CredentialsScreen` | enterCredentials |
| `ConnectingScreen` | joiningWifi |
| `SuccessScreen` | success |
| `ManageScreen` | manage |

## Pre-built components

`ErrorBanner`, `LoadingSpinner`, `SignalIcon`, `StatusBadge`, `StepIndicator`, `PasswordInput`, `ConfirmDialog`, `NetworkList`, `NetworkListItem`, `SavedNetworkList`, `SavedNetworkItem`, `DeviceListItem`, `ApSettings`, `VariableEditor`. Compose freely with custom UI.

## Theming

```tsx
<ProvisioningNavigator
  theme={{
    colors: {
      primary: '#6366F1',
      background: '#0F172A',
      card: '#1E293B',
      text: '#F8FAFC',
    },
    borderRadius: 16,
  }}
/>
```

## Permissions

```ts
import { requestBluetoothPermissions } from 'esp-wifi-config-react-native';

const r = await requestBluetoothPermissions();
// { granted: true } | { granted: false, reason: 'denied' | 'never_ask_again' }
```

Handles iOS (no-op + first-use dialog from Info.plist) and Android 12+/<12 (BLUETOOTH_SCAN/CONNECT vs ACCESS_FINE_LOCATION).

## ESP32 device requirements

| Requirement | Value |
|------|------|
| BLE service UUID | `0000FFE0-0000-1000-8000-00805F9B34FB` |
| Status characteristic | `0xFFE1` (Read, Notify) |
| Command characteristic | `0xFFE2` (Write) |
| Response characteristic | `0xFFE3` (Read, Notify) |
| Default device name prefix | `ESP32-WiFi-` (override via `deviceNamePrefix`) |
| Protocol | JSON command/response over GATT |

Full BLE protocol spec: [bluetooth-provisioning.md](./bluetooth-provisioning.md).

## Architecture

`BleTransport → DeviceProtocol → ConnectionPoller → ProvisioningManager → Zustand store → React hooks → screens`. See [ARCHITECTURE.md](./ARCHITECTURE.md).

## Development

```bash
npm install
npm run typecheck
npm test
npm run lint
npm run build  # CommonJS + ESM + .d.ts
```

## Documentation map

- [CLAUDE.md](./CLAUDE.md) — agent integration guide (start here)
- [GUIDES/](./GUIDES/) — task-oriented walkthroughs
- [examples/](./examples/) — complete copy-pasteable files
- [API.md](./API.md) — exhaustive symbol reference
- [ARCHITECTURE.md](./ARCHITECTURE.md) — internal layering and event flow
- [bluetooth-provisioning.md](./bluetooth-provisioning.md) — BLE protocol spec
- [CHANGELOG.md](./CHANGELOG.md) — version history

## License

MIT
