# Changelog

## 1.0.0 — unreleased

Initial release. React Native library for provisioning Wi-Fi credentials onto an ESP32 over BLE
using ESP-IDF's official Network/Wi-Fi Provisioning protocol, via the
[`@orbital-systems/react-native-esp-idf-provisioning`](https://www.npmjs.com/package/@orbital-systems/react-native-esp-idf-provisioning)
native SDK. Targets [`esp_wifi_config`](https://github.com/thorrak/esp_wifi_config) 0.1.0+ firmware
with `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y`.

### Architecture

- Four layers, each depending only on the one below: `BleTransport` (wraps the native SDK's
  `searchESPDevices`/`connect`/`disconnect`) → `DeviceProtocol` (`provision()` + `scanWifiList()`
  plus JSON-over-base64 for the firmware's custom protocomm endpoints) → `ProvisioningManager`
  (wizard step machine, unified error model, `onConnected` hook) → Zustand store → React hooks →
  pre-built screens. The SDK's atomic `provision()` resolves on STA-connect success or rejects on
  failure, so there is no separate connection poller.

### Step machine

- Ten distinct steps — every visible UI state is its own step, so consumers never derive shadow
  phase enums:
  `welcome → scanBle → [enterDeviceAuth] → connectingBle → configuring → scanningWifi →
  chooseNetwork → enterCredentials → joiningWifi → success`.
- `enterDeviceAuth` is inserted when the device needs runtime credentials (sec1 PoP, or sec2
  username + SRP password) — driven by `ble.promptForAuth`, missing pre-configured credentials, or
  an `unauthorized` retry.
- `STEP_NUMBERS` collapses sub-states into stable numbered progress dots.

### Action verbs (`useProvisioning()` / `ProvisioningManager`)

`start`, `chooseDevice`, `submitDeviceAuth`, `proceedFromConfigure`, `chooseNetwork`,
`backToNetworks`, `submitPassword`, `retryJoin`, `pickDifferentNetwork`, `pickDifferentDevice`,
`cancel`, `rescanWifi`.

### Unified error model

One field, four sources:

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'provision' | 'flow';
  code?: string;        // e.g. 'unauthorized', 'provision_failed'
  message: string;
  recoverable: boolean;
};
```

### Unified device model

```ts
type DeviceConnection =
  | null
  | { status: 'connecting'; id; name; rssi: number | null }
  | { status: 'connected'; id; name; mtu: number | null };
```

### Security

- Security 0/1/2 supported. Default Security 1 (X25519 + AES-CTR + PoP `"abcd1234"`), matching the
  `esp_wifi_config` example default. Security 2 (SRP6a + AES-GCM) additionally requires a
  pre-computed salt + verifier compiled into the firmware. Production fleets should override the
  default PoP per device.

### Custom firmware endpoints (`DeviceProtocol`)

- `scanWifi()`, `provision()`, `getVersion()`, `getCapabilities()`, `getNetworkPolicy()`,
  `listVars()`, `getVar()`, `setVar()`, `delVar()`. These only work while the BLE protocomm session
  is alive — schedule them inside `flow.onConnected` or before `submitPassword()`. Post-provisioning
  device management (and the device IP, which the BLE SDK does not surface) is via the device's HTTP
  API once it is on the network.

### Hooks

`useProvisioning`, `useDeviceScanner`, `useBleConnection`, `useDeviceProtocol`,
`useDeviceVariables`. `useDeviceProtocol`/`useDeviceVariables` track loading per-instance (no global
busy flag).

### Other

- `config.flow.onConnected` runs after BLE connect, before the Wi-Fi scan, for pre-provisioning
  setup (hostname, app variables, firmware checks). Throwing parks the manager on `configuring` with
  a recoverable `flow`-source error.
- `lastResult` survives `cancel()` so the success screen stays rendered after the device drops BLE.
- Multi-prefix scanning: `deviceNamePrefix` accepts `string | string[]`.
- `requestBluetoothPermissions()` helper for Android 12+/<12 and iOS.
- `BleTransport` emits `scanCompleted` after every scan; the `error` event is reserved for true
  failures (BLE off, unauthorized, scan error) — an empty scan is not an error.

### Notable fixes during development

- **`joiningWifi` is disconnect-safe** — the firmware reboots on a successful provision and drops
  BLE as soon as the client disconnects after seeing "connected", which can race the resolution of
  the SDK's atomic `provision()`. A BLE disconnect on `joiningWifi` is treated as success, not a
  fatal `connection_lost`; the real outcome comes from the `provision()` promise. Verified
  end-to-end on iOS hardware across Security 0/1/2. (Pairs with the firmware raising its
  reboot-on-success backstop 3 s → 15 s; see `bluetooth_spec.md` §18.2.)
- **Custom protocomm endpoints send `{}` for empty requests** — a zero-length write is not
  dispatched by the ESP32 protocomm BLE transport, so `getVersion`/`getCapabilities`/
  `getNetworkPolicy` would otherwise get no response. See `bluetooth_spec.md` §12 and §18.5.
