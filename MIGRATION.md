# Migration guide

This document tracks two things:

1. **Firmware alignment** — which `esp_wifi_config` releases this library targets, what changed on
   the device side between them, and what (if anything) the library had to do about it.
2. **App migration** — the checklist for moving an app written against an earlier draft of this
   library (or against the pre-0.1.0 custom-GATT protocol) onto the current API.

The library has never been published, so there are no library-version sections; the "current API"
is always `main`. Dates below are when the audit was done, not release dates.

---

## Firmware compatibility

| `esp_wifi_config` | Status | Notes |
|---|---|---|
| < 0.1.0 | **Unsupported** | Custom JSON-over-GATT service (`0xFFE0`). A different protocol entirely; this library cannot talk to it. |
| 0.1.0 | Works, degraded | Provisioning (Security 0/1/2), Wi-Fi scan, and four of the five custom endpoints work. `esp-wifi-config-network-info` was registered but its GATT characteristic was never created, so `waitForNetworkInfo()` resolves `null` and `lastResult.networkInfo` stays `undefined`. |
| 0.2.0 – 0.2.3 | **Supported (target)** | All five endpoints reachable. Audited against 0.2.3 on 2026-09-03. |

The firmware build must have `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y` (which implies
`CONFIG_WIFI_CFG_NETWORK_PROVISIONING_BLE=y`). Those are the *only* Kconfig options that concern
this library. Device name, security version, PoP, Security 2 salt/verifier/username, reboot
behaviour and everything else are runtime fields on `wifi_cfg_prov_config_t` (`config.prov_ble.*`)
set in the firmware's `main.c`.

---

## Firmware 0.1.0 → 0.2.3: what changed, as seen from this library

Audit date: **2026-09-03**, firmware repo at tag `0.2.3` (`../esp_wifi_config/`).

### Unchanged — the wire contract

Nothing this library sends or parses over BLE changed between 0.1.0 and 0.2.3:

- The five custom endpoint names (`esp-wifi-config-version`, `-capabilities`, `-vars`,
  `-network-policy`, `-network-info`) and their JSON request/response shapes, including the `vars`
  ops (`list` / `get` / `set` / `del`) and error strings (`not_found`, `missing_key`,
  `missing_key_or_value`, `store_full`, `rejected`, `unknown_op`, `bad_json`, `empty_request`).
- Security 0 / 1 / 2 handshakes (these are ESP-IDF's, not the library's).
- The default GAP name template `PROV_{id}`.
- Reboot-on-success (default on) with the 15 s backstop after `CRED_SUCCESS`, or sooner when the
  client disconnects. The library's disconnect-safe `joiningWifi` handling and the 3 × 1 s
  `waitForNetworkInfo()` budget were sized against this and still fit.
- The zero-length-write gotcha: protocomm does not dispatch an empty write, so read-only endpoints
  are still called with `{}`.
- Firmware-side `CRED_FAIL` semantics with the default `prov_ble.wifi_conn_attempts = 0`: an auth
  failure or "AP not found" fails on the first STA disconnect, so a wrong password surfaces
  promptly as a `provision`-source error. (If a firmware sets `wifi_conn_attempts = N`, the device
  retries N times before reporting failure — raise `flow.provisionTimeoutMs` accordingly.)

### 0.2.0 (2026-08-22)

| Firmware change | Effect on this library |
|---|---|
| `esp-wifi-config-network-info` now created as well as registered — reachable for the first time. | The network-info feature (`getNetworkInfo`, `waitForNetworkInfo`, `ProvisioningResult.networkInfo`, the success-screen IP display) only works from here on. **Minimum firmware raised to 0.2.0.** |
| `wifi_provisioning_mode_t` and `wifi_reconnect_exhausted_action_t` renumbered. | None. `esp-wifi-config-network-policy` reports `provisioning_mode` as a string (`"on_failure"`, …), never the number. The library now types it as `DeviceProvisioningMode`. |
| `esp_bus` removed; events moved to `esp_event`. | None (device-internal). |
| `WIFI_CFG_DEFAULTS`; `wifi_cfg_init()` no longer patches unset fields. | None for the app. Worth knowing: the firmware's `prov_ble.pop` default is **no PoP** and `prov_ble.security` default resolves to **Security 1**. The library's `DEFAULT_POP = 'abcd1234'` matches `examples/with_ble`, not the firmware default. |
| `prov_ble.security2_username` no longer documented as defaulting to `"wificfg"`; it is app metadata that never reaches `wifi_prov_mgr`. | Docs corrected. The library keeps `'wificfg'` as its default because `examples/with_ble` still uses it, but it must match whatever the device's salt + verifier were derived from. |
| HTTP hardening (JSON depth limit, LRU purge, body draining, error responses keep the connection). | None for BLE. Apps talking to the REST API afterwards simply see fewer edge-case failures. |

### 0.2.1 (2026-08-22)

| Firmware change | Effect on this library |
|---|---|
| The SoftAP is re-raised when `wifi_prov_mgr` forces STA mode. | None. A device may now advertise BLE *and* run its captive-portal AP at the same time; the library only looks at BLE. |

### 0.2.2 (2026-08-24)

| Firmware change | Effect on this library |
|---|---|
| REST responses use `Transfer-Encoding: chunked` and are streamed through a small writer. | None for BLE — the protocomm endpoints still build their JSON with cJSON, byte-identical to before. For post-provisioning HTTP calls `fetch()` handles chunking transparently; noted in `GUIDES/06`. |

### 0.2.3 (2026-08-29)

| Firmware change | Effect on this library |
|---|---|
| `CONFIG_WIFI_CFG_ENABLE_SOFTAP` (default `y`). With `n`, the SoftAP, HTTP server and REST API are compiled out. | The "manage over HTTP afterwards" path in `GUIDES/06` may not exist on BLE-only builds; the guide now says so and points at `flow.onConnected` as the only configuration channel in that case. `getCapabilities()` reports `softap` only when the AP is enabled at runtime, which is a proxy, not a guarantee, that HTTP is present. |

### Firmware quirks the library works around or documents

- **`DeviceVersionInfo.lib` is stale.** `PROV_LIB_VERSION_STRING` in
  `src/esp_wifi_config_prov_ble.c` is hardcoded to `"esp_wifi_config 0.1.0"` in every release
  through 0.2.3. Gate on `fw_version` (the app's `esp_app_desc_t.version`) or `firmware_version`
  (`prov_ble.firmware_version`) instead. Reported upstream (see *Firmware follow-ups*).
- **Security 1 with no PoP** (the firmware default when `prov_ble.pop` is unset) is selected by
  passing `proofOfPossession: ''`. The library has no implicit PoP: unset means "prompt the user",
  `''` means "this device has none". Both the firmware (`protocomm/security1.c`) and the native
  SDKs skip the PoP mixing step for an empty value, and the iOS SDK additionally honours the
  device's advertised `no_pop` capability. Not yet exercised on hardware.

---

## Library changes made for 0.2.x alignment (2026-09-03)

Wire-compatible; no step-machine or verb changes. Full list in `CHANGELOG.md` under
*Firmware alignment*.

- Minimum firmware **0.2.0** in README, CLAUDE.md, llms.txt, `package.json` description, example
  app docs.
- "Four custom endpoints" → five, everywhere.
- Removed references to Kconfig options that do not exist
  (`CONFIG_WIFI_CFG_NETWORK_PROVISIONING_{SERVICE_PREFIX,POP,SECURITY2_USERNAME,SECURITY_*}`).
- `useDeviceProtocol().getNetworkInfo()` and the matching store action.
- Pre-built `SuccessScreen` renders IP / hostname / signal from `lastResult.networkInfo`.
- New types `DeviceCapability`, `DeviceProvisioningMode`; `DeviceVersionInfo.lib` documented as
  unreliable.
- **`proofOfPossession` no longer defaults to `'abcd1234'`.** Unset → the wizard inserts
  `enterDeviceAuth` (which the docs always claimed, but the implicit default made unreachable) and
  a headless `connect()` throws the new `BleLibraryError` code `missing_credentials`; `''` →
  Security 1 with no PoP, no prompt. `DEFAULT_POP` stays exported for apps that want the
  `examples/with_ble` value by name. The example app now passes it explicitly.
- Removed the unused `DEFAULT_SDK_TIMEOUT_MS` export.
- `tsconfig.json` excludes `example_app/` and `harness/`, so `npm run typecheck` passes.
- `npm run lint` works again: ESLint 10 flat config (`eslint.config.mjs`) with `typescript-eslint`
  and `eslint-plugin-react-hooks`. `eslint-plugin-react` was left out — its peer range stops at
  ESLint 9, and TypeScript already covers JSX correctness for this codebase.
- `GUIDES/06` covers chunked REST responses and SoftAP-less builds.

### Known gaps (not addressed)

- The `bluetooth_spec.md` §18.5 network-info section is still marked "pending hardware
  verification" in both repos. The end-to-end run that produced the network-details screen in the
  example app is the de-facto verification; the footnote should be updated once you're satisfied.

---

## Migrating an app from an earlier draft

Earlier drafts of this library (never released) spoke the pre-0.1.0 custom-GATT protocol and had a
broader, flatter API. If your app was written against one of those, work through this list. "Old"
is the draft shape; "Now" is the current API.

### 1. Native dependency

- **Now:** `@orbital-systems/react-native-esp-idf-provisioning` (≥ 0.5.0), wrapping Espressif's
  ESPProvision SDKs; ESP-IDF Network Provisioning over BLE. Dev builds only (`expo run:ios` /
  `expo run:android`); Expo Go cannot load the native module.
- **Old:** `react-native-ble-plx` + JSON-over-GATT on service `0xFFE0`.
- Swap the dependency, `pod install`, and reflash devices to `esp_wifi_config` 0.2.0+ with
  `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y`.

### 2. Scan prefix

- **Now:** default `'PROV_'` (`ble.deviceNamePrefix`, `string | string[]`), matching the firmware's
  `PROV_{id}` template.
- **Old:** `'ESP32-WiFi-'`.

### 3. Security configuration

```ts
ble: {
  security?: 0 | 1 | 2;          // default 1
  proofOfPossession?: string;    // no default — unset prompts; '' = sec1 device with no PoP
  username?: string;             // default 'wificfg'; sec2 only
  promptForAuth?: boolean;       // insert the enterDeviceAuth screen
}
```

Set `proofOfPossession` / `username` to *your* firmware's values, or leave the PoP unset (or set
`promptForAuth: true`) and let the user type them. An app that relied on the old implicit
`'abcd1234'` must now set it explicitly (`proofOfPossession: DEFAULT_POP`) or it will start seeing
the auth screen. Security 2 additionally requires a salt + verifier compiled into the firmware; a
device without them never advertises, which presents as "no devices found".

### 4. Step machine

```
welcome → scanBle → [enterDeviceAuth] → connectingBle → configuring → scanningWifi
        → chooseNetwork → enterCredentials → joiningWifi → success
```

- **Removed:** `manage` step, `ManageScreen`, `goToManage()`. There is no BLE link after a
  successful join (the device reboots), so post-join management is over the device's HTTP API.
- **Added:** `enterDeviceAuth` + `submitDeviceAuth({ pop?, username? })`.

### 5. Action verbs

`start`, `chooseDevice`, `submitDeviceAuth`, `proceedFromConfigure`, `chooseNetwork`,
`backToNetworks`, `submitPassword`, `retryJoin`, `pickDifferentNetwork`, `pickDifferentDevice`,
`cancel`, `rescanWifi`. **Removed:** `goToManage`.

### 6. `useProvisioning()` return shape

`step, stepNumber, error, lastResult, lastProvisionResult, device, scannedNetworks,
selectedNetwork, authMode, defaultAuthValues, pendingAuth` + the verbs above.

- **Removed:** `polling, wifiState, wifiSsid, wifiIp, wifiRssi, wifiQuality`. There is no live Wi-Fi
  status stream — the SDK's `provision()` is atomic. The join status is `lastProvisionResult.status`.
- **Device IP:** read `lastResult.networkInfo?.ip` (firmware 0.2.0+, best-effort). If absent, use
  mDNS or the firmware's HTTP `/api/wifi/status`.

### 7. Error model

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'provision' | 'flow';
  code?: string;
  message: string;
  recoverable: boolean;
};
```

- **Removed:** `bleError, bleErrorCode, lastCommandError, pollError, provisioningError`.
- **Renamed:** source `'poller'` → `'provision'`.

### 8. Device model

```ts
type DeviceConnection =
  | null
  | { status: 'connecting'; id; name; rssi: number | null }
  | { status: 'connected';  id; name; mtu: number | null };
```

- **Removed:** flat `deviceName`, `deviceId`, `connectionState` → use `device?.name / id / status`.
- `mtu` is always `null` and `ScanCompletedInfo.sampleNames` is always `[]` on the native-SDK
  transport; don't depend on them.

### 9. Removed BLE commands, hooks and components

- Commands (now HTTP-API only): `getStatus, listNetworks, addNetwork, delNetwork, connectWifi,
  disconnectWifi, getApStatus, startAp, stopAp, factoryReset`. An app that did
  `addNetwork + connectWifi` now calls `protocol.provision(ssid, password)` (or `submitPassword`).
- Hooks: `useWifiStatus, useSavedNetworks, useAccessPoint`.
- Components: `StatusBadge, ApSettings, SavedNetworkList, SavedNetworkItem`.

### 10. `DeviceProtocol` surface

`scanWifi(), provision(ssid, password), getVersion(), getCapabilities(), getNetworkPolicy(),
getNetworkInfo(), waitForNetworkInfo(), listVars(), getVar(), setVar(), delVar()`. Custom-endpoint
calls only work while the BLE session is alive — inside `flow.onConnected` or before
`submitPassword()`; `waitForNetworkInfo()` is meant for the ~15 s after `provision()` resolves.

### 11. Hooks

`useProvisioning, useDeviceScanner, useBleConnection, useDeviceProtocol, useDeviceVariables`. The
last two track `loading` / `error` per instance; there is no global busy flag.

### Checklist

- [ ] Swap the native dependency; `pod install`; dev build.
- [ ] Firmware on every device ≥ 0.2.0 with `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y`.
- [ ] `deviceNamePrefix` matches the firmware's name template (default `PROV_`).
- [ ] `proofOfPossession` set explicitly — there is no implicit default any more: the firmware's
      PoP, `''` for a no-PoP device, or unset to prompt. `username` for Security 2.
- [ ] One `error` field; `'poller'` → `'provision'`.
- [ ] `device.*` instead of flat device fields.
- [ ] Drop `manage` / `goToManage` / `wifi*` fields / removed hooks and components.
- [ ] Post-join management over HTTP (if the firmware has SoftAP/HTTP compiled in); IP from
      `lastResult.networkInfo` first, HTTP/mDNS second.
- [ ] Pre-Wi-Fi configuration (hostname, app vars) moved into `flow.onConnected`.

---

## Firmware follow-ups (for `../esp_wifi_config/`)

Found during the 2026-09-03 audit; none block the library.

1. `src/esp_wifi_config_prov_ble.c`: `PROV_LIB_VERSION_STRING` is hardcoded to
   `"esp_wifi_config 0.1.0"`. It should track the component version (e.g. generated from
   `idf_component.yml`, or at least bumped with each release).
2. "Four custom endpoints" appears in `src/esp_wifi_config_prov_ble.c` (file header and the
   comment near `make_json_response`), `include/esp_wifi_config.h` (`custom_endpoints` doc),
   `MIGRATION.md` §0.1.0, `website/docs/provisioning/ble-gatt.md`, `website/docs/api/ble-protocol.md`
   and `website/docs/api/c-api.md`. There are five.
3. `website/docs/api/ble-protocol.md`: the endpoint table has no `esp-wifi-config-network-info` row,
   and its `esp-wifi-config-version` row omits `compile_time` and `firmware_version`.
4. `bluetooth_spec.md` §18.5 still marks network-info as "pending the same hardware verification".
5. (Suggestion, from earlier hardware testing) Consider surfacing the expected Security 2 username
   over an unauthenticated channel — e.g. in the advertised manufacturer data or the `proto-ver`
   app-info — so a generic provisioning app can prompt correctly. Today the app must know it out of
   band.
