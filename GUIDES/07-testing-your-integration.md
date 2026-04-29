# Testing your integration

**When to use this:** you want to unit-test components or flows that consume this library, without standing up real BLE.

**What you'll end up with:** a strategy for mocking the library at the right boundary, plus example test patterns.

## Where to mock

Pick the lowest-effort layer that gives you what you need:

| You want to assert on… | Mock at |
|------|------|
| Your screen's render output for a given step | The store (`useProvisioningStore.setState`) |
| Wizard transitions | The manager (instantiate with stub services) |
| BLE message bytes | The transport (use the in-tree `react-native-ble-plx` mock) |

## Mocking at the store boundary

This is what most app-level tests want.

```ts
import { renderHook } from '@testing-library/react-native';
import { useProvisioningStore } from 'esp-wifi-config-react-native';
import MyScreen from './MyScreen';

beforeEach(() => {
  // Override the store with a known state.
  useProvisioningStore.setState({
    step: 'enterCredentials',
    selectedNetwork: { ssid: 'A', rssi: -45, auth: 'WPA2' },
    error: null,
    submitPassword: jest.fn().mockResolvedValue(undefined),
    // …
  } as never);
});

test('credentials screen renders for selected network', () => {
  const { getByText } = render(<MyScreen />);
  expect(getByText('A')).toBeTruthy();
});
```

The store is the canonical reactive surface — overriding it bypasses the entire service layer. Best for component tests.

## Mocking at the manager boundary

When you want to assert on step transitions or verify your code calls the right verbs.

```ts
import { ProvisioningManager } from 'esp-wifi-config-react-native';

const mockTransport = {
  on: jest.fn(),
  startScan: jest.fn(),
  stopScan: jest.fn(),
  connect: jest.fn().mockResolvedValue({ id: 'd1', name: 'X', mtu: 517 }),
  disconnect: jest.fn(),
  isConnected: false,
  connectedDevice: null,
};
const mockProtocol = {
  scan: jest.fn().mockResolvedValue({ networks: [] }),
  addNetwork: jest.fn(),
  connectWifi: jest.fn(),
  // …
};
const mockPoller = {
  on: jest.fn(),
  startPolling: jest.fn(),
  reset: jest.fn(),
};

const manager = new ProvisioningManager(
  mockTransport as never, mockProtocol as never, mockPoller as never,
);

await manager.chooseDevice({ id: 'd1', name: 'X', rssi: -50 });
expect(manager.currentStep).toBe('chooseNetwork');
```

The library's own `ProvisioningManager.test.ts` is the canonical example of this pattern — copy it.

## Mocking at the transport boundary

For protocol-level / serialization tests.

The library ships a `react-native-ble-plx` mock at `src/__mocks__/react-native-ble-plx.ts` — Jest automatically picks it up if you have:

```js
// jest.config.js or package.json jest field
moduleNameMapper: {
  '^react-native-ble-plx$': '<rootDir>/node_modules/esp-wifi-config-react-native/src/__mocks__/react-native-ble-plx.ts',
},
```

Then `new BleTransport()` works in tests without real BLE.

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

### Asserting on errors

```ts
await useProvisioningStore.getState().submitPassword('badpw');

const err = useProvisioningStore.getState().error;
expect(err?.source).toBe('protocol');
expect(err?.recoverable).toBe(true);
```

### Verifying `lastResult` survives cancel

```ts
useProvisioningStore.setState({
  lastResult: { success: true, ssid: 'A', ip: '1.2.3.4' },
});
await useProvisioningStore.getState().cancel();
// `cancel` ultimately triggers `provisioningReset` which preserves lastResult.
expect(useProvisioningStore.getState().lastResult).toBeTruthy();
```

## Don't

- Don't try to test against real BLE in unit tests. Use the mock or stub the transport.
- Don't assert on internal state (`manager['_step']`). Use the public getters or events.
- Don't forget `useProvisioningStore.getState().destroy()` between tests if you used `initialize()`.
