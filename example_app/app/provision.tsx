import { useEffect, useState, Component, type ReactNode } from 'react';
import {
  ScrollView,
  StyleSheet,
  View,
  Text,
  TouchableOpacity,
} from 'react-native';
import { useRouter } from 'expo-router';
import {
  ProvisioningNavigator,
} from 'esp-wifi-config-react-native/navigation';
import {
  requestBluetoothPermissions,
  type BlePermissionResult,
  type DeviceNetworkInfo,
  type ProvisioningResult,
} from 'esp-wifi-config-react-native';

// ---------------------------------------------------------------------------
// Error Boundary — catches unexpected runtime errors from ProvisioningNavigator
// ---------------------------------------------------------------------------
interface ErrorBoundaryProps {
  onDismiss: () => void;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

class ProvisioningErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <BleUnavailableScreen
          message={`An unexpected error occurred:\n${this.state.error.message}`}
          onDismiss={this.props.onDismiss}
        />
      );
    }
    return this.props.children;
  }
}

// ---------------------------------------------------------------------------
// BLE Unavailable Screen
// ---------------------------------------------------------------------------
function BleUnavailableScreen({
  message,
  onDismiss,
}: {
  message: string;
  onDismiss: () => void;
}) {
  return (
    <View style={styles.unavailable}>
      <Text style={styles.unavailableIcon}>&#x26A0;</Text>
      <Text style={styles.unavailableTitle}>Bluetooth Unavailable</Text>
      <Text style={styles.unavailableMessage}>{message}</Text>
      <TouchableOpacity style={styles.dismissButton} onPress={onDismiss}>
        <Text style={styles.dismissButtonText}>Go Back</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Provisioning Complete Screen — shows the result, including the device's
// assigned network details fetched from the `esp-wifi-config-network-info`
// custom endpoint (ProvisioningResult.networkInfo).
// ---------------------------------------------------------------------------
function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Text style={styles.detailLabel}>{label}</Text>
      <Text style={styles.detailValue} selectable>
        {value}
      </Text>
    </View>
  );
}

/** Build labeled rows from the device's network info, skipping absent fields. */
function networkInfoRows(info: DeviceNetworkInfo): { label: string; value: string }[] {
  const rows: { label: string; value: string }[] = [];
  const push = (label: string, value: unknown, suffix = '') => {
    if (value !== undefined && value !== null && value !== '') {
      rows.push({ label, value: `${value}${suffix}` });
    }
  };
  push('IP address', info.ip);
  push('Gateway', info.gateway);
  push('Subnet mask', info.netmask);
  push('DNS', info.dns);
  push('MAC', info.mac);
  push('BSSID', info.bssid);
  push('Hostname', info.hostname);
  push('Signal', info.rssi, ' dBm');
  push('Quality', info.quality, '%');
  push('Channel', info.channel);
  if (info.uptime_ms !== undefined) {
    push('Connected for', (info.uptime_ms / 1000).toFixed(1), ' s');
  }
  return rows;
}

function ProvisioningResultScreen({
  result,
  onDone,
}: {
  result: ProvisioningResult;
  onDone: () => void;
}) {
  const info = result.networkInfo;
  return (
    <View style={styles.resultContainer}>
      <ScrollView contentContainerStyle={styles.resultContent}>
        <Text style={styles.resultIcon}>&#x2705;</Text>
        <Text style={styles.resultTitle}>Provisioning Complete</Text>

        <View style={styles.detailsCard}>
          <DetailRow
            label="Status"
            value={result.provisionStatus ?? (result.success ? 'success' : 'failed')}
          />
          {result.ssid ? <DetailRow label="Network (SSID)" value={result.ssid} /> : null}
          {result.deviceName ? (
            <DetailRow label="Device" value={result.deviceName} />
          ) : null}
        </View>

        <Text style={styles.sectionHeading}>Device Network Details</Text>
        <Text style={styles.sectionSubtitle}>
          Reported by the device over BLE (esp-wifi-config-network-info).
        </Text>

        {info && info.connected ? (
          <View style={styles.detailsCard}>
            {networkInfoRows(info).map((row) => (
              <DetailRow key={row.label} label={row.label} value={row.value} />
            ))}
          </View>
        ) : (
          <View style={styles.detailsCard}>
            <Text style={styles.detailNote}>
              {info
                ? 'Device connected but had not been assigned an IP within the retry window.'
                : 'Network details unavailable — the device dropped BLE before an IP was assigned, or the firmware predates the network-info endpoint.'}
            </Text>
          </View>
        )}
      </ScrollView>

      <TouchableOpacity style={styles.dismissButton} onPress={onDone}>
        <Text style={styles.dismissButtonText}>Done</Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Main Screen
// ---------------------------------------------------------------------------
export default function ProvisionScreen() {
  const router = useRouter();
  const [permission, setPermission] = useState<BlePermissionResult | null>(null);
  const [result, setResult] = useState<ProvisioningResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    requestBluetoothPermissions().then((result) => {
      if (!cancelled) setPermission(result);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const goBack = () => router.back();

  if (!permission) {
    return (
      <View style={styles.unavailable}>
        <Text style={styles.unavailableMessage}>
          Checking Bluetooth availability...
        </Text>
      </View>
    );
  }

  if (!permission.granted) {
    const message =
      permission.reason === 'never_ask_again'
        ? 'Bluetooth permission was permanently denied. Enable it in Settings to continue.'
        : 'Bluetooth permission is required to scan for and connect to your device.';
    return <BleUnavailableScreen message={message} onDismiss={goBack} />;
  }

  if (result) {
    return <ProvisioningResultScreen result={result} onDone={goBack} />;
  }

  return (
    <View style={styles.container}>
      <ProvisioningErrorBoundary onDismiss={goBack}>
        <ProvisioningNavigator
          config={{
            ble: {
              deviceNamePrefix: 'PROV_',
              // Default is 10000ms. The native SDK's searchESPDevices()
              // typically needs 5-8s on iOS to find a device; anything
              // under ~5s often returns empty even with a device present.
              scanTimeoutMs: 10000,
              security: 1,
              // The library has no implicit PoP. This is the firmware repo's
              // examples/with_ble value; with promptForAuth it pre-fills the
              // auth screen. Set '' for a device whose firmware runs Security 1
              // with no PoP; leave unset to force the user to type one.
              proofOfPossession: 'abcd1234',
              promptForAuth: true,
            },
          }}
          onComplete={(completed) => {
            console.log('Provisioning complete:', completed);
            // Swap the navigator for our own result screen so the device's
            // assigned IP/network details (completed.networkInfo) are shown.
            setResult(completed);
          }}
          onDismiss={goBack}
        />
      </ProvisioningErrorBoundary>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  unavailable: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 32,
    backgroundColor: '#fff',
  },
  unavailableIcon: {
    fontSize: 48,
    marginBottom: 16,
  },
  unavailableTitle: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 12,
    textAlign: 'center',
  },
  unavailableMessage: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    lineHeight: 24,
    marginBottom: 32,
  },
  dismissButton: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 14,
    borderRadius: 12,
  },
  dismissButtonText: {
    color: '#fff',
    fontSize: 17,
    fontWeight: '600',
  },
  // ---- Provisioning result screen ----
  resultContainer: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
  },
  resultContent: {
    paddingTop: 24,
    paddingBottom: 24,
  },
  resultIcon: {
    fontSize: 56,
    textAlign: 'center',
    marginBottom: 12,
  },
  resultTitle: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 24,
  },
  sectionHeading: {
    fontSize: 13,
    fontWeight: '700',
    color: '#888',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginTop: 24,
    marginBottom: 4,
    marginLeft: 4,
  },
  sectionSubtitle: {
    fontSize: 13,
    color: '#999',
    marginBottom: 12,
    marginLeft: 4,
  },
  detailsCard: {
    backgroundColor: '#f7f7f9',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 4,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#e2e2e6',
  },
  detailLabel: {
    fontSize: 15,
    color: '#666',
    marginRight: 16,
  },
  detailValue: {
    fontSize: 15,
    fontWeight: '600',
    color: '#111',
    flexShrink: 1,
    textAlign: 'right',
  },
  detailNote: {
    fontSize: 14,
    color: '#888',
    paddingVertical: 12,
    lineHeight: 20,
  },
});
