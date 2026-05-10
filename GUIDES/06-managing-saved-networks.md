# Post-provision device management

> **v2.x note.** This guide is largely superseded. ESP-IDF Network
> Provisioning over BLE only exposes a small set of custom protocomm
> endpoints (`esp-wifi-config-version`, `…-capabilities`,
> `…-vars`, `…-network-policy`) — saved-network management, SoftAP
> control, and factory reset all moved to the device's HTTP API once
> it's on the network. The BLE-side hooks `useSavedNetworks` and
> `useAccessPoint` were removed in v2.0.0; only `useDeviceVariables`
> remains, plus the new `useDeviceProtocol().getVersion / getCapabilities
> / getNetworkPolicy` for read-only diagnostics.
>
> For HTTP-side device management on the WiFi network see the firmware's
> REST API documentation at https://configwifi.com/docs/api/rest-api.

**When to use this (v1):** after a successful provision, you want to let the user view/delete saved networks, change the soft-AP, edit app variables, or factory-reset the device — all over the existing BLE connection.

**What you'll end up with (v1):** a "manage" screen that uses `useSavedNetworks`, `useAccessPoint`, and `useDeviceVariables` to interact with the device.

## Prereq — being on the `manage` step

The wizard transitions to `manage` only when you call `goToManage()` from `success`. Pre-built `SuccessScreen` includes a "Manage Device" button that does this.

```tsx
const { step, goToManage } = useProvisioning();
if (step === 'success') return <Success onManage={goToManage} />;
if (step === 'manage') return <ManageScreen />;
```

## Saved networks

```tsx
import { useSavedNetworks } from 'esp-wifi-config-react-native';

function SavedNetworksList() {
  const { networks, loading, error, deleteNetwork, fetchNetworks } =
    useSavedNetworks(); // auto-fetches on mount

  if (loading && networks.length === 0) return <Spinner />;
  if (error) return <Text>{error}</Text>;

  return (
    <FlatList
      data={networks}
      keyExtractor={n => n.ssid}
      renderItem={({ item }) => (
        <View>
          <Text>{item.ssid}</Text>
          <Text>priority: {item.priority}</Text>
          <Button onPress={() => deleteNetwork(item.ssid)}>Delete</Button>
        </View>
      )}
      onRefresh={fetchNetworks}
      refreshing={loading}
    />
  );
}
```

`useSavedNetworks` auto-fetches on mount. `deleteNetwork` re-fetches after deletion to keep the list in sync.

## Soft access point

```tsx
import { useAccessPoint } from 'esp-wifi-config-react-native';

function ApPanel() {
  const { apStatus, startAp, stopAp, loading, error } = useAccessPoint();

  return (
    <View>
      {error && <Text>{error}</Text>}
      <Text>AP active: {apStatus?.active ? 'yes' : 'no'}</Text>
      <Text>SSID: {apStatus?.ssid}</Text>
      <Text>Connected stations: {apStatus?.sta_count}</Text>
      <Button
        onPress={() => apStatus?.active ? stopAp() : startAp()}
        disabled={loading}
      >
        {apStatus?.active ? 'Stop AP' : 'Start AP'}
      </Button>
    </View>
  );
}
```

Pass custom AP settings via `startAp({ ssid: 'MyAP', password: 'secret' })`.

## Device variables

For application config (mDNS name, MQTT broker, custom keys):

```tsx
import { useDeviceVariables } from 'esp-wifi-config-react-native';

function HostnameEditor() {
  const { getVariable, setVariable, loading, error } = useDeviceVariables();
  const [name, setName] = useState('');

  useEffect(() => {
    void (async () => {
      const v = await getVariable('mdns_name');
      if (v) setName(v.value);
    })();
  }, [getVariable]);

  return (
    <View>
      {error && <Text>{error}</Text>}
      <TextInput value={name} onChangeText={setName} editable={!loading} />
      <Button
        onPress={async () => { await setVariable('mdns_name', name); }}
        disabled={loading}
      >
        Save
      </Button>
    </View>
  );
}
```

`getVariable` returns `DeviceVariable | null` (null on error). `setVariable` returns `boolean` (true on success). `loading` reflects ANY in-flight call from this hook instance.

## Factory reset

```tsx
import { useDeviceProtocol } from 'esp-wifi-config-react-native';

function FactoryReset() {
  const { factoryReset, loading } = useDeviceProtocol();

  const onPress = async () => {
    Alert.alert(
      'Reset device?',
      'All saved networks and settings will be cleared.',
      [
        { text: 'Cancel' },
        { text: 'Reset', style: 'destructive', onPress: () => void factoryReset() },
      ],
    );
  };

  return <Button onPress={onPress} disabled={loading}>Factory Reset</Button>;
}
```

The device drops BLE shortly after `factory_reset` — the wizard's mid-flow disconnect detector will fire. To prevent that, call `cancel()` immediately after queueing the factory reset, OR transition to a screen that doesn't care about BLE state.

## Don't

- Don't build a manage screen that also tries to advance the wizard. Manage is a terminal branch off `success`.
- Don't keep `useSavedNetworks` mounted on screens that don't need it — it auto-fetches on mount.
