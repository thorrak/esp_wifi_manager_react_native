# CLAUDE.md — agent integration guide

This file is the canonical entry point for AI agents (Claude Code, etc.) integrating or modifying this library. Read it first. Cross-references in here point to the source of truth for each topic.

## What this library does

`esp-wifi-config-react-native` is a React Native library that lets a mobile app provision Wi-Fi credentials onto an ESP32 device over BLE using ESP-IDF's official Wi-Fi/Network Provisioning protocol. The device must be running [esp_wifi_config](https://github.com/thorrak/esp_wifi_config) **0.1.0+** firmware with `CONFIG_WIFI_CFG_ENABLE_NETWORK_PROVISIONING=y`.

> **Library version 2.x is a breaking rewrite.** v1 spoke a custom
> JSON-over-GATT 0xFFE0 protocol that no longer exists in firmware. v2
> wraps Espressif's native iOS/Android provisioning SDKs via
> [`@orbital-systems/react-native-esp-idf-provisioning`](https://www.npmjs.com/package/@orbital-systems/react-native-esp-idf-provisioning).
> See [CHANGELOG.md](./CHANGELOG.md) for the full migration list.

Three integration paths, in order of decreasing abstraction:

| Path | When to use | Where to start |
|------|------|------|
| Pre-built `ProvisioningNavigator` | You want a working wizard with zero UI work | `import { ProvisioningNavigator } from 'esp-wifi-config-react-native/navigation'` |
| `useProvisioning` hook + custom UI | You want full control over screens but the same state machine | `import { useProvisioning } from 'esp-wifi-config-react-native'` |
| Service classes (`BleTransport`, `DeviceProtocol`, `ProvisioningManager`) | Headless / non-React / advanced | `import { BleTransport, DeviceProtocol } from 'esp-wifi-config-react-native'` |

## Mental model — three layers

```
BleTransport   ── thin wrapper around the native ESP-IDF SDK:
                  searchESPDevices / connect / disconnect
     ↓
DeviceProtocol ── SDK provision() + scanWifiList() + JSON-over-base64
                  for the four custom protocomm endpoints
     ↓
ProvisioningManager ── wizard step machine, error wrapping, onConnected hook
     ↓
Zustand store ── reactive state for hooks
     ↓
React hooks ── thin selectors + per-instance loading/error trackers
     ↓
Pre-built screens / your UI
```

Each layer only depends on the one below it. The store IS the canonical reactive state. The `ConnectionPoller` from v1 is gone — the SDK's atomic `provision()` resolves on STA-connect success or rejects on failure.

## The step machine — single source of truth

Every distinct UI state has its own step. Drive your UI off `step`; never derive shadow phase enums.

| Step | What's on screen | What advances it |
|------|------|------|
| `welcome` | Intro, "scan" CTA | `start()` |
| `scanBle` | Device list, scanning indicator | tap a device → `chooseDevice(d)` |
| `enterDeviceAuth` *(optional)* | PoP (sec1) or username + SRP password (sec2) input | `submitDeviceAuth({ pop?, username? })` |
| `connectingBle` | Spinner overlay | (auto: BLE handshake completes) |
| `configuring` | Pre-WiFi setup screen | `proceedFromConfigure()` (auto if no `onConnected`) |
| `scanningWifi` | Loading spinner | (auto: WiFi scan completes) |
| `chooseNetwork` | Network list | tap a network → `chooseNetwork(n)` |
| `enterCredentials` | WiFi password input | `submitPassword(pw)` |
| `joiningWifi` | Joining progress + status | SDK `provision()` resolves |
| `success` | Result summary | terminal — user dismisses |

`enterDeviceAuth` is inserted between `scanBle` and `connectingBle` when:
- `security !== 0` AND either `promptForAuth: true` in config, OR the required credentials (`proofOfPossession` for sec1; `proofOfPossession` + `username` for sec2) aren't pre-configured; OR
- the previous `connectingBle` attempt was rejected with `error.code === 'unauthorized'` — the screen then re-renders with the last-entered values so the user can fix a typo.

The `manage` step from earlier v2 drafts is gone. The firmware tears down BLE on successful provisioning (and, with `reboot_on_provisioning_success`, reboots the device shortly after), so there is no BLE link left to manage anything from. Post-provisioning device management should go over your device's HTTP API.

Source: `src/types/provisioning.ts` → `ProvisioningStep`. Numbered steps via `STEP_NUMBERS` (sub-states share a number, so progress dots are stable). `enterDeviceAuth` shares dot 1 with `scanBle`/`connectingBle`.

## The action verbs — 1:1 with user intent

`useProvisioning()` returns these. Each maps to `ProvisioningManager` and has a corresponding store action.

| Verb | Effect |
|------|------|
| `start()` | welcome → scanBle, starts BLE scan |
| `chooseDevice(target)` | scanBle → (enterDeviceAuth* OR connectingBle → configuring → scanningWifi → chooseNetwork) |
| `submitDeviceAuth({ pop?, username? })` | enterDeviceAuth → connectingBle (uses overrides instead of config defaults; bounces back to enterDeviceAuth on unauthorized) |
| `proceedFromConfigure()` | configuring → scanningWifi → chooseNetwork |
| `chooseNetwork(network)` | chooseNetwork → enterCredentials |
| `backToNetworks()` | enterCredentials → chooseNetwork |
| `submitPassword(pw)` | enterCredentials → joiningWifi (calls SDK provision(), awaits STA-connect) |
| `retryJoin(pw?)` | re-run provision() with the same network; bounces back to enterCredentials if no password is supplied |
| `pickDifferentNetwork()` | joiningWifi → chooseNetwork (deletes the failed network) |
| `pickDifferentDevice()` | any step → scanBle (disconnects, scans again) |
| `cancel()` | any step → welcome (full reset, preserves `lastResult`) |
| `rescanWifi()` | rerun WiFi scan from chooseNetwork |

## The state shape — what `useProvisioning` returns

```ts
{
  step,               // ProvisioningStep
  stepNumber,         // 1..5 | null
  error,              // ProvisioningError | null  ← unified envelope
  lastResult,         // ProvisioningResult | null  ← survives cancel()
  lastProvisionResult,// ProvisionResult | null    ← raw SDK response
  device,             // DeviceConnection | null   ← discriminated union
  scannedNetworks,    // ScannedNetwork[]
  selectedNetwork,    // ScannedNetwork | null
  authMode,           // 'pop' | 'srp' | null  ← what DeviceAuthScreen renders
  defaultAuthValues,  // { pop?, username? }   ← seeds for the auth screen
  pendingAuth,        // { pop?, username? } | null  ← last-submitted values
  // …action verbs
}
```

### `error` shape

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'provision' | 'flow';
  code?: string;        // e.g. 'unauthorized', 'provision_failed'
  message: string;      // for direct display
  recoverable: boolean; // true → user can retry from same step
};
```

Read `error.message` to display. Use `error.recoverable` to decide whether to show "Retry" vs "Start over". Use `error.code` for targeted handling (e.g. `'unauthorized'` → "Open Settings" link).

### `device` shape

```ts
type DeviceConnection =
  | null
  | { status: 'connecting'; id; name; rssi: number | null }
  | { status: 'connected'; id; name; mtu: number | null };
```

`device?.status === 'connecting'` is true while the BLE handshake runs. `device?.name` is stable from the moment the user taps a device through end-of-flow.

## The 5 most common pitfalls

1. **Don't derive your own phase enum.** The 10-step machine already encodes every distinct phase. Look up the right step for what you want to render; don't compute booleans like `busy && !networks.length` to derive "we're scanning".

2. **Don't read multiple error fields.** There is one: `error`. Sources are tagged via `error.source`. The old `bleError` / `pollError` / `provisioningError` fields are gone.

3. **Don't use `lastResult` for in-flow status.** It only fills in on `success`. While the wizard is running, read `device.name` for the device and `selectedNetwork` for the WiFi target. There is no live `wifiSsid`/`wifiIp` stream from the SDK; the IP is not surfaced over BLE — fetch it via the device's HTTP API once it's on the network.

4. **Don't gate effects on a global `busy` flag.** There isn't one. Each hook (`useDeviceVariables`, `useDeviceProtocol`) tracks its own `loading` per-instance. Use that.

   Calls to `DeviceProtocol`'s custom protocomm endpoints (`getVar`, `setVar`, etc.) only work while the BLE protocomm session is alive — typically between `connect()` and the device dropping BLE after a successful provision. Schedule them inside `flow.onConnected` or before `submitPassword()`.

5. **Don't throw from `flow.onConnected` and hope the user notices.** The manager parks on `configuring` with a `flow`-source error. Render that error on your configure screen; offer a retry that calls `proceedFromConfigure()` (skip the failure) or `pickDifferentDevice()` (start over).

## Pre-WiFi customization — `flow.onConnected`

Use this when you need to talk to the device before WiFi is provisioned (e.g. set hostname, app config keys, validate firmware version).

```ts
import { initializeServices } from 'esp-wifi-config-react-native';

initializeServices({
  flow: {
    onConnected: async ({ protocol }) => {
      const v = await protocol.getVar('mdns_name');
      if (!v.value) await protocol.setVar('mdns_name', 'my-device');
    },
  },
});
```

The callback runs after BLE connect, before the WiFi scan. Throwing surfaces as `ProvisioningError { source: 'flow', recoverable: true }`. Skip it via `useProvisioning().proceedFromConfigure()` or restart with `pickDifferentDevice()`.

If you don't supply `onConnected`, the `configuring` step auto-advances and the user sees no extra screen.

## Permissions

```ts
import { requestBluetoothPermissions, Linking } from 'esp-wifi-config-react-native';

const r = await requestBluetoothPermissions();
if (!r.granted) {
  if (r.reason === 'never_ask_again') Linking.openSettings();
  return;
}
await store.start();
```

Handles iOS (no-op, granted by Info.plist + first-use OS dialog) and Android 12+/<12 (BLUETOOTH_SCAN/CONNECT vs ACCESS_FINE_LOCATION).

## Headless usage

```ts
import { BleTransport, DeviceProtocol } from 'esp-wifi-config-react-native';

const transport = new BleTransport({
  deviceNamePrefix: 'PROV_',
  security: 1,
  proofOfPossession: 'abcd1234',
});
const protocol = new DeviceProtocol(transport);

const targets: { id: string }[] = [];
transport.on('deviceDiscovered', (d) => targets.push(d));

await transport.startScan();          // resolves once SDK scan completes
if (targets.length === 0) throw new Error('no devices');

await transport.connect(targets[0].id);
await protocol.setVar('mdns_name', 'my-device');
const result = await protocol.provision('MyWifi', 'password123');
console.log(result.status);
```

No React, no store, no manager. Useful for tests or background tasks.

## Configuration shape

```ts
type ProvisioningConfig = {
  ble?: {
    deviceNamePrefix?: string | string[];   // default 'PROV_'
    scanTimeoutMs?: number;                  // default 10000
    security?: 0 | 1 | 2;                    // default 1
    proofOfPossession?: string;              // default 'abcd1234' (sec1 PoP, sec2 SRP password)
    username?: string;                       // sec2 only, default 'wificfg'
    promptForAuth?: boolean;                 // default false — force the enterDeviceAuth screen
  };
  protocol?: {
    defaultTimeoutMs?: number;               // default 8000
    endpointTimeouts?: Record<string, number>;
  };
  flow?: {
    onConnected?: (ctx: { protocol; transport }) => Promise<void>;
    autoConnectOpenNetworks?: boolean;
    provisionTimeoutMs?: number;             // default 60000
  };
};
```

### Security versions in one paragraph

Default is **Security 1** (X25519 + AES-CTR + PoP) with PoP `"abcd1234"` — matches the firmware's Kconfig default. For **Security 0** (no encryption), set `ble.security: 0`; no PoP/username needed. For **Security 2** (SRP6a + AES-GCM), set `ble.security: 2` and either pre-configure `proofOfPossession` (SRP password) + `username`, or set `promptForAuth: true` so users enter both in the wizard. Set `promptForAuth: true` whenever each device has a unique PoP/credentials (e.g. printed on a label) and you don't want to ship one app per device.

Pass to `<ProvisioningNavigator config={...} />` or `initializeServices(config)` once before any hook usage.

## File map (where to look for each concern)

- Step machine, types, config: `src/types/provisioning.ts`
- BLE transport (SDK wrapper + auth overrides): `src/services/BleTransport.ts`
- Manager logic (incl. auth gating + unauthorized bounce): `src/services/ProvisioningManager.ts`
- Store wiring: `src/store/provisioningStore.ts`
- Primary hook: `src/hooks/useProvisioning.ts`
- Pre-built screens: `src/screens/` (note `DeviceAuthScreen.tsx` is the auth UI)
- Pre-built navigator: `src/navigation/ProvisioningNavigator.tsx`
- Permissions helper: `src/utils/permissions.ts`

## Deeper reading

- `README.md` — quick-start with full code examples
- `GUIDES/01-quick-start.md` — minimal Expo app from zero to provisioned
- `GUIDES/02-custom-ui-with-hooks.md` — wizard from `useProvisioning` only
- `GUIDES/03-headless-usage.md` — service classes in non-React code
- `GUIDES/04-pre-wifi-customization.md` — using `onConnected` for app config
- `GUIDES/05-error-handling.md` — `ProvisioningError` model in depth
- `GUIDES/06-managing-saved-networks.md` — post-provision device management
- `GUIDES/07-testing-your-integration.md` — mocking transport for unit tests
- `ARCHITECTURE.md` — internal layering, event flow, contributor guide
- `API.md` — exhaustive symbol reference

## Code style notes

- Every public export gets at least one-line JSDoc + `@example` for non-trivial APIs.
- Tests are in `src/__tests__/`. Run with `npm test`. ProvisioningManager tests are the canonical specification of step transitions.
- Build with `npm run build` (CommonJS + ESM + `.d.ts`).
- Typecheck: `npm run typecheck`. Lint: `npm run lint`.

## Don't

- Don't add new top-level error fields to the store. Route everything through `setError({ source, code?, message, recoverable })`.
- Don't add new step values without updating `STEP_NUMBERS`, `PROVISIONING_STEP_ORDER`, and `stepToScreenName`.
- Don't reach into `ProvisioningManager` from screens; go through `useProvisioning()`.
- Don't use the BLE `error` event for "no devices found". Listen to `scanCompleted` for diagnostics.
