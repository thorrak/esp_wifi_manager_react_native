# Pre-WiFi customization with `onConnected`

**When to use this:** you need to talk to the device before WiFi is provisioned — set a hostname, write app config, validate firmware version, etc.

**What you'll end up with:** the wizard runs your custom callback after BLE connects but before the WiFi scan starts. Failures park the user on the configure screen.

## The hook point

Provide `flow.onConnected` in your config:

```ts
initializeServices({
  flow: {
    onConnected: async ({ protocol, transport }) => {
      // Your custom logic here. Throw to surface an error.
    },
  },
});
```

Or pass it to the navigator:

```tsx
<ProvisioningNavigator
  config={{
    flow: {
      onConnected: async ({ protocol }) => {
        await protocol.setVar('mdns_name', 'my-device');
      },
    },
  }}
/>
```

## What the manager does

1. User taps a device → step `connectingBle` → BLE handshake completes.
2. Step transitions to `configuring`.
3. Manager awaits your `onConnected({ protocol, transport })`.
4. **On success:** step transitions to `scanningWifi` → WiFi scan runs → `chooseNetwork`.
5. **On throw:** manager parks on `configuring` with `error: { source: 'flow', recoverable: true, message: ... }`.

If you don't supply `onConnected`, the manager skips step 3 entirely — the user sees `connectingBle` flicker through `configuring` to `scanningWifi` instantly.

## Recipe — set device hostname

```ts
config={{
  flow: {
    onConnected: async ({ protocol }) => {
      const current = await protocol.getVar('mdns_name');
      if (!current?.value) {
        const suggested = `my-app-${Math.random().toString(36).slice(2, 7)}`;
        await protocol.setVar('mdns_name', suggested);
      }
    },
  },
}}
```

## Recipe — interactive hostname form

When you need user input mid-flow, render a custom screen for `step === 'configuring'` and call `proceedFromConfigure()` when ready.

```tsx
function MyConfigureScreen() {
  const { proceedFromConfigure, error } = useProvisioning();
  const { getVariable, setVariable, loading } = useDeviceVariables();
  const [name, setName] = useState('');

  // Load current value once on mount.
  useEffect(() => {
    void (async () => {
      const v = await getVariable('mdns_name');
      if (v) setName(v.value);
    })();
  }, []);

  const onContinue = async () => {
    const ok = await setVariable('mdns_name', name);
    if (ok) await proceedFromConfigure();
  };

  return (
    <View>
      {error && <Banner>{error.message}</Banner>}
      <TextInput value={name} onChangeText={setName} editable={!loading} />
      <Button onPress={onContinue} disabled={loading}>Continue</Button>
    </View>
  );
}
```

In this recipe, you do NOT pass `onConnected` in the config. Instead, the configure screen handles the interaction and calls `proceedFromConfigure()` to advance the manager.

To gate the wizard on this screen, omit `flow.onConnected` (so the auto-skip is disabled by your custom screen rendering for `step === 'configuring'`).

Wait — that's not quite right. With no `onConnected`, the manager *auto-advances* through `configuring`. To pause on `configuring`, you need a placeholder `onConnected` that resolves immediately but you also want the user to do something. The cleanest approach:

**Option A:** Pass an `onConnected` that does nothing (or does part of the work) and let the user complete more in your custom screen — but the user only sees the screen briefly because the manager will auto-advance after `onConnected` resolves.

**Option B:** Pass an `onConnected` that explicitly waits on a signal you control:

```ts
let resolveProceed: () => void;
const proceed = new Promise<void>(r => { resolveProceed = r; });

initializeServices({
  flow: {
    onConnected: async ({ protocol }) => {
      // Optionally do bootstrap setup here
      await proceed; // park until your UI calls resolveProceed
    },
  },
});
```

Then your custom configure screen calls `resolveProceed()` when the user is done. This is the right pattern for interactive forms.

**Option C (recommended):** Throw from `onConnected` if you couldn't complete setup, so the manager parks on `configuring` with a `flow` error. The user sees the configure screen, can call `proceedFromConfigure()` to skip the failure, or `pickDifferentDevice()` to start over. Use this when failure is the exception case.

## Recipe — validate firmware version

The `esp-wifi-config-version` endpoint surfaces `lib` (library version), `idf` (ESP-IDF version), `fw_version` (app version), and `app` (project name). Read it via `protocol.getVersion()`:

```ts
config={{
  flow: {
    onConnected: async ({ protocol }) => {
      const v = await protocol.getVersion();
      if (!v.fw_version || semverLt(v.fw_version, '2.0.0')) {
        throw new Error(`Device firmware ${v.fw_version ?? 'unknown'} too old. Update to 2.0.0+ before provisioning.`);
      }
    },
  },
}}
```

The user lands on `configuring` with the error. Render a "Firmware too old" message + buttons for "Pick different device" (`pickDifferentDevice()`) and "Skip and continue anyway" (`proceedFromConfigure()`).

## Common pitfalls

- **Don't mutate manager state from `onConnected`.** Just call protocol/transport methods. The manager owns its own state machine.
- **Don't expect `onConnected` to be called more than once per `chooseDevice`.** It runs once per BLE connection. If the user picks a different device, it runs again on the next connection.
- **Don't use `useDeviceVariables` inside `onConnected`.** That callback runs outside React. Use `protocol.getVar`/`protocol.setVar` directly via the `ctx` argument.
