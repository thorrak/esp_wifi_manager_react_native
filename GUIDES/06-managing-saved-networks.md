# Post-provision device management

In v2 the library no longer exposes a BLE-based "manage" screen, and the
old `useSavedNetworks` / `useAccessPoint` hooks are gone. The reason is
structural: once the device joins WiFi, the firmware tears down its BLE
provisioning service (and, with `reboot_on_provisioning_success`,
reboots the device shortly afterwards) — so there is no BLE link left
to issue management commands over.

The library does still surface the four read-mostly custom protocomm
endpoints **during** the provisioning session (between BLE connect and
the device dropping BLE on success):

- `getVersion()` — firmware/library/IDF versions
- `getCapabilities()` — enabled feature flags
- `getNetworkPolicy()` — retry/reconnect configuration
- `getVar()` / `setVar()` / `listVars()` / `delVar()` — custom variable
  store, intended for app-side configuration

The intended place to call these is **`flow.onConnected`** (runs after
BLE connect, before the WiFi scan) — see
[04-pre-wifi-customization.md](./04-pre-wifi-customization.md).

## Managing the device after WiFi joins

The firmware's HTTP/REST API on the WiFi network is the canonical
surface for post-provisioning management. From your mobile app, talk to
it the same way you would any LAN-side device:

```ts
const ip = await resolveMdns('my-device.local');
const res = await fetch(`http://${ip}/api/wifi/networks`);
```

See your firmware's REST API documentation for the available endpoints.
The library has no opinions about how you do this — `fetch`, `axios`,
React Query, whatever fits your app.

## Headless one-shot management from JS (advanced)

If you need to push custom variables alongside credentials and don't
want to wait for the WiFi-side path, you can drive
`DeviceProtocol.setVar()` headlessly between connect and provision:

```ts
import { BleTransport, DeviceProtocol } from 'esp-wifi-config-react-native';

const transport = new BleTransport({ security: 1, proofOfPossession: 'abcd1234' });
const protocol = new DeviceProtocol(transport);

await transport.startScan();
await transport.connect('PROV_AB12CD', { pop: 'abcd1234' });
await protocol.setVar('mdns_name', 'my-device');
const r = await protocol.provision('MyWifi', 'wifipassword');
// transport will likely drop shortly after this resolves
await transport.disconnect();
```

(Headless usage is documented in
[03-headless-usage.md](./03-headless-usage.md).)
