/**
 * examples/with-onconnected.tsx — pre-WiFi mDNS hostname setup.
 *
 * Demonstrates the `flow.onConnected` hook plus a custom UI for the
 * `configuring` step that lets the user edit the hostname before WiFi
 * provisioning continues.
 *
 * Two patterns shown:
 *   1. Non-interactive: onConnected sets a default mdns_name automatically.
 *   2. Interactive: a custom screen for `step === 'configuring'` lets the
 *      user confirm/edit, then calls `proceedFromConfigure()` to advance.
 *
 * Pick one — don't combine.
 */

import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import {
  destroyServices,
  initializeServices,
  useDeviceVariables,
  useProvisioning,
} from 'esp-wifi-config-react-native';

// ===========================================================================
// PATTERN 1 — non-interactive default hostname
// ===========================================================================

const NON_INTERACTIVE_CONFIG = {
  ble: { deviceNamePrefix: ['MyDevice-'] },
  flow: {
    onConnected: async ({
      protocol,
    }: {
      protocol: import('esp-wifi-config-react-native').DeviceProtocol;
    }) => {
      // If the device has no mdns_name yet, generate one. Otherwise leave
      // whatever the user set previously alone.
      const v = await protocol.getVar('mdns_name');
      if (!v.value) {
        const suggested = `mydevice-${Math.random().toString(36).slice(2, 7)}`;
        await protocol.setVar('mdns_name', suggested);
      }
    },
  },
};

// ===========================================================================
// PATTERN 2 — interactive form on the configuring step
// ===========================================================================

// Use this config: NO onConnected. The configuring step won't auto-advance
// because we render a custom screen for it that manually calls
// proceedFromConfigure() when ready.
//
// IMPORTANT: without onConnected, the manager auto-advances. To pause the
// flow, render a screen for `step === 'configuring'` AND have it block its
// own render until your custom screen calls proceedFromConfigure().
//
// The cleanest version uses an onConnected that gates on a Promise the
// custom screen resolves — see PATTERN 2B below.
//
// This file shows PATTERN 2A: simpler version with a synchronous
// onConnected that just primes mdns_name with a default, then a custom
// screen lets the user edit it AFTER the WiFi scan starts (i.e. on the
// chooseNetwork step). That's not actually pre-WiFi customization — it's
// post-connect cleanup. For true mid-flow gating, use PATTERN 2B.

// PATTERN 2B — gated onConnected.

let resolveProceed: (() => void) | null = null;

const INTERACTIVE_CONFIG = {
  ble: { deviceNamePrefix: ['MyDevice-'] },
  flow: {
    onConnected: async () => {
      // Park here until the custom configuring screen calls
      // releaseConfigure(). The user sees the configure screen the whole
      // time onConnected is awaiting this Promise.
      await new Promise<void>((resolve) => {
        resolveProceed = resolve;
      });
    },
  },
};

function releaseConfigure() {
  resolveProceed?.();
  resolveProceed = null;
}

// ---------------------------------------------------------------------------
// Custom configure screen — used with PATTERN 2B
// ---------------------------------------------------------------------------

function ConfigureMdnsScreen() {
  const { proceedFromConfigure, error } = useProvisioning();
  const { getVariable, setVariable, loading } = useDeviceVariables();
  const [name, setName] = useState('');
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    void (async () => {
      const v = await getVariable('mdns_name');
      if (v) setName(v.value);
      setLoaded(true);
    })();
  }, [getVariable]);

  const onContinue = async () => {
    if (!name.trim()) return;
    const ok = await setVariable('mdns_name', name.trim());
    if (!ok) return; // error is exposed via useDeviceVariables().error
    releaseConfigure(); // unblocks onConnected → manager advances
    await proceedFromConfigure(); // belt-and-suspenders no-op if already advanced
  };

  if (!loaded) {
    return (
      <View style={styles.center}>
        <ActivityIndicator />
      </View>
    );
  }

  return (
    <ScrollView contentContainerStyle={styles.container}>
      {error && <Text style={styles.error}>{error.message}</Text>}
      <Text style={styles.title}>Name your device</Text>
      <Text style={styles.muted}>
        Used as the mDNS hostname (reachable as {name || 'name'}.local).
      </Text>
      <TextInput
        style={styles.input}
        value={name}
        onChangeText={setName}
        autoCapitalize="none"
        autoCorrect={false}
        editable={!loading}
      />
      <Pressable
        style={[styles.button, !name.trim() && styles.buttonDisabled]}
        onPress={() => void onContinue()}
        disabled={!name.trim() || loading}
      >
        <Text style={styles.buttonText}>{loading ? 'Saving…' : 'Continue'}</Text>
      </Pressable>
    </ScrollView>
  );
}

// ---------------------------------------------------------------------------
// Entry — switch between the two patterns by uncommenting one
// ---------------------------------------------------------------------------

export default function App() {
  useEffect(() => {
    // initializeServices(NON_INTERACTIVE_CONFIG); // PATTERN 1
    initializeServices(INTERACTIVE_CONFIG); // PATTERN 2B
    return () => {
      void destroyServices();
    };
  }, []);

  const { step } = useProvisioning();

  if (step === 'configuring') return <ConfigureMdnsScreen />;
  // … render the rest of your wizard for other steps
  return null;
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { color: '#64748B' },
  error: { color: '#EF4444' },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonDisabled: { opacity: 0.5 },
  buttonText: { color: 'white', fontWeight: '600' },
});
