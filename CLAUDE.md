# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run build        # react-native-builder-bob → lib/ (commonjs + module + typescript)
npm run typecheck    # tsc --noEmit
npm run lint         # eslint "src/**/*.{ts,tsx}"
npm test             # jest (ts-jest, node env) — all 11 test files
npm test -- --testPathPattern=BleTransport   # run a single test file
```

## Architecture

React Native library for BLE WiFi provisioning of ESP32 devices. Four-layer service stack, each layer depends only on the one below:

```
BleTransport → DeviceProtocol → ConnectionPoller → ProvisioningManager
                                                          ↓
                                                    provisioningStore (Zustand)
                                                          ↓
                                                    8 hooks (thin selectors)
                                                          ↓
                                                    Components / Screens (optional)
```

**Services** (`src/services/`) — plain TypeScript, no React dependency:
- `BleTransport` — react-native-ble-plx wrapper: scanning, GATT I/O, chunked JSON reassembly, notification monitoring
- `DeviceProtocol` — JSON command/response envelope, typed command helpers, timeout management, one-at-a-time command execution
- `ConnectionPoller` — periodic `get_status` polling with success/failure/timeout detection
- `ProvisioningManager` — wizard state machine orchestrating the other three services

**`serviceFactory.ts`** — lazy singleton wiring. `getManager()`/`getTransport()`/etc. auto-init on first call. `initializeServices(config?)` is idempotent (no-op if already initialized); call `destroyServices()` first to force re-creation. `destroyServices()` is async — it nulls references synchronously (unblocking re-init) then awaits BLE teardown.

**Store** (`src/store/provisioningStore.ts`) — single Zustand store subscribing to service events, bridges services to React.

**Hooks** (`src/hooks/`) — thin selectors over the store. Hooks work standalone without pre-built UI.

**Two package exports:**
- `.` — main library (hooks, store, services, components)
- `./navigation` — optional `ProvisioningNavigator` (requires `@react-navigation/*` peer deps)

## BLE Protocol

- Service UUID: `0xFFE0`, Chars: `0xFFE1` (status/notify), `0xFFE2` (command/write), `0xFFE3` (response/notify)
- Constants in `src/constants/ble.ts`, command types in `src/types/protocol.ts`
- react-native-ble-plx uses base64 for characteristic values; utilities in `src/utils/base64.ts`
- 120ms GATT settle delay between writes (`GATT_SETTLE_MS`)
- Chunked response reassembly: buffer notifications until buffer ends with `}`

## Key Patterns and Gotchas

- **TypedEventEmitter**: use `{ [K in keyof T]: (...args: any[]) => void }` — interfaces lack implicit index signatures, so `Record<string, ...>` won't work
- **Command nonce**: `DeviceProtocol` uses a monotonic nonce to prevent stale `.catch()` handlers from rejecting subsequent commands
- **Destroy abandons commands**: `DeviceProtocol.destroy()` abandons pending commands (increments nonce, nulls handlers) instead of rejecting — avoids unhandled promise rejections during teardown
- **BleTransport `_destroyed` guard**: after `destroy()`, notification callbacks and `writeCommand()` bail out early to prevent stale native callbacks from surfacing
- **Reset ordering**: `ProvisioningManager.reset()` must set `_step='welcome'` BEFORE calling `transport.disconnect()` to avoid spurious disconnect listener trigger
- **BLE adapter readiness**: uses polling (`waitForPoweredOn`) instead of `onStateChange(_, true)` — ble-plx has an unhandled-rejection bug when CBCentralManager is in Unknown state
- **Scan error path**: `BleTransport` must emit `scanStopped` to clear store's `scanning` flag
- **Scan diagnostics**: when scan timeout fires with no matching devices, `BleTransport` emits an `error` event with diagnostic info (device count, names seen). Surfaced via `bleError` in the store and `useDeviceScanner` hook
- **Navigation isolation**: `ProvisioningNavigator` wraps its stack in its own `NavigationContainer` + `NavigationIndependentTree`, so consumers do NOT wrap it in a `NavigationContainer`
- **Store polling flag**: synced via `stepChanged('connecting')` and poller stop events
- **Store actions**: must match exact positional argument signatures of service methods, not object shapes
- **Store destroy is fire-and-forget**: `destroy()` action calls `void destroyServices()` — store state resets immediately, async BLE teardown settles in background

## Testing

11 test files under `src/__tests__/`. Mocks at `src/__mocks__/react-native-ble-plx.ts` and `src/__mocks__/react-native.ts`. Tests run in Node (no React Native runtime needed).

## Dependencies

- **Required peer dep**: `react-native-ble-plx` >= 3.0
- **Optional peer deps** (pre-built UI only): `@react-navigation/native` >= 7, `@react-navigation/native-stack` >= 7, `react-native-screens` >= 4, `react-native-safe-area-context` >= 4
- **Direct dep**: `zustand` ^5.0.0
