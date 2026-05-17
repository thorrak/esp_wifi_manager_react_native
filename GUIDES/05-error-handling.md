# Error handling

**When to use this:** you want to display errors to the user, decide what retry options to offer, or programmatically react to specific failure modes.

**What you'll end up with:** a single render path for errors, with branching only on `error.source`/`error.code` when you need targeted handling.

## The envelope

```ts
type ProvisioningError = {
  source: 'ble' | 'protocol' | 'provision' | 'flow';
  code?: string;        // e.g. 'unauthorized', 'provision_failed'
  message: string;      // for direct UI display
  recoverable: boolean; // user can retry from same step
};
```

`useProvisioning().error` is `ProvisioningError | null`. There is exactly one error field.

## Sources

| Source | When | Recoverable? |
|------|------|------|
| `ble` | BLE adapter / scan / connect / session-init failure | Sometimes — `unauthorized` is recoverable (bounces to `enterDeviceAuth`); `connection_lost` mid-flow is not |
| `protocol` | Device rejected a custom-endpoint call, JSON parse error, command timeout | Usually `true` |
| `provision` | The SDK's atomic `provision()` rejected — wrong WiFi password, AP not in range, STA-connect timeout | Usually `true` |
| `flow` | `onConnected` callback threw, missing required PoP/credentials, no network selected, etc. | Usually `true` |

## Codes

| Code | Source | Meaning |
|------|------|------|
| `unauthorized` | `ble` | Either OS-level Bluetooth permission denial OR a rejected protocomm handshake (wrong PoP / SRP credentials). The wizard bounces back to `enterDeviceAuth` so the user can correct the credentials. |
| `powered_off` | `ble` | Bluetooth is turned off |
| `unsupported` | `ble` | BLE not supported on this device |
| `scan_error` | `ble` | Scan API returned an error |
| `connect_error` | `ble` | Generic BLE connect failure not classified as `unauthorized` |
| `connection_lost` | `ble` | Mid-flow BLE disconnect on a step other than `success` |
| `provision_failed` | `provision` | The SDK's `provision()` rejected — typically a wrong WiFi password or the AP being unreachable |
| `no_network` | `flow` | `submitPassword` called with no `selectedNetwork` |
| `no_device` | `flow` | `submitDeviceAuth` called with no pending device target |
| `missing_pop` | `flow` | `submitDeviceAuth` called without a required PoP/SRP password |

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
      {/* retryJoin() with no argument bounces back to enterCredentials
          so the user can re-enter the password. Pass a string to re-use
          the same password. */}
      <Button onPress={() => void retryJoin()}>Try again</Button>
      <Button onPress={() => void pickDifferentNetwork()}>Pick a different network</Button>
    </View>
  );
}

if (error && !error.recoverable) {
  return (
    <View>
      <Text>{error.message}</Text>
      <Button onPress={() => void cancel()}>Start over</Button>
    </View>
  );
}
```

### Unauthorized on `enterDeviceAuth`

When the protocomm handshake rejects the credentials, the wizard bounces back to `enterDeviceAuth` and the screen pre-fills the last-entered values (via `useProvisioning().pendingAuth`). The recommended flow is to render the error banner above the form and let the user fix the typo:

```tsx
case 'enterDeviceAuth':
  return (
    <DeviceAuthForm
      errorMessage={
        error?.code === 'unauthorized'
          ? 'Authentication rejected. Check the values and try again.'
          : error?.message
      }
    />
  );
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
