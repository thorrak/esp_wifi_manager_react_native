# Headless usage — service classes without React

**When to use this:** automated tests, CLI scripts, background tasks, or non-React frameworks. You want the BLE provisioning machinery but not React, Zustand, or the wizard step machine.

**What you'll end up with:** a TypeScript script that scans, connects, provisions, and reports.

## The three classes

| Class | What it owns |
|------|------|
| `BleTransport` | BLE I/O via the native ESP-IDF SDK: scan, connect (with session-init), disconnect |
| `DeviceProtocol` | SDK `provision()` + `scanWifiList()` + JSON-over-base64 for the four custom protocomm endpoints |
| `ProvisioningManager` | Full step machine — only useful when you want the wizard's event flow, error wrapping, and `onConnected` hook |

For headless work, you typically only need the first two. The SDK's `provision()` is atomic — it sends credentials AND waits for STA-connect — so there is no separate polling loop to manage.

## Minimal script

```ts
import { BleTransport, BleLibraryError, DeviceProtocol } from 'esp-wifi-config-react-native';
import type { DiscoveredDevice } from 'esp-wifi-config-react-native';

async function provision(ssid: string, password: string) {
  const transport = new BleTransport({
    deviceNamePrefix: 'PROV_',         // matches the firmware's wifi_prov_scheme_ble default
    security: 1,
    proofOfPossession: 'abcd1234',     // override per-fleet in production
  });
  const protocol = new DeviceProtocol(transport);

  const discovered: DiscoveredDevice[] = [];
  transport.on('deviceDiscovered', (d) => discovered.push(d));

  // The SDK doesn't stream individual discoveries — startScan() resolves
  // once the SDK has the full list, then we get one `deviceDiscovered`
  // event per match followed by a `scanCompleted`.
  await transport.startScan();
  if (discovered.length === 0) throw new Error('No devices found');

  const target = discovered[0];
  await transport.connect(target.id);
  // For per-device credentials, pass overrides as the second argument:
  //   await transport.connect(target.id, { pop: discoveredPop });
  //   await transport.connect(target.id, { pop, username }); // sec2

  // Optional: push pre-WiFi configuration through the custom endpoints.
  await protocol.setVar('mdns_name', 'my-device');

  // Atomic — resolves when the device reports STA-connect success,
  // rejects on STA-connect failure or BLE drop.
  const result = await protocol.provision(ssid, password);
  console.log('Status:', result.status);

  await transport.disconnect();
}
```

## Lifecycle and cleanup

Always `await transport.disconnect()` when you're done. The native SDK releases its internal handles when the process exits, but a clean disconnect is friendlier to the device (the firmware's restart-on-disconnect workaround kicks in quicker).

```ts
try {
  // ...
} finally {
  await transport.disconnect();
}
```

## Custom protocomm endpoints

`DeviceProtocol` exposes typed wrappers for the four custom endpoints the firmware registers (always-on as of esp_wifi_config 0.1.0+):

```ts
const version = await protocol.getVersion();          // { lib, idf, fw_version, ... }
const caps    = await protocol.getCapabilities();     // { capabilities: ['multi-network', ...] }
const policy  = await protocol.getNetworkPolicy();    // { provisioning_mode, max_retry_per_network, ... }

const vars    = await protocol.listVars();            // [{ key, value }, ...]
const v       = await protocol.getVar('mdns_name');   // { key, value } | null
await protocol.setVar('mdns_name', 'my-device');
await protocol.delVar('mdns_name');
```

All of these only work between `connect()` and the device dropping BLE on successful provision (or you calling `disconnect()`).

## Errors

The headless layers throw on failure — no envelope wrapping. Wrap in try/catch:

```ts
try {
  await transport.connect(target.id);
} catch (err) {
  if (err instanceof BleLibraryError && err.code === 'unauthorized') {
    // Wrong PoP or SRP credentials — retry with the right ones.
  } else if (err instanceof BleLibraryError && err.code === 'powered_off') {
    // User has Bluetooth off.
  }
  throw err;
}
```

`BleLibraryError.code` is one of: `unauthorized`, `powered_off`, `unsupported`, `scan_error`, `connect_error`, `provision_error`, `unknown`.

## When to use the manager headlessly

If you want the wizard's step machine + the conditional `enterDeviceAuth` flow but no React/store, instantiate the manager directly:

```ts
import { ProvisioningManager } from 'esp-wifi-config-react-native';

const transport = new BleTransport({ /* ... */ });
const protocol = new DeviceProtocol(transport);
const manager = new ProvisioningManager(transport, protocol, {
  flow: { onConnected: async ({ protocol }) => { await protocol.setVar('mdns_name', 'x'); } },
});

manager.on('stepChanged', step => console.log('step:', step));
manager.on('errorChanged', err => err && console.warn(err.message));
manager.on('provisioningComplete', result => console.log('done:', result));

await manager.start();
// ...drive via manager.chooseDevice(), manager.submitDeviceAuth(...),
// manager.chooseNetwork(), manager.submitPassword(...), etc.
```

This is the right shape for integration tests where you want to assert on step transitions.

## Complete example

See [examples/headless-script.ts](../examples/headless-script.ts).
