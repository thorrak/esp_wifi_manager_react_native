# Post-provision device management

The library does not expose a BLE-based "manage" screen or saved-network /
access-point hooks. The reason is structural: once the device joins WiFi,
the firmware tears down its BLE provisioning service (and, by default,
reboots the device shortly afterwards) — so there is no BLE link left
to issue management commands over.

The library does still surface the five read-mostly custom protocomm
endpoints **during** the provisioning session (between BLE connect and
the device dropping BLE on success):

- `getVersion()` — firmware/library/IDF versions
- `getCapabilities()` — enabled feature flags
- `getNetworkPolicy()` — retry/reconnect configuration
- `getVar()` / `setVar()` / `listVars()` / `delVar()` — custom variable
  store, intended for app-side configuration
- `getNetworkInfo()` / `waitForNetworkInfo()` — the station's assigned IP,
  gateway, RSSI, etc. Only meaningful *after* `provision()` resolves; the
  manager already calls it for you and stores the result on
  `lastResult.networkInfo` (firmware 0.2.0+)

The intended place to call the first four is **`flow.onConnected`** (runs
after BLE connect, before the WiFi scan) — see
[04-pre-wifi-customization.md](./04-pre-wifi-customization.md).

## Managing the device after WiFi joins

The firmware's HTTP/REST API on the WiFi network is the canonical
surface for post-provisioning management. From your mobile app, talk to
it the same way you would any LAN-side device:

```ts
// Prefer the IP the device reported over BLE at the end of provisioning.
const ip = lastResult?.networkInfo?.ip ?? (await resolveMdns('my-device.local'));
const res = await fetch(`http://${ip}/api/wifi/networks`);
```

Two firmware facts to keep in mind (esp_wifi_config 0.2.2+ / 0.2.3+):

- **Responses are chunked.** Since 0.2.2 the REST API streams its JSON with
  `Transfer-Encoding: chunked` and no `Content-Length`. `fetch()` handles
  this transparently; a hand-rolled client that requires `Content-Length`
  will not.
- **The HTTP API may not exist.** Since 0.2.3 a firmware built with
  `CONFIG_WIFI_CFG_ENABLE_SOFTAP=n` compiles out the SoftAP portal *and*
  the HTTP server + REST API. On such a device the BLE session is the only
  management channel, so do any configuration you need inside
  `flow.onConnected`. `getCapabilities()` reports `softap` only when the AP
  is enabled at runtime; it does not directly say whether HTTP is present.

The default routes live under `/api/wifi` (configurable on the firmware
via `config.http.api_base_path`): `/status`, `/scan`, `/networks`
(GET/POST), `/networks/*` (PUT/DELETE), `/connect`, `/disconnect`, and
`/ap/status|config|start|stop`. See the firmware's REST API documentation
for payloads. The library has no opinions about how you call them —
`fetch`, `axios`, React Query, whatever fits your app.

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
const info = await protocol.waitForNetworkInfo(); // best-effort IP, while BLE is still up
// the device reboots once we drop the link (or after ~15 s regardless)
await transport.disconnect();
```

(Headless usage is documented in
[03-headless-usage.md](./03-headless-usage.md).)
