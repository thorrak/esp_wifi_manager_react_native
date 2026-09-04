# Architecture

Internal layering and event flow for contributors. For the integration-level model (how to *use*
the library), read [CLAUDE.md](./CLAUDE.md) first — this document goes one level deeper into how the
pieces fit together.

## Overview

`esp-wifi-config-react-native` provisions Wi-Fi credentials onto an ESP32 over BLE by wrapping
Espressif's official provisioning SDK — it does **not** speak GATT directly. The native I/O lives in
[`@orbital-systems/react-native-esp-idf-provisioning`](https://www.npmjs.com/package/@orbital-systems/react-native-esp-idf-provisioning)
(which in turn wraps Espressif's iOS/Android ESPProvision SDKs). This library adds the state machine,
typed error model, custom-endpoint helpers, reactive store, and pre-built UI on top.

```
┌──────────────────────────────────────────────────────────────┐
│ Pre-built screens / your UI                                    │  React components
├──────────────────────────────────────────────────────────────┤
│ React hooks (useProvisioning, useDeviceScanner, …)             │  thin selectors
├──────────────────────────────────────────────────────────────┤
│ Zustand store (provisioningStore)                              │  canonical reactive state
├──────────────────────────────────────────────────────────────┤
│ ProvisioningManager        — wizard step machine, errors       │  Layer 3
├──────────────────────────────────────────────────────────────┤
│ DeviceProtocol             — provision/scan + custom endpoints  │  Layer 2
├──────────────────────────────────────────────────────────────┤
│ BleTransport               — native SDK wrapper, scan/connect   │  Layer 1
├──────────────────────────────────────────────────────────────┤
│ @orbital-systems/react-native-esp-idf-provisioning (native SDK) │
└──────────────────────────────────────────────────────────────┘
```

Each layer depends only on the one below it. State flows **up** via typed events that the store
subscribes to; intent flows **down** via method calls (action verbs → manager → services).

## The three service layers

### Layer 1 — `BleTransport` (`src/services/BleTransport.ts`)

Thin wrapper over the native SDK. Responsibilities:

- **Scanning** by device-name prefix(es) (`searchESPDevices`). The SDK resolves with the full match
  list at the end of a scan cycle — there is no live per-advertisement stream — so the transport
  emits one `deviceDiscovered` per match when results land, then a single `scanCompleted`.
- **Connect / session-init** (`connect`): establishes the BLE link and the protocomm security
  handshake (Security 0/1/2, PoP/SRP) in one call. Per-call credential overrides support the
  `enterDeviceAuth` flow and the unauthorized-retry bounce.
- **Holding the active `ESPDevice`** reference (`espDevice`) so Layer 2 can issue `provision()`,
  `scanWifiList()`, and `sendData()` against it.
- Emits a typed event surface (`deviceDiscovered`, `scanCompleted`, `scanStopped`,
  `connectionStateChanged`, `error`) consumed by the manager. The `error` event is reserved for true
  failures (BLE off, unauthorized, scan error); an empty scan is **not** an error.

A connect failure is classified into a `BleLibraryError` with a `code` — notably `unauthorized`
(wrong PoP/SRP) vs. `connect_error` — so the manager can decide whether to bounce to the auth step.

### Layer 2 — `DeviceProtocol` (`src/services/DeviceProtocol.ts`)

Sits on the connected `ESPDevice`. Two kinds of operations:

- **SDK-native:** `scanWifi()` (→ `scanWifiList()`) and `provision(ssid, password)` (→ the SDK's
  atomic `provision()`, which sends credentials *and* waits for the device's STA-connect result).
- **Custom protocomm endpoints** registered by `esp_wifi_config` firmware (five, always-on):
  `getVersion()`, `getCapabilities()`, `getNetworkPolicy()`, `getNetworkInfo()` /
  `waitForNetworkInfo()`, `listVars()`, `getVar()`, `setVar()`, `delVar()`. These exchange UTF-8
  JSON, base64-framed through `ESPDevice.sendData()` (the SDK applies protocomm encryption). Empty
  requests are sent as `{}` — a zero-length write is not dispatched by the ESP32 protocomm BLE
  transport. `esp-wifi-config-network-info` is reachable only on firmware 0.2.0+ (0.1.0 registered
  the handler without creating its GATT characteristic).

Custom-endpoint calls only work while the BLE session is alive (between `connect()` and the device
dropping BLE after a successful provision). The layer surfaces a `busyChanged` event for UI
affordances and an `endpointError` event; it does not maintain a global busy flag (the SDK
serializes requests internally).

### Layer 3 — `ProvisioningManager` (`src/services/ProvisioningManager.ts`)

Owns the wizard **step machine** and orchestrates Layers 1–2. It is the single source of truth for
"what is the user doing". Key properties:

- **No connection poller.** The SDK's `provision()` is atomic, so the `joiningWifi` step resolves
  directly off that promise — success → `success`, rejection → a recoverable `provision`-source
  error. On success the manager then calls `protocol.waitForNetworkInfo()` (3 × 1 s, never throws)
  to capture the device's IP over the still-open BLE link before the firmware's ~15 s reboot
  backstop, and emits `provisioningComplete` with it as `result.networkInfo`.
- **Disconnect-safety.** A set of steps (`welcome`, `scanBle`, `enterDeviceAuth`, `connectingBle`,
  `joiningWifi`, `success`) are exempt from the "BLE dropped → fatal" rule. `joiningWifi` is exempt
  because the firmware reboots on a successful provision and drops BLE as the client disconnects,
  which can race the `provision()` resolution; treating that drop as fatal would clobber a success.
- **Unified error model** (`setError`): one `ProvisioningError { source, code?, message,
  recoverable }`, never multiple error fields.
- **Auth gating.** `shouldPromptForAuth()` decides whether to insert `enterDeviceAuth` before
  connect (driven by `security`, configured credentials, `promptForAuth`, and a sticky
  `_forceAuthPrompt` latch set on an `unauthorized` rejection).
- **`flow.onConnected` hook** runs after BLE connect, before the Wi-Fi scan, for pre-provisioning
  setup. Throwing parks the manager on `configuring` with a recoverable `flow`-source error.

It exposes its state via getters and emits `stepChanged`, `errorChanged`, `deviceConnectionChanged`,
`selectedNetworkChanged`, `scannedNetworksUpdated`, `provisionResult`, `provisioningComplete`,
`provisioningReset`.

## The step machine

```
welcome → scanBle → [enterDeviceAuth] → connectingBle → configuring → scanningWifi →
chooseNetwork → enterCredentials → joiningWifi → success
```

- `enterDeviceAuth` is conditional (see auth gating above).
- `configuring` auto-advances when there is no `flow.onConnected`.
- `STEP_NUMBERS` (`src/types/provisioning.ts`) collapses sub-states into stable numbered progress
  dots; sub-states share a number so labels don't jump.
- There is **no `manage` step** — post-provisioning management is over the device's HTTP API (no BLE
  link survives a successful provision).

Source of truth: `src/types/provisioning.ts` → `ProvisioningStep`, `STEP_NUMBERS`,
`PROVISIONING_STEP_ORDER`, and `stepToScreenName`. When adding a step, update all four.

## Store and hooks

- **`provisioningStore`** (`src/store/provisioningStore.ts`) is a Zustand store that constructs the
  service stack via `serviceFactory`, subscribes to the manager's events, and mirrors them into
  reactive state. It IS the canonical reactive state — the services hold authoritative *operational*
  state, the store reflects it for React. It re-subscribes if the services are replaced.
- **Hooks** (`src/hooks/`) are thin selectors over the store plus, for `useDeviceProtocol` /
  `useDeviceVariables`, a per-instance `loading`/`error` tracker (no global busy flag). `useProvisioning`
  exposes the full wizard surface; `useDeviceScanner` and `useBleConnection` are narrower views.

## Event flow (a successful provision)

```
user taps device
  → useProvisioning().chooseDevice()
    → store action → manager.chooseDevice()
      → [enterDeviceAuth? park until submitDeviceAuth()]
      → transport.connect()  (BLE link + protocomm session)
        → manager: step=configuring → flow.onConnected? → step=scanningWifi
          → protocol.scanWifi() → step=chooseNetwork
user picks network + password
  → manager.submitPassword() → step=joiningWifi
    → protocol.provision(ssid, pw)   (atomic: set creds + await STA-connect)
      → resolves → step=success, emit provisioningComplete
      (device reboots, BLE drops — ignored because joiningWifi/success are disconnect-safe)
```

Every `manager` transition emits a typed event; the store updates; subscribed hooks re-render; the
pre-built screen for the new step renders (or your custom UI, if you drive off `step` yourself).

## File map

| Concern | File |
|---|---|
| Step machine, error/device/config types | `src/types/provisioning.ts` |
| BLE transport types | `src/types/ble.ts` |
| Custom-endpoint payload types | `src/types/protocol.ts` |
| Scanned-network / provision-result types | `src/types/wifi.ts` |
| Native SDK wrapper | `src/services/BleTransport.ts` |
| Provision/scan + custom endpoints | `src/services/DeviceProtocol.ts` |
| Wizard step machine | `src/services/ProvisioningManager.ts` |
| Service construction | `src/serviceFactory.ts` |
| Reactive store | `src/store/provisioningStore.ts` |
| Hooks | `src/hooks/` |
| Pre-built screens | `src/screens/` |
| Drop-in navigator | `src/navigation/ProvisioningNavigator.tsx` |
| Permissions helper | `src/utils/permissions.ts` |

## Testing

Unit tests (`src/__tests__/`) run against a mock of the native SDK
(`src/__mocks__/esp-idf-provisioning.ts`) — they verify the manager's step transitions, auth
gating, disconnect-safety, and custom-endpoint encoding without real BLE. `ProvisioningManager.test.ts`
is the canonical executable spec of the step machine. The byte-level BLE protocol the firmware speaks
is documented separately in `bluetooth_spec.md`.
