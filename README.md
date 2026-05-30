# esp-wifi-config-react-native

BLE-based Wi-Fi provisioning for ESP32 devices from React Native apps.

Talks to ESP32 devices running [esp_wifi_config](https://github.com/thorrak/esp_wifi_config) **0.1.0+** firmware via ESP-IDF's official Wi-Fi/Network Provisioning protocol over BLE, drives a 10-step state machine, and ships pre-built screens you can drop in or replace.

It wraps Espressif's native iOS/Android provisioning SDKs via
[`@orbital-systems/react-native-esp-idf-provisioning`](https://www.npmjs.com/package/@orbital-systems/react-native-esp-idf-provisioning),
so you don't talk GATT directly.

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
npm install esp-wifi-config-react-native @orbital-systems/react-native-esp-idf-provisioning
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
npx expo install @orbital-systems/react-native-esp-idf-provisioning
npm install esp-wifi-config-react-native
```

`app.json`:
```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "ios": { "deploymentTarget": "13.4" } }],
      ["@orbital-systems/react-native-esp-idf-provisioning", { "isBackgroundEnabled": false, "neverForLocation": true }]
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
welcome → scanBle → [enterDeviceAuth] → connectingBle → configuring
                                                            ↓
                            scanningWifi ⇄ chooseNetwork
                                                ↓
                       success ← joiningWifi ← enterCredentials
```

`enterDeviceAuth` only appears when the wizard needs to collect PoP (Security 1) or username + SRP password (Security 2) credentials before connecting — see [Security versions](#security-versions) below.

Adjacent sub-steps share a screen (e.g. `scanBle`/`connectingBle` both render the device list); the granularity exists so spinner overlays, button states, and progress copy are deterministic. See [CLAUDE.md](./CLAUDE.md) for the full mapping table.

## Action verbs

`useProvisioning()` returns these. Each maps directly to user intent.

| Verb | Use from step | Goes to |
|------|------|------|
| `start()` | any | scanBle |
| `chooseDevice(d)` | scanBle | enterDeviceAuth OR connectingBle → … → chooseNetwork |
| `submitDeviceAuth({ pop?, username? })` | enterDeviceAuth | connectingBle (bounces back on unauthorized) |
| `proceedFromConfigure()` | configuring | scanningWifi → chooseNetwork |
| `chooseNetwork(n)` | chooseNetwork | enterCredentials |
| `backToNetworks()` | enterCredentials | chooseNetwork |
| `submitPassword(pw)` | enterCredentials | joiningWifi |
| `retryJoin()` | joiningWifi | (re-run) |
| `pickDifferentNetwork()` | joiningWifi | chooseNetwork (deletes failed network) |
| `pickDifferentDevice()` | any | scanBle |
| `cancel()` | any | welcome |
| `rescanWifi()` | chooseNetwork | scanningWifi → chooseNetwork |

## Configuration

```ts
type ProvisioningConfig = {
  ble?: {
    deviceNamePrefix?: string | string[];   // default 'PROV_'
    scanTimeoutMs?: number;                  // default 10000
    security?: 0 | 1 | 2;                    // default 1
    proofOfPossession?: string;              // default 'abcd1234' (sec1 PoP, sec2 SRP password)
    username?: string;                       // sec2 only, default 'wificfg'
    promptForAuth?: boolean;                 // default false — see Security versions below
  };
  protocol?: { defaultTimeoutMs?: number; endpointTimeouts?: Record<string, number> };
  flow?: {
    onConnected?: (ctx) => Promise<void>;    // pre-WiFi customization
    autoConnectOpenNetworks?: boolean;       // default true
    provisionTimeoutMs?: number;             // default 60000
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

## Security versions

The library defaults to **Security 1** (X25519 + AES-CTR + PoP) with PoP `abcd1234` — matches the firmware's Kconfig defaults. If you ship a single PoP across your fleet and bake it into the app, no extra UI is needed.

| Firmware setting | Library config | UI behavior |
|---|---|---|
| Security 0 (no encryption) | `ble: { security: 0 }` | No auth screen ever shown. |
| Security 1 (PoP), fleet-wide PoP | `ble: { security: 1, proofOfPossession: '...' }` | No auth screen. |
| Security 1 (PoP), per-device PoP | `ble: { security: 1, promptForAuth: true }` | Wizard inserts a screen where the user enters the PoP. |
| Security 2 (SRP6a) | `ble: { security: 2, proofOfPossession: '...', username: '...' }` (or set `promptForAuth: true` to ask the user) | Auth screen renders username + SRP password fields when prompting. |

`promptForAuth: true` is the right choice when each device has unique credentials printed on a label, packaged in a QR code, or otherwise out of the app's static knowledge. On an `unauthorized` rejection the wizard bounces back to the auth screen with the last-entered values pre-filled so the user can fix a typo without re-scanning.

For Security 2 specifically: the SDK's connect call takes `(pop, _, username)`, so `proofOfPossession` is reused as the SRP password.

> **Security 2 needs a device-side salt + verifier (firmware config, not app config).** The
> `esp_wifi_config` firmware refuses to start the Security 2 provisioning manager unless a
> pre-computed SRP6a **salt** and **verifier** are compiled in — the raw PoP alone is not enough
> (SRP6a stores a password-derived verifier, never the password). Generate them offline from your
> chosen username + password and embed the bytes in firmware, e.g.
> `esp_prov.py --transport ble --sec_ver 2 --sec2_gen_cred --sec2_username <user> --sec2_pwd <pw>`.
> The app then connects with that same `username` + `proofOfPossession` (the password). Security 0
> and 1 need nothing extra on the device.

## Error handling

Single envelope, no field-merging:
```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'provision' | 'flow';
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
| `useProvisioning` | step, device, error, lastResult, lastProvisionResult, action verbs (full wizard) |
| `useDeviceScanner` | discoveredDevices, scanning, lastScanResult |
| `useBleConnection` | device |
| `useDeviceProtocol` | scanWifi, getVersion, getCapabilities, getNetworkPolicy, listVars, getVar, setVar, delVar + per-instance loading + error |
| `useDeviceVariables` | listVariables, getVariable, setVariable, deleteVariable + per-instance loading + error |

## Pre-built screens

Each screen renders one or two adjacent steps. Compose into `ProvisioningNavigator` or use individually.

| Screen | Renders steps |
|------|------|
| `WelcomeScreen` | welcome |
| `ConnectScreen` | scanBle, connectingBle |
| `DeviceAuthScreen` | enterDeviceAuth |
| `ConfigureScreen` | configuring |
| `NetworkScanScreen` | scanningWifi, chooseNetwork |
| `CredentialsScreen` | enterCredentials |
| `ConnectingScreen` | joiningWifi |
| `SuccessScreen` | success |

## Pre-built components

`ErrorBanner`, `LoadingSpinner`, `SignalIcon`, `StepIndicator`, `PasswordInput`, `ConfirmDialog`, `NetworkList`, `NetworkListItem`, `DeviceListItem`, `VariableEditor`. Compose freely with custom UI.

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
| Firmware | `esp_wifi_config` 0.1.0+ with `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y` |
| Protocol | ESP-IDF Wi-Fi/Network Provisioning manager (BLE scheme) |
| Default GAP-name prefix | `PROV_` (override via `ble.deviceNamePrefix`) |
| Default Security | 1 (Curve25519 + AES-CTR with PoP) |
| Default PoP | `"abcd1234"` (override per device for production) |

The custom protocomm endpoints registered by the firmware
(`esp-wifi-config-version`, `…-capabilities`, `…-vars`,
`…-network-policy`) are exposed via `DeviceProtocol`.

## Architecture

`BleTransport → DeviceProtocol → ProvisioningManager → Zustand store → React hooks → screens`. See [ARCHITECTURE.md](./ARCHITECTURE.md). The `BleTransport` and `DeviceProtocol` layers wrap the native SDK (`@orbital-systems/react-native-esp-idf-provisioning`) instead of speaking GATT directly.

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
- [bluetooth_spec.md](./bluetooth_spec.md) — BLE provisioning protocol spec (byte-level, hardware-verified)
- [CHANGELOG.md](./CHANGELOG.md) — version history

## License

MIT
