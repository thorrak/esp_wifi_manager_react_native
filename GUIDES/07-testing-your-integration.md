# Testing your integration

**When to use this:** you want to unit-test components or flows that consume this library, without standing up real BLE.

**What you'll end up with:** a strategy for mocking the library at the right boundary, plus example test patterns.

## Where to mock

Pick the lowest-effort layer that gives you what you need:

| You want to assert on… | Mock at |
|------|------|
| Your screen's render output for a given step | The store (`useProvisioningStore.setState`) |
| Wizard transitions | The manager (instantiate against the in-tree native-SDK mock) |
| Native SDK calls (scan / connect / provision / sendData) | The SDK mock (`src/__mocks__/esp-idf-provisioning.ts`) |

## Mocking at the store boundary

This is what most app-level tests want.

```ts
import { render } from '@testing-library/react-native';
import { useProvisioningStore } from 'esp-wifi-config-react-native';
import MyScreen from './MyScreen';

beforeEach(() => {
  // Override the store with a known state.
  useProvisioningStore.setState({
    step: 'enterCredentials',
    selectedNetwork: { ssid: 'A', rssi: -45, auth: 'WPA2' },
    error: null,
    submitPassword: jest.fn().mockResolvedValue(undefined),
    // …whatever else your screen reads from the store
  } as never);
});

test('credentials screen renders for selected network', () => {
  const { getByText } = render(<MyScreen />);
  expect(getByText('A')).toBeTruthy();
});
```

The store is the canonical reactive surface — overriding it bypasses the entire service layer. Best for component tests.

## Mocking the native SDK

The library ships a Jest mock for the native ESP-IDF Provisioning SDK at `src/__mocks__/esp-idf-provisioning.ts`. Tests can swap behaviour per-test via the exported `mockHooks` object:

```js
// jest.config.js
moduleNameMapper: {
  '^@orbital-systems/react-native-esp-idf-provisioning$':
    '<rootDir>/node_modules/esp-wifi-config-react-native/src/__mocks__/esp-idf-provisioning.ts',
},
```

Then `new BleTransport(...)` works in tests without real BLE.

```ts
import {
  mockHooks,
  ESPDevice,
  ESPSecurity,
  ESPTransport,
  ESPWifiAuthMode,
} from '@orbital-systems/react-native-esp-idf-provisioning';

beforeEach(() => {
  mockHooks.search = undefined;
  mockHooks.connect = undefined;
  mockHooks.scanWifi = undefined;
  mockHooks.provision = undefined;
  mockHooks.sendData = undefined;
});

test('happy path: scan → connect → scan WiFi → provision', async () => {
  mockHooks.search = (prefix) => [
    new ESPDevice({
      name: prefix + 'AB12CD',
      transport: ESPTransport.ble,
      security: ESPSecurity.secure,
    }),
  ];
  mockHooks.scanWifi = () => [
    { ssid: 'Home', rssi: -45, auth: ESPWifiAuthMode.wpa2Psk },
  ];
  mockHooks.provision = async () => ({ status: 'success' });

  // …drive your code under test
});
```

To simulate an unauthorized handshake, have the `connect` hook throw with a matching message:

```ts
mockHooks.connect = () => {
  throw new Error('unauthorized: bad PoP');
};
```

`BleTransport` parses the error string and turns it into `BleLibraryError { code: 'unauthorized' }`, which the manager then routes to `enterDeviceAuth`.

## Mocking at the manager boundary

When you want to assert on step transitions or verify your code calls the right verbs. The library's own `ProvisioningManager.test.ts` is the canonical example — start from one of its tests:

```ts
import { BleTransport, DeviceProtocol, ProvisioningManager } from 'esp-wifi-config-react-native';

const transport = new BleTransport({
  deviceNamePrefix: 'PROV_',
  security: 1,
  promptForAuth: true,        // forces enterDeviceAuth into the flow
});
const protocol = new DeviceProtocol(transport);
const manager = new ProvisioningManager(transport, protocol);

await manager.start();
await manager.chooseDevice({ id: 'PROV_X', name: 'PROV_X', rssi: null });
expect(manager.currentStep).toBe('enterDeviceAuth');

await manager.submitDeviceAuth({ pop: 'abcd1234' });
expect(['connectingBle', 'configuring', 'scanningWifi', 'chooseNetwork'])
  .toContain(manager.currentStep);
```

`ProvisioningManager` takes `(transport, protocol, config?)` — no separate poller (the SDK's `provision()` is atomic).

## Common patterns

### Asserting on store state changes

```ts
const states: ProvisioningStep[] = [];
const unsubscribe = useProvisioningStore.subscribe(s => states.push(s.step));

await useProvisioningStore.getState().chooseDevice(target);

expect(states).toContain('connectingBle');
expect(states).toContain('chooseNetwork');
unsubscribe();
```

### Asserting on provision errors

```ts
mockHooks.provision = async () => { throw new Error('STA connect failed'); };

await useProvisioningStore.getState().submitPassword('badpw');

const err = useProvisioningStore.getState().error;
expect(err?.source).toBe('provision');
expect(err?.recoverable).toBe(true);
```

### Verifying `lastResult` survives cancel

```ts
useProvisioningStore.setState({
  lastResult: { success: true, ssid: 'A', provisionStatus: 'success' },
} as never);
await useProvisioningStore.getState().cancel();
// `cancel` triggers `provisioningReset` which preserves lastResult.
expect(useProvisioningStore.getState().lastResult).toBeTruthy();
```

### Testing the enterDeviceAuth bounce

```ts
let attempts = 0;
mockHooks.connect = () => {
  attempts++;
  if (attempts === 1) throw new Error('unauthorized: bad PoP');
  // 2nd attempt succeeds.
};

// Drive the wizard...
await manager.chooseDevice({ id: 'PROV_X', name: 'PROV_X', rssi: null });
await manager.submitDeviceAuth({ pop: 'wrong' });
expect(manager.currentStep).toBe('enterDeviceAuth');     // bounced back
expect(manager.error?.code).toBe('unauthorized');
expect(manager.pendingAuth?.pop).toBe('wrong');          // pre-fill source

await manager.submitDeviceAuth({ pop: 'right' });
// proceeds past enterDeviceAuth
```

## Don't

- Don't try to test against real BLE in unit tests. Use the SDK mock or stub the transport.
- Don't assert on internal state (`manager['_step']`). Use the public getters or `stepChanged` events.
- Don't forget `useProvisioningStore.getState().destroy()` between tests if you used `initialize()`.
- Don't set the obsolete `polling`/`wifiState`/`wifiIp`/`wifiRssi` store fields in your test fixtures — they no longer exist in v2.
