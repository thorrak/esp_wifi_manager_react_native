# Building a custom wizard with hooks

**When to use this:** you want full control over the UI but don't want to re-implement the BLE state machine, the SDK-driven provision flow, or the conditional device-auth step.

**What you'll end up with:** a single screen component that renders different content per `step` and calls action verbs to advance the flow.

## The pattern

```tsx
const { step, /* state */, /* verbs */ } = useProvisioning();

switch (step) {
  case 'welcome': return <Intro />;
  case 'scanBle':
  case 'connectingBle': return <DeviceList />;
  case 'enterDeviceAuth': return <DeviceAuthForm />;
  case 'configuring': return <ConfiguringSpinner />;
  case 'scanningWifi':
  case 'chooseNetwork': return <NetworkList />;
  case 'enterCredentials': return <PasswordForm />;
  case 'joiningWifi': return <Joining />;
  case 'success': return <Done />;
}
```

Each branch renders one screen. The library drives the transitions; you tell it when to act.

`enterDeviceAuth` only appears when `ble.security !== 0` AND credentials are not pre-configured (or `ble.promptForAuth: true`, or you're bouncing back from an `unauthorized` error). With sec1 and `proofOfPossession` set — including `''` for a device that runs without a PoP — it's skipped entirely.

## Wiring the wizard

```tsx
import { useEffect } from 'react';
import { Alert } from 'react-native';
import {
  initializeServices,
  destroyServices,
  useProvisioning,
  useDeviceScanner,
  requestBluetoothPermissions,
} from 'esp-wifi-config-react-native';

const CONFIG = {
  ble: {
    deviceNamePrefix: ['MyDevice-'],
    security: 1,
    proofOfPossession: 'abcd1234',
    // promptForAuth: true,   // uncomment for per-device PoPs
  },
};

export default function WifiSetupScreen() {
  // Initialize once. The store handles dedupe internally.
  useEffect(() => {
    initializeServices(CONFIG);
    return () => { void destroyServices(); };
  }, []);

  const {
    step, error, device,
    scannedNetworks, selectedNetwork,
    lastResult, lastProvisionResult,
    authMode, defaultAuthValues, pendingAuth,
    start, chooseDevice, submitDeviceAuth, chooseNetwork,
    submitPassword, retryJoin, pickDifferentNetwork,
    pickDifferentDevice, cancel, backToNetworks,
  } = useProvisioning();
  const { discoveredDevices, scanning } = useDeviceScanner();

  const handleStart = async () => {
    const r = await requestBluetoothPermissions();
    if (!r.granted) {
      Alert.alert('Bluetooth permission needed');
      return;
    }
    await start();
  };

  // … render based on step
}
```

## Sub-step handling

Pairs of adjacent steps share a screen because they're the same UI surface with different sub-states:

| Visible screen | Step variants |
|------|------|
| Device list | `scanBle` (active), `connectingBle` (one device shows spinner overlay) |
| WiFi list | `scanningWifi` (loading), `chooseNetwork` (list visible) |

In your render branch:

```tsx
function DeviceList({ devices, scanning, device, onPick }) {
  return (
    <ScrollView>
      {devices.map(d => (
        <Pressable
          key={d.id}
          onPress={() => onPick(d)}
          disabled={device?.status === 'connecting'}
        >
          <Text>{d.name} ({d.rssi}dBm)</Text>
          {device?.status === 'connecting' && device.id === d.id && <Spinner />}
        </Pressable>
      ))}
    </ScrollView>
  );
}
```

`device.status === 'connecting'` is your spinner-overlay flag. Same for `step === 'scanningWifi'` → render a loading state inside the network list screen.

## Building the `enterDeviceAuth` screen

```tsx
function DeviceAuthForm() {
  const { authMode, defaultAuthValues, pendingAuth, submitDeviceAuth, error } =
    useProvisioning();
  const [pop, setPop] = useState(pendingAuth?.pop ?? defaultAuthValues.pop ?? '');
  const [username, setUsername] = useState(
    pendingAuth?.username ?? defaultAuthValues.username ?? '',
  );

  if (authMode === null) return null; // sec0 — should never get here

  return (
    <View>
      {error?.code === 'unauthorized' && (
        <Text>Authentication rejected, try again.</Text>
      )}
      {authMode === 'srp' && (
        <TextInput value={username} onChangeText={setUsername} placeholder="Username" />
      )}
      <TextInput
        value={pop}
        onChangeText={setPop}
        secureTextEntry
        placeholder={authMode === 'srp' ? 'SRP password' : 'PoP code'}
      />
      <Button title="Connect" onPress={() => void submitDeviceAuth({ pop, username })} />
    </View>
  );
}
```

Pre-fill from `pendingAuth` first (covers the unauthorized-bounce case) then `defaultAuthValues` (covers `promptForAuth: true` with a known-good fleet PoP).

## Error display

Single field, single render path:

```tsx
{error && (
  <Banner severity={error.recoverable ? 'warning' : 'error'}>
    {error.message}
  </Banner>
)}
{error?.code === 'unauthorized' && (
  <Button onPress={() => Linking.openSettings()}>Open settings</Button>
)}
```

`error.recoverable` lets you decide whether to show a "Retry" button or a "Start over" button. `source: 'provision'` errors (e.g. wrong WiFi password) are usually recoverable; `source: 'ble'` with `code: 'connection_lost'` is not.

## Back / cancel handling

```tsx
const onBack = async () => {
  switch (step) {
    case 'welcome': router.back(); return;
    case 'scanBle':
    case 'connectingBle': await cancel(); router.back(); return;
    case 'enterDeviceAuth': await pickDifferentDevice(); return;
    case 'configuring':
    case 'scanningWifi':
    case 'chooseNetwork': await pickDifferentDevice(); return;
    case 'enterCredentials': backToNetworks(); return;
    case 'joiningWifi':
      Alert.alert('Cancel?', '', [
        { text: 'Keep waiting' },
        { text: 'Cancel', onPress: () => void cancel() },
      ]);
      return;
    case 'success': await cancel(); router.back(); return;
  }
};
```

The verbs map directly to user intent; the back-button is just a dispatch table.

## Loading the success screen

`lastResult` is latched from `provisioningComplete` and survives `cancel()`. Use it as the source of truth on your success screen:

```tsx
case 'success':
  return (
    <View>
      <Text>Connected to {lastResult?.ssid}</Text>
      <Text>Status: {lastProvisionResult?.status ?? lastResult?.provisionStatus}</Text>
      <Button onPress={() => void cancel()}>Done</Button>
    </View>
  );
```

The device drops BLE shortly after a successful join (and, unless the firmware sets `prov_ble.disable_reboot_on_provisioning_success`, reboots — by default within ~15 s of connecting, or as soon as the client disconnects). The manager uses that window to read the device's assigned IP from the `esp-wifi-config-network-info` endpoint and stores it on `lastResult.networkInfo` (firmware 0.2.0+, best-effort). Don't issue your own BLE reads after `success` — render `lastResult.networkInfo?.ip` if present, otherwise fall back to mDNS or your firmware's HTTP API once the device is on the WiFi network.

## Complete example

See [examples/custom-wizard.tsx](../examples/custom-wizard.tsx) for a full working file.

## Don't

- Don't derive booleans like `busy && !networks.length` to figure out "are we scanning". The step IS the phase.
- `useProvisioning()` does not expose live Wi-Fi fields like `wifiSsid`/`wifiIp`. Use `lastResult` / `lastProvisionResult` for the outcome, and fetch the device IP out of band (mDNS or the firmware's HTTP API).
- Don't `await cancel()` and then immediately `router.back()` if `cancel()` is on a path that itself navigates — pick one.
- Don't reach into `getTransport()` or `getProtocol()` from a screen to figure out the security version. Use `authMode` from `useProvisioning()`.
