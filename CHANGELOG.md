# Changelog

## Unreleased

### Breaking

- **Removed the `manage` step, `ManageScreen`, and the `goToManage()`
  action verb.** Once the device joins WiFi the firmware tears down BLE
  (and, with the firmware's `reboot_on_provisioning_success` enabled,
  reboots shortly afterwards) — there is no BLE link left to manage
  anything from. Post-provisioning device management goes through the
  device's HTTP/REST API on the WiFi network. `useProvisioning()` no
  longer returns `goToManage`. The `manage` value is removed from
  `ProvisioningStep`, `STEP_NUMBERS`, and the navigation screen map.

### Added

- **Optional user-entered device auth.** New `enterDeviceAuth` step,
  `DeviceAuthScreen`, and `submitDeviceAuth({ pop?, username? })` verb
  let apps prompt users for per-device credentials at runtime instead
  of baking them into the app config. Inserted between `scanBle` and
  `connectingBle` when the new `ble.promptForAuth: true` flag is set,
  when the required credentials are missing from config, or when a
  previous connect attempt was rejected as `unauthorized` — in which
  case the screen pre-fills the last-entered values so the user can
  fix a typo without re-scanning.
- New `useProvisioning()` selectors: `authMode` (`'pop' | 'srp' | null`,
  derived from `ble.security`), `defaultAuthValues` (`{ pop?, username? }`
  seeded from config), and `pendingAuth` (last-submitted values).
- `BleTransport.connect(deviceId, overrides?)` now accepts per-call
  `{ pop, username }` overrides that take precedence over the
  config-level defaults.
- New `BleTransportConfig.promptForAuth?: boolean` (default `false`).
- New exported types: `DeviceAuthCredentials`, `DeviceAuthMode`.
- New exported screen: `DeviceAuthScreen` (and `DeviceAuthScreenProps`).

### Documentation

- Deleted the stale `bluetooth-provisioning.md` (described the v1
  custom 0xFFE0 protocol that no longer exists).
- `ARCHITECTURE.md` re-banner: it's now explicitly a historical v1
  document; consult `CLAUDE.md` for the current v2 model.
- `GUIDES/06-managing-saved-networks.md` rewritten — the manage step
  is gone, the page now explains that post-provisioning management
  belongs on the HTTP API.
- `README.md` adds a Security versions section and refreshed
  configuration / step machine sections.

## 2.0.0 — 2026-05-10

ESP-IDF Network Provisioning over BLE (matches `esp_wifi_config` 0.1.0+).

### Breaking

- **The custom 0xFFE0 GATT protocol is gone.** This release talks to
  Espressif's official Wi-Fi Provisioning manager via the
  `@orbital-systems/react-native-esp-idf-provisioning` native SDK
  (which itself wraps Espressif's iOS / Android SDKs). The previous
  raw `react-native-ble-plx` + JSON-over-GATT path is removed.
- **Peer dependency change**: `react-native-ble-plx` is replaced by
  `@orbital-systems/react-native-esp-idf-provisioning` (>=0.5.0).
  Update your project's `package.json` and re-run pod install.
- **Default scan prefix changed**: `"ESP32-WiFi-"` → `"PROV_"` (matches
  the firmware's `CONFIG_WIFI_CFG_NETWORK_PROVISIONING_SERVICE_PREFIX`
  Kconfig default). Override via `ProvisioningConfig.ble.deviceNamePrefix`.
- **New `BleTransportConfig.security` / `proofOfPossession` / `username`
  fields** — required for the protocomm session-init handshake. The
  defaults (Security 1, PoP `"abcd1234"`) match the firmware's Kconfig
  defaults; production fleets MUST override per device.
- **Removed protocol commands** (no longer exposed by firmware over BLE):
  `getStatus`, `listNetworks`, `addNetwork`, `delNetwork`, `connectWifi`,
  `disconnectWifi`, `getApStatus`, `startAp`, `stopAp`, `factoryReset`.
  Wi-Fi management for these still exists — just over the device's
  HTTP API once it's on the network. The wizard's WiFi-credential
  exchange now goes through the SDK's atomic `provision()` call.
- **No `ConnectionPoller`.** The SDK's `provision()` resolves on
  STA-connect success or rejects on failure, so the joiningWifi step
  awaits that promise directly. The `polling`, `wifiState`, `wifiSsid`,
  `wifiIp`, `wifiRssi`, `wifiQuality` fields are gone from the store
  and `useProvisioning()` return value.
- **Removed hooks**: `useWifiStatus`, `useSavedNetworks`, `useAccessPoint`.
  Removed components: `StatusBadge`, `ApSettings`, `SavedNetworkList`,
  `SavedNetworkItem`. The `manage` step is now a minimal device-info +
  variable-editor screen.
- **Error source renamed**: `ProvisioningError.source = 'poller'` →
  `'provision'`. The `'flow'`/`'ble'`/`'protocol'` sources are unchanged.

### Added

- `DeviceProtocol.getVersion()`, `getCapabilities()`, `getNetworkPolicy()`
  — wrap the new firmware custom protocomm endpoints
  (`esp-wifi-config-version`, `…-capabilities`, `…-network-policy`).
- `DeviceProtocol.listVars()`, `delVar()` — alongside the existing
  `getVar`/`setVar`, now backed by the `esp-wifi-config-vars` endpoint.
- `DeviceProtocol.scanWifi()` and `provision()` — typed wrappers around
  the SDK's `scanWifiList()` and `provision()`.
- `BleTransport.espDevice` getter — exposes the underlying SDK device
  for advanced flows.
- New types: `SecurityVersion`, `DeviceVersionInfo`, `DeviceCapabilities`,
  `DeviceNetworkPolicy`, `VarsRequest`, `VarsResponse`, `ProvisionResult`.

### Migration notes

- Replace the `react-native-ble-plx` peer dep with
  `@orbital-systems/react-native-esp-idf-provisioning` and re-run
  `pod install` on iOS.
- If you set `ProvisioningConfig.ble.deviceNamePrefix`, swap your
  custom prefix for `"PROV_"` (or whatever your firmware's
  `CONFIG_WIFI_CFG_NETWORK_PROVISIONING_SERVICE_PREFIX` is).
- Add `ProvisioningConfig.ble.proofOfPossession` if your firmware uses
  a non-default PoP. Set `security: 2` plus `username` for SRP6a.
- Anywhere you read `wifiState`/`wifiIp`/`wifiSsid`/etc. from
  `useProvisioning()`, switch to `lastProvisionResult` (SDK status +
  SSID) or fetch the IP from your device's HTTP API after success.
- If you used `useDeviceProtocol().addNetwork(...) + connectWifi(...)`
  outside the wizard, replace with `protocol.provision(ssid, password)`.

## 1.0.0

Initial public release. Restructured around a granular step machine, unified error envelope, and verb-named action surface.

### Step machine

10 distinct steps. Every visible UI state is its own step so consumers never have to derive shadow phase enums.

```
welcome → scanBle ⇄ connectingBle → configuring → scanningWifi ⇄ chooseNetwork
                                                                       ↓
                                       success ← joiningWifi ← enterCredentials
                                          ↓
                                        manage
```

`STEP_NUMBERS` collapses sub-states into 5 user-visible numbered steps for progress dots; sub-states share a number so labels stay stable.

### Action verbs

`ProvisioningManager` and `useProvisioning()` expose action verbs named after user intent:

`start`, `chooseDevice`, `proceedFromConfigure`, `chooseNetwork`, `backToNetworks`, `submitPassword`, `retryJoin`, `pickDifferentNetwork`, `pickDifferentDevice`, `cancel`, `goToManage`, `rescanWifi`.

### Unified error model

One field, four sources:

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'poller' | 'flow';
  code?: string;
  message: string;
  recoverable: boolean;
};
```

Replaces the previous fragmented `bleError` / `bleErrorCode` / `lastCommandError` / `pollError` / `provisioningError` fields.

### Unified device model

```ts
type DeviceConnection =
  | null
  | { status: 'connecting'; id; name; rssi: number | null }
  | { status: 'connected'; id; name; mtu: number | null };
```

Replaces `deviceName`, `deviceId`, `connectionState`. `device?.status === 'connecting'` is true through the BLE handshake.

### Pre-WiFi customization hook

`config.flow.onConnected` runs after BLE connect, before WiFi scan. Use to set hostname, app variables, or run any pre-provisioning checks. Throwing parks the manager on `configuring` with a `flow`-source error; consumer can retry via `proceedFromConfigure()`.

### Latched result

`provisioningComplete` is now wired into the store as `lastResult`. Survives `cancel()` so the Success screen stays rendered after the device drops BLE post-join.

### Per-instance hook loading

`useDeviceVariables` and `useDeviceProtocol` track loading per instance, not from a global flag. Two hook instances calling commands in parallel observe their own loading independently.

### `scanCompleted` event

`BleTransport` emits a separate `scanCompleted` event after every scan with `{ matched, total, sampleNames }`. The `error` event is reserved for true failures (BLE off, unauthorized, scan_error). Empty scans no longer surface as errors.

### `requestBluetoothPermissions` helper

Library now ships a runtime-permission helper for Android 12+/<12 + iOS no-op. No more reinventing it in every consumer.

### Multi-prefix scanning

`deviceNamePrefix: string | string[]` for vendors with multiple product lines.

### Documentation

- `CLAUDE.md`: agent-targeted integration guide.
- `GUIDES/`: 7 task-oriented walkthroughs.
- `examples/`: 4 complete copy-pasteable files.
- `API.md`: exhaustive symbol reference.
- `llms.txt`: AI-agent index of all docs.

### Regression fixes

- Post-success BLE drop no longer raises a "Bluetooth connection lost" error and resets to `welcome`. Disconnect listener exempts `success` and `manage`.
- `provisioningComplete` event now reaches hooks (was emitted but never subscribed).
- `useDeviceVariables` no longer collides with the wizard's protocol activity (per-instance loading tracker).

### Repo

Renamed from `esp_wifi_manager_react_native` to `esp-wifi-config-react-native`. Origin URL updated to match.
