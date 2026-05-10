# Headless usage — service classes without React

> **v2.x note.** Method names changed in v2: drop `addNetwork`/`connectWifi`/`getStatus`/`startAp`/etc. Use `protocol.provision(ssid, password)` (atomic) and `protocol.scanWifi()`. Custom application config goes through `protocol.getVar`/`setVar`/`listVars`. The transport now requires Security 1 + a PoP — see CHANGELOG.md.

**When to use this:** automated tests, CLI scripts, background tasks, or non-React frameworks. You want the BLE protocol stack but not React or Zustand.

**What you'll end up with:** a TypeScript script that scans, connects, provisions, and reports — no hooks, no UI, no store.

## The four classes

| Class | What it owns |
|------|------|
| `BleTransport` | BLE I/O: scan, connect, GATT writes, notification reassembly |
| `DeviceProtocol` | JSON command/response over the transport (typed helpers) |
| `ConnectionPoller` | Periodic `get_status` with success/failure detection |
| `ProvisioningManager` | Full step machine — only useful with React or your own state observer |

For headless work, you typically only need the first two. Skip the manager unless you specifically want its retry/error wrapping.

## Minimal script

```ts
import { BleTransport, DeviceProtocol } from 'esp-wifi-config-react-native';

async function provision(ssid: string, password: string) {
  const transport = new BleTransport({ deviceNamePrefix: 'MyDevice-' });
  const protocol = new DeviceProtocol(transport);

  // Find the first matching device.
  const device = await new Promise((resolve, reject) => {
    transport.on('deviceDiscovered', resolve);
    transport.on('error', reject);
    transport.startScan().catch(reject);
  });

  transport.stopScan();
  await transport.connect(device.id);

  await protocol.addNetwork({ ssid, password, priority: 10 });
  await protocol.connectWifi(ssid);

  // Poll until connected.
  for (let i = 0; i < 15; i++) {
    await new Promise(r => setTimeout(r, 2000));
    const status = await protocol.getStatus();
    if (status.state === 'connected') {
      console.log('Connected:', status.ssid, status.ip);
      break;
    }
  }

  await transport.disconnect();
  await transport.destroy();
}
```

## With ConnectionPoller

Replace the manual polling loop:

```ts
import { ConnectionPoller } from 'esp-wifi-config-react-native';

const poller = new ConnectionPoller(protocol);

await new Promise((resolve, reject) => {
  poller.on('connectionSucceeded', resolve);
  poller.on('connectionFailed', () => reject(new Error('Failed')));
  poller.on('connectionTimedOut', () => reject(new Error('Timeout')));
  poller.startPolling(30_000, 2000); // 30s timeout, 2s interval
});
```

## Lifecycle and cleanup

Always call `transport.destroy()` when you're done. It tears down the BLE manager, removes listeners, and frees Android GATT resources.

```ts
try {
  // ...
} finally {
  await transport.disconnect();
  await transport.destroy();
}
```

## Multiple commands in flight

`DeviceProtocol.sendCommand` rejects with `"Command already in progress"` if a command is in flight. The protocol is strictly serialized — that's by design (the firmware is too). Sequence your awaits.

## Errors

The headless layers throw on failure (no envelope wrapping). Wrap in try/catch:

```ts
try {
  await transport.connect(device.id);
} catch (err) {
  if (err instanceof BleLibraryError && err.code === 'unauthorized') {
    // permissions
  }
  throw err;
}
```

Use `BleLibraryError` to distinguish library-level errors (`unauthorized`, `powered_off`, etc.) from generic BLE errors.

## Complete example

See [examples/headless-script.ts](../examples/headless-script.ts).

## When to use the manager headlessly

If you want the manager's step machine and retry/error wrapping but no React/store, instantiate it directly:

```ts
const transport = new BleTransport(/* ... */);
const protocol = new DeviceProtocol(transport);
const poller = new ConnectionPoller(protocol);
const manager = new ProvisioningManager(transport, protocol, poller, config);

manager.on('stepChanged', step => console.log('step:', step));
manager.on('errorChanged', err => err && console.warn(err.message));
manager.on('provisioningComplete', result => console.log('done:', result));

await manager.start();
// ...drive via manager.chooseDevice(), manager.chooseNetwork(), etc.
```

Use this for integration tests where you want to assert on step transitions.
