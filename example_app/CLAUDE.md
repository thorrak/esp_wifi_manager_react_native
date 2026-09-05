# ESP WiFi React Test

Example / test app for the [`esp-wifi-config-react-native`](https://github.com/WiFiConfig/esp-wifi-config-react-native) library. It lives in the library repo under `example_app/` (also published standalone as [WiFiConfig/EspWifiReactTest](https://github.com/WiFiConfig/EspWifiReactTest)) and consumes the library directly from the parent directory via a local `file:..` dependency, so library edits are picked up without a reinstall.

## Firmware compatibility

The library — and therefore this app — talks ESP-IDF Network Provisioning over BLE via `@orbital-systems/react-native-esp-idf-provisioning`. It requires ESP32 devices running [`esp_wifi_config`](https://github.com/WiFiConfig/esp_wifi_config) **≥ 0.2.0** (0.2.3 recommended) with `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y`. The result screen's network-details card reads `esp-wifi-config-network-info`, which 0.1.0 never actually exposed.

## Project Structure

```
.                          # Expo SDK 54 app
├── app/
│   ├── _layout.tsx        # Root layout — registers provision route as modal
│   ├── provision.tsx      # Renders ProvisioningNavigator with permission guard + error boundary
│   └── (tabs)/
│       ├── _layout.tsx    # Home + Diagnostics tabs
│       ├── index.tsx      # Home screen with "Start WiFi Provisioning" button
│       └── diagnostics.tsx# Step-based diagnostic for BleTransport / DeviceProtocol
├── metro.config.js        # Enables package-exports for the `/navigation` subpath
├── app.json               # BLE permissions and plugin config
└── package.json
```

## Key Architecture Decisions

### Library Install Source
Local link: `"esp-wifi-config-react-native": "file:.."` in `package.json`. `metro.config.js` adds the library root to `watchFolders` and to `resolver.nodeModulesPaths`, so Metro serves the library's TypeScript source (via its `react-native` field) and hot-reloads library edits without a reinstall. (To instead test the published package, swap the `file:..` dep for the npm/GitHub version and re-run `npm install`.)

### BLE peer dep
The library wraps `@orbital-systems/react-native-esp-idf-provisioning`, which in turn wraps Espressif's official iOS / Android provisioning SDKs. We declare it as a direct dependency. Its Expo config plugin is wired up in `app.json`:

```json
["@orbital-systems/react-native-esp-idf-provisioning", { "isBackgroundEnabled": false, "neverForLocation": true }]
```

`react-native-ble-plx` is **not** used anywhere — the native SDK owns BLE.

### Metro Config (metro.config.js)
Three things: (1) `resolver.unstable_enablePackageExports = true` so the
`esp-wifi-config-react-native/navigation` subpath import resolves via the library's `package.json`
"exports" field; (2) `watchFolders` includes the library root (`..`) so edits to the library's `src/`
hot-reload here; (3) `resolver.nodeModulesPaths` lists this app's `node_modules` then the library's,
so a single React / React Native instance is used.

### ProvisioningNavigator config
`app/provision.tsx` passes:
- `ble.deviceNamePrefix: 'PROV_'` — matches the firmware's runtime `prov_ble.device_name` default template `PROV_{id}` (there is no Kconfig option for it).
- `ble.security: 1` with `ble.proofOfPossession: 'abcd1234'` — set explicitly; the library has no implicit PoP (unset → the wizard prompts; `''` → a device with no PoP). The value matches the firmware repo's `examples/with_ble`. Security and PoP are runtime fields on `wifi_cfg_prov_config_t`, not Kconfig; the firmware's own default is Security 1 with *no* PoP.
- `ble.promptForAuth: true` — enables the optional `enterDeviceAuth` step so the user types the PoP at runtime (right choice for per-device PoPs; harmless for fleet-wide PoP testing).

### Pre-flight check
`provision.tsx` uses the library's `requestBluetoothPermissions()` helper instead of any direct BLE adapter API — the native SDK owns the BLE lifecycle internally.

### Diagnostics tab
`app/(tabs)/diagnostics.tsx` instantiates `BleTransport` and `DeviceProtocol` directly to exercise each capability in isolation: permissions → scan (default + custom prefix) → connect → `getVersion()` / `getCapabilities()` / `getNetworkPolicy()` / `listVars()` / `scanWifi()` → disconnect. Useful for verifying that a firmware build exposes all five custom protocomm endpoints (`getNetworkInfo()` returns `{ connected: false }` until the device is on Wi-Fi, but a *thrown* error on 0.1.0 firmware is expected — the endpoint is unreachable there).

## Build & Run

```bash
npm install
npx expo prebuild --clean  # regenerate ios/ and android/ for the new native module
npx expo run:ios --device  # physical device
npx expo run:android       # physical device (no BLE on emulator)
```

**Must use dev builds** (`expo run:ios` / `expo run:android`), not Expo Go (`expo start`). The orbital-systems native module isn't in Expo Go.

### Android Build Requirements
- **JDK 17 required** — Gradle 8.x does not support Java 25+. JDK 17 is installed via Homebrew at `/opt/homebrew/Cellar/openjdk@17/17.0.18/libexec/openjdk.jdk/Contents/Home` but is not symlinked into `java_home`.
- **`ANDROID_HOME` is not set** in shell profile. The SDK lives at `~/Library/Android/sdk`.
- Before building Android, export both:
  ```bash
  export JAVA_HOME=/opt/homebrew/Cellar/openjdk@17/17.0.18/libexec/openjdk.jdk/Contents/Home
  export ANDROID_HOME=~/Library/Android/sdk
  ```

## Known Issues

- **Simulator has no BLE**: provisioning needs a physical device. The home screen will load on a simulator but provisioning and diagnostics won't find anything.
- **New Arch**: `newArchEnabled: true` in `app.json`. If the orbital-systems SDK ever breaks under New Arch, flipping this to `false` and re-running `expo prebuild --clean` is the escape hatch.

## Library Peer Dependencies

All configured in `app.json` and `package.json`:
- `@orbital-systems/react-native-esp-idf-provisioning` — wraps Espressif's native provisioning SDK
- `expo-build-properties` — sets iOS deployment target to 15.1 (Expo SDK 54 minimum)
- `@react-navigation/native` + `@react-navigation/native-stack` — navigation (used internally by ProvisioningNavigator)
- `react-native-screens` + `react-native-safe-area-context` — navigation peer deps

## Don't Forget

- iOS deployment target must be >= 15.1 for Expo SDK 54
- Android needs `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT`, `ACCESS_FINE_LOCATION` permissions
- iOS needs `NSBluetoothAlwaysUsageDescription` in infoPlist
- The library's only prod dependency is `zustand` — everything else is a peer dep
- The BLE protocol does NOT expose the device's IP after WiFi join — fetch via mDNS or the firmware's HTTP API on the WiFi network if needed
