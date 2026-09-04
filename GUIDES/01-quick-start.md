# Quick start — minimal Expo app

**When to use this:** you have an Expo project (or are starting fresh) and want a working WiFi-provisioning screen with the least possible code.

**What you'll end up with:** a single-screen app that opens `ProvisioningNavigator`, scans for ESP32 devices, walks the user through provisioning, and logs the result.

## 1. Install

```bash
npx create-expo-app@latest my-provisioner
cd my-provisioner
npx expo install expo-build-properties react-native-safe-area-context react-native-screens
npm install esp-wifi-config-react-native \
            @orbital-systems/react-native-esp-idf-provisioning \
            @react-navigation/native @react-navigation/native-stack
```

The native SDK (`@orbital-systems/react-native-esp-idf-provisioning`) is a peer dependency. You don't need `react-native-ble-plx` anymore — the SDK owns the BLE side.

## 2. Configure `app.json`

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "ios": { "deploymentTarget": "13.4" } }]
    ],
    "ios": {
      "infoPlist": {
        "NSBluetoothAlwaysUsageDescription": "Used to configure WiFi on your device"
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

## 3. Replace `app/index.tsx` (or your entry screen)

```tsx
import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation';
import { router } from 'expo-router';

export default function Index() {
  return (
    <ProvisioningNavigator
      config={{
        ble: {
          deviceNamePrefix: 'PROV_',            // default; matches the firmware's wifi_prov_scheme_ble default
          security: 1,                           // default; X25519 + AES-CTR + PoP
          proofOfPossession: 'abcd1234',         // default; override per fleet
        },
      }}
      onComplete={(result) => {
        console.log('Provisioned:', result.ssid, '→', result.provisionStatus);
        router.back();
      }}
      onDismiss={() => router.back()}
    />
  );
}
```

That's it. The navigator owns the entire flow; you just hand it a `config` and two callbacks. The device's IP arrives in `onComplete`'s `result.networkInfo` (read over BLE from the firmware's `esp-wifi-config-network-info` endpoint, firmware 0.2.0+, best-effort). If it's missing, fall back to mDNS or your firmware's HTTP API once the device is on the network.

## 4. Run on a device

```bash
npx expo prebuild
npx expo run:ios --device
```

BLE in simulators is unreliable — use a physical device.

## 5. What happens when the user opens the screen

1. `ProvisioningNavigator` mounts → calls `initializeServices(config)` → registers store subscriptions.
2. WelcomeScreen renders. User taps "Find Devices".
3. Manager runs `start()` → step transitions to `scanBle` → BLE scan begins.
4. Discovered devices appear in the list. User taps one.
5. Manager runs `chooseDevice(d)`. If a configured PoP is sufficient, the step jumps to `connectingBle` (spinner overlay). If `promptForAuth: true` (or the PoP/SRP credentials aren't configured), the step is `enterDeviceAuth` first — the user enters the credentials and `submitDeviceAuth()` advances to `connectingBle`.
6. BLE handshake → `configuring` (auto-skipped when no `onConnected`) → `scanningWifi` → `chooseNetwork`.
7. User taps a network → `enterCredentials` → enters password → `submitPassword` → `joiningWifi` → device joins WiFi.
8. The SDK's atomic `provision()` resolves on STA-connect success → step transitions to `success` → `onComplete` callback fires.
9. User taps "Done" → `cancel()` → wizard returns to welcome.

## Customizing the flow

- **Multi-prefix scanning:** `deviceNamePrefix: ['DeviceA-', 'DeviceB-']`
- **Custom theme:** pass `theme={{ colors: { primary: '#XXX' }, borderRadius: 16 }}`
- **Pre-WiFi setup:** add `flow: { onConnected: async ({ protocol }) => { … } }`. See guide 04.
- **Per-device PoP (printed on label, etc.):** set `ble: { promptForAuth: true }` so the wizard inserts an entry screen instead of using the configured default.
- **Security 0 or 2:** see the "Security versions" section in `README.md`.
- **Replace screens individually:** import the screen components and compose your own navigator. See guide 02.

## Troubleshooting

- **"BLE adapter is not ready"** — Bluetooth is off or the OS hasn't initialized the adapter yet. The library retries for 10s before giving up.
- **No devices found** — verify `deviceNamePrefix` matches your firmware's advertised name (the firmware's `prov_ble.device_name` template defaults to `PROV_{id}`, so `PROV_`). The native SDK does not report unmatched names (`lastScanResult.sampleNames` is always empty), so check the device's serial log for the `Provisioning advertising as …` line instead. Also confirm the device is actually advertising: with `provisioning_mode = ON_FAILURE` it only does so while unprovisioned.
- **"BLE connect error: unauthorized…"** — the configured `proofOfPossession` (or SRP credentials) didn't match the device. With `promptForAuth: true` the wizard bounces back to `enterDeviceAuth` with the last entered values pre-filled so the user can fix a typo without re-scanning.
- **Permissions denied on Android 12+** — call `requestBluetoothPermissions()` before `start()`. The pre-built navigator does NOT call this for you.
