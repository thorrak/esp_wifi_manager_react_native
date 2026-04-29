/**
 * examples/custom-wizard.tsx — full custom wizard built on `useProvisioning`.
 *
 * Renders different content per step, no pre-built screens. ~200 lines.
 * Drop into a single file in your app and adapt styling to taste.
 */

import { useEffect } from 'react';
import {
  ActivityIndicator,
  Alert,
  Linking,
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
  requestBluetoothPermissions,
  useDeviceScanner,
  useProvisioning,
} from 'esp-wifi-config-react-native';
import { useState } from 'react';

const CONFIG = {
  ble: { deviceNamePrefix: ['MyDevice-'] },
};

export default function CustomWizard() {
  useEffect(() => {
    initializeServices(CONFIG);
    return () => {
      void destroyServices();
    };
  }, []);

  const {
    step,
    error,
    device,
    lastResult,
    scannedNetworks,
    selectedNetwork,
    wifiSsid,
    wifiIp,
    start,
    chooseDevice,
    chooseNetwork,
    submitPassword,
    retryJoin,
    pickDifferentNetwork,
    pickDifferentDevice,
    backToNetworks,
    cancel,
  } = useProvisioning();

  const { discoveredDevices, scanning } = useDeviceScanner();

  const handleStart = async () => {
    const r = await requestBluetoothPermissions();
    if (!r.granted) {
      Alert.alert(
        'Bluetooth permission needed',
        r.reason === 'never_ask_again'
          ? 'Open Settings and grant Bluetooth permission.'
          : 'We need Bluetooth to find your device.',
        r.reason === 'never_ask_again'
          ? [
              { text: 'Cancel' },
              { text: 'Open Settings', onPress: () => Linking.openSettings() },
            ]
          : [{ text: 'OK' }],
      );
      return;
    }
    await start();
  };

  // ── render per step ────────────────────────────────────────────────────
  switch (step) {
    case 'welcome':
      return (
        <Container>
          {error && <Banner>{error.message}</Banner>}
          <Text style={styles.title}>WiFi Setup</Text>
          <Pressable style={styles.button} onPress={() => void handleStart()}>
            <Text style={styles.buttonText}>Find devices</Text>
          </Pressable>
        </Container>
      );

    case 'scanBle':
    case 'connectingBle':
      return (
        <Container>
          {error && <Banner>{error.message}</Banner>}
          <Text style={styles.title}>Pick a device</Text>
          {scanning && (
            <View style={styles.row}>
              <ActivityIndicator />
              <Text style={styles.muted}>Scanning…</Text>
            </View>
          )}
          {discoveredDevices.map((d) => {
            const isConnecting =
              device?.status === 'connecting' && device.id === d.id;
            return (
              <Pressable
                key={d.id}
                style={styles.card}
                disabled={device?.status === 'connecting'}
                onPress={() => void chooseDevice(d)}
              >
                <Text style={styles.cardTitle}>{d.name}</Text>
                <Text style={styles.muted}>{d.rssi} dBm</Text>
                {isConnecting && <ActivityIndicator />}
              </Pressable>
            );
          })}
          <Pressable style={styles.linkButton} onPress={() => void cancel()}>
            <Text style={styles.linkText}>Cancel</Text>
          </Pressable>
        </Container>
      );

    case 'configuring':
      // No onConnected configured → this step auto-skips. If you DO use
      // onConnected, render a "Setting up…" UI here.
      return (
        <Container>
          <ActivityIndicator />
          <Text style={styles.muted}>Setting up device…</Text>
        </Container>
      );

    case 'scanningWifi':
    case 'chooseNetwork':
      return (
        <Container>
          {error && <Banner>{error.message}</Banner>}
          <Text style={styles.title}>Pick a network</Text>
          <Text style={styles.muted}>For {device?.name ?? 'your device'}</Text>
          {step === 'scanningWifi' && (
            <View style={styles.row}>
              <ActivityIndicator />
              <Text style={styles.muted}>Scanning networks…</Text>
            </View>
          )}
          {scannedNetworks.map((n, i) => (
            <Pressable
              key={`${n.ssid}-${i}`}
              style={styles.card}
              onPress={() => chooseNetwork(n)}
            >
              <Text style={styles.cardTitle}>{n.ssid}</Text>
              <Text style={styles.muted}>
                {n.auth === 'OPEN' ? 'Open' : n.auth} · {n.rssi} dBm
              </Text>
            </Pressable>
          ))}
          <Pressable
            style={styles.linkButton}
            onPress={() => void pickDifferentDevice()}
          >
            <Text style={styles.linkText}>Pick a different device</Text>
          </Pressable>
        </Container>
      );

    case 'enterCredentials':
      return (
        <CredentialsForm
          ssid={selectedNetwork?.ssid ?? ''}
          isOpen={selectedNetwork?.auth === 'OPEN'}
          error={error?.message ?? null}
          onSubmit={(pw) => void submitPassword(pw)}
          onBack={backToNetworks}
        />
      );

    case 'joiningWifi':
      return (
        <Container>
          {error ? (
            <>
              <Banner severity={error.recoverable ? 'warning' : 'error'}>
                {error.message}
              </Banner>
              {error.recoverable && (
                <>
                  <Pressable
                    style={styles.button}
                    onPress={() => void retryJoin()}
                  >
                    <Text style={styles.buttonText}>Try again</Text>
                  </Pressable>
                  <Pressable
                    style={styles.linkButton}
                    onPress={() => void pickDifferentNetwork()}
                  >
                    <Text style={styles.linkText}>Pick a different network</Text>
                  </Pressable>
                </>
              )}
            </>
          ) : (
            <>
              <ActivityIndicator />
              <Text style={styles.muted}>
                Joining {selectedNetwork?.ssid ?? 'network'}…
              </Text>
            </>
          )}
        </Container>
      );

    case 'success': {
      const ssid = lastResult?.ssid ?? wifiSsid;
      const ip = lastResult?.ip ?? wifiIp;
      return (
        <Container>
          <Text style={styles.title}>Done!</Text>
          <Text style={styles.muted}>{ssid}</Text>
          <Text style={styles.muted}>{ip}</Text>
          <Pressable style={styles.button} onPress={() => void cancel()}>
            <Text style={styles.buttonText}>Close</Text>
          </Pressable>
        </Container>
      );
    }

    default:
      return null;
  }
}

// ── small helper components ──────────────────────────────────────────────

function Container({ children }: { children: React.ReactNode }) {
  return (
    <ScrollView contentContainerStyle={styles.container}>{children}</ScrollView>
  );
}

function Banner({
  children,
  severity = 'error',
}: {
  children: React.ReactNode;
  severity?: 'error' | 'warning';
}) {
  const color = severity === 'warning' ? '#F59E0B' : '#EF4444';
  return (
    <View style={[styles.banner, { borderColor: color }]}>
      <Text style={{ color }}>{children}</Text>
    </View>
  );
}

function CredentialsForm({
  ssid,
  isOpen,
  error,
  onSubmit,
  onBack,
}: {
  ssid: string;
  isOpen: boolean;
  error: string | null;
  onSubmit: (pw: string) => void;
  onBack: () => void;
}) {
  const [pw, setPw] = useState('');
  return (
    <Container>
      {error && <Banner>{error}</Banner>}
      <Text style={styles.title}>Connect to {ssid}</Text>
      {!isOpen && (
        <TextInput
          style={styles.input}
          placeholder="Password"
          secureTextEntry
          value={pw}
          onChangeText={setPw}
        />
      )}
      <Pressable style={styles.button} onPress={() => onSubmit(isOpen ? '' : pw)}>
        <Text style={styles.buttonText}>Connect</Text>
      </Pressable>
      <Pressable style={styles.linkButton} onPress={onBack}>
        <Text style={styles.linkText}>Back</Text>
      </Pressable>
    </Container>
  );
}

const styles = StyleSheet.create({
  container: { padding: 24, gap: 12 },
  title: { fontSize: 22, fontWeight: '700' },
  muted: { color: '#64748B' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  card: {
    padding: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  cardTitle: { fontSize: 16, fontWeight: '600' },
  banner: {
    padding: 12,
    borderWidth: 1,
    borderRadius: 8,
  },
  button: {
    backgroundColor: '#2563EB',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
  },
  buttonText: { color: 'white', fontWeight: '600' },
  linkButton: { padding: 8, alignItems: 'center' },
  linkText: { color: '#2563EB', fontWeight: '600' },
  input: {
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    padding: 14,
    fontSize: 16,
  },
});
