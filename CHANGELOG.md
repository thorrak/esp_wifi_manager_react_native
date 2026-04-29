# Changelog

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
