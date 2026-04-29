# Error handling

**When to use this:** you want to display errors to the user, decide what retry options to offer, or programmatically react to specific failure modes.

**What you'll end up with:** a single render path for errors, with branching only on `error.source`/`error.code` when you need targeted handling.

## The envelope

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'poller' | 'flow';
  code?: string;        // e.g. 'unauthorized', 'connection_failed'
  message: string;      // for direct UI display
  recoverable: boolean; // user can retry from same step
};
```

`useProvisioning().error` is `ProvisioningError | null`. There is exactly one error field.

## Sources

| Source | When | Recoverable? |
|------|------|------|
| `ble` | BLE adapter / scan / connect failure | Sometimes (e.g. `connection_lost: false`, scan retry: `true`) |
| `protocol` | Command rejected by the device, JSON parse error, command timeout | Usually `true` |
| `poller` | WiFi join failed (`connection_failed`) or timed out (`connection_timeout`) | Always `true` |
| `flow` | `onConnected` callback threw, no network selected, etc. | Usually `true` |

## Codes

| Code | Source | Meaning |
|------|------|------|
| `unauthorized` | ble | User denied Bluetooth permission |
| `powered_off` | ble | Bluetooth is turned off |
| `unsupported` | ble | BLE not supported on this device |
| `adapter_timeout` | ble | BLE adapter didn't reach PoweredOn within 10s |
| `scan_error` | ble | Scan API returned an error |
| `connection_lost` | ble | Mid-flow BLE disconnect (not on success/manage) |
| `connection_failed` | poller | Saw connecting → disconnected; bad password or AP not in range |
| `connection_timeout` | poller | Polled for full timeout without seeing a terminal state |
| `no_network` | flow | `submitPassword` called with no `selectedNetwork` |

`code` is optional — generic protocol errors don't have one.

## Display pattern

```tsx
const { error } = useProvisioning();

return (
  <>
    {error && (
      <Banner
        severity={error.recoverable ? 'warning' : 'error'}
        message={error.message}
      />
    )}
    {error?.code === 'unauthorized' && (
      <Pressable onPress={() => Linking.openSettings()}>
        <Text>Open Settings</Text>
      </Pressable>
    )}
    {error?.code === 'powered_off' && (
      <Text>Turn Bluetooth on and try again.</Text>
    )}
  </>
);
```

That's it. One field, one banner, optional contextual hints from `code`.

## Retry decisions

```tsx
const { error, step, retryJoin, pickDifferentNetwork, cancel } = useProvisioning();

if (step === 'joiningWifi' && error?.recoverable) {
  return (
    <View>
      <Text>{error.message}</Text>
      <Button onPress={retryJoin}>Try again</Button>
      <Button onPress={pickDifferentNetwork}>Pick a different network</Button>
    </View>
  );
}

if (error && !error.recoverable) {
  return (
    <View>
      <Text>{error.message}</Text>
      <Button onPress={cancel}>Start over</Button>
    </View>
  );
}
```

## Error lifecycle

- `error` is set when the manager calls `setError(...)`.
- `error` is cleared when the manager calls `clearError()` — typically at the start of an action like `start()`, `chooseDevice()`, `submitPassword()`, etc.
- `error` is also cleared by `cancel()` since it resets all state.
- A successful action transition does not necessarily clear the error — the manager only clears if the action explicitly does so. In practice, every action verb starts with `clearError()`.

## Errors during `useDeviceVariables` / `useDeviceProtocol`

These hooks have their own per-instance `error` field, separate from the wizard's global `error`. They do NOT pollute `useProvisioning().error`.

```tsx
const { setVariable, error: varError } = useDeviceVariables();
const { error: wizardError } = useProvisioning();

// `varError` is from your own setVariable calls.
// `wizardError` is from the wizard flow.
```

This separation is intentional — your ad-hoc commands shouldn't interfere with the wizard's status display.

## Don't

- Don't merge `error` with hook-level errors before display. They mean different things.
- Don't read `error.code` and assume it exists. It's optional.
- Don't ignore `error.recoverable`. Showing a "Retry" button on a non-recoverable error frustrates users.
