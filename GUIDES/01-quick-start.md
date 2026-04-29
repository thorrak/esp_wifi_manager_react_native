# Quick start — minimal Expo app

**When to use this:** you have an Expo project (or are starting fresh) and want a working WiFi-provisioning screen with the least possible code.

**What you'll end up with:** a single-screen app that opens `ProvisioningNavigator`, scans for ESP32 devices, walks the user through provisioning, and logs the result.

## 1. Install

```bash
npx create-expo-app@latest my-provisioner
cd my-provisioner
npx expo install react-native-ble-plx expo-build-properties react-native-safe-area-context react-native-screens
npm install esp-wifi-config-react-native @react-navigation/native @react-navigation/native-stack
```

## 2. Configure `app.json`

```json
{
  "expo": {
    "plugins": [
      ["expo-build-properties", { "ios": { "deploymentTarget": "13.4" } }],
      ["react-native-ble-plx", { "isBackgroundEnabled": false, "neverForLocation": true }]
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
        ble: { deviceNamePrefix: 'ESP32-WiFi-' },
      }}
      onComplete={(result) => {
        console.log('Provisioned:', result.ssid, result.ip);
        router.back();
      }}
      onDismiss={() => router.back()}
    />
  );
}
```

That's it. The navigator owns the entire flow; you just hand it a `config` and two callbacks.

## 4. Run on a device

```bash
npx expo prebuild
npx expo run:ios --device
```

Widget testing in simulators is unreliable for BLE — use a physical device.

## 5. What happens when the user opens the screen

1. `ProvisioningNavigator` mounts → calls `initializeServices(config)` → registers store subscriptions.
2. WelcomeScreen renders. User taps "Find Devices".
3. Manager runs `start()` → step transitions to `scanBle` → BLE scan begins.
4. Discovered devices appear in the list. User taps one.
5. Manager runs `chooseDevice(d)` → step transitions to `connectingBle` (spinner overlay) → BLE handshake → `configuring` (auto-skipped, no `onConnected`) → `scanningWifi` → `chooseNetwork`.
6. User taps a network → `enterCredentials` → enters password → `submitPassword` → `joiningWifi` → device joins WiFi.
7. Poller detects success → `success` step → `onComplete` callback fires with the result.
8. User taps "Done" → `cancel()` → wizard returns to welcome.

## Customizing the flow

- **Multi-prefix scanning:** `deviceNamePrefix: ['DeviceA-', 'DeviceB-']`
- **Custom theme:** pass `theme={{ colors: { primary: '#XXX' }, borderRadius: 16 }}`
- **Pre-WiFi setup:** add `flow: { onConnected: async ({ protocol }) => { … } }`. See guide 04.
- **Replace screens individually:** import the screen components and compose your own navigator. See guide 02.

## Troubleshooting

- **"BLE adapter is not ready"** — Bluetooth is off or the OS hasn't initialized the adapter yet. The library retries for 10s before giving up.
- **No devices found** — verify `deviceNamePrefix` matches your firmware's advertised name. The store exposes `lastScanResult.sampleNames` for diagnostics.
- **Permissions denied on Android 12+** — call `requestBluetoothPermissions()` before `start()`. The pre-built navigator does NOT call this for you.
