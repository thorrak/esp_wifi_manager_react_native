# Building a custom wizard with hooks

**When to use this:** you want full control over the UI but don't want to re-implement the BLE state machine, command protocol, or polling logic.

**What you'll end up with:** a single screen component that renders different content per `step` and calls action verbs to advance the flow.

## The pattern

```tsx
const { step, /* state */, /* verbs */ } = useProvisioning();

switch (step) {
  case 'welcome': return <Intro />;
  case 'scanBle':
  case 'connectingBle': return <DeviceList />;
  case 'configuring': return <ConfiguringSpinner />;
  case 'scanningWifi':
  case 'chooseNetwork': return <NetworkList />;
  case 'enterCredentials': return <PasswordForm />;
  case 'joiningWifi': return <Joining />;
  case 'success': return <Done />;
}
```

Each branch renders one screen. The library drives the transitions; you tell it when to act.

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
  ble: { deviceNamePrefix: ['MyDevice-'] },
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
    wifiSsid, wifiIp,
    start, chooseDevice, chooseNetwork,
    submitPassword, retryJoin, pickDifferentNetwork,
    pickDifferentDevice, cancel,
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

`error.recoverable` lets you decide whether to show a "Retry" button or a "Start over" button. Joining-wifi failures (`source: 'poller'`) are recoverable; BLE permission denials (`source: 'ble'`, `code: 'unauthorized'`) are not.

## Back / cancel handling

```tsx
const onBack = async () => {
  switch (step) {
    case 'welcome': router.back(); return;
    case 'scanBle':
    case 'connectingBle': await cancel(); router.back(); return;
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
    case 'success':
    case 'manage': await cancel(); router.back(); return;
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
      <Text>Connected to {lastResult?.ssid ?? wifiSsid}</Text>
      <Text>IP: {lastResult?.ip ?? wifiIp}</Text>
      <Button onPress={() => void cancel()}>Done</Button>
    </View>
  );
```

The device drops BLE shortly after a successful join; reading `wifiSsid`/`wifiIp` directly will return empty after that, but `lastResult` stays populated.

## Complete example

See [examples/custom-wizard.tsx](../examples/custom-wizard.tsx) for a full working file.

## Don't

- Don't derive booleans like `busy && !networks.length` to figure out "are we scanning". The step IS the phase.
- Don't read `wifiSsid` on the success screen if you can read `lastResult.ssid`.
- Don't `await cancel()` and then immediately `router.back()` if `cancel()` is on a path that itself navigates — pick one.
