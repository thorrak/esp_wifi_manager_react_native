import { useEffect, useState, Component, type ReactNode } from 'react';
import {
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
// Main Screen
// ---------------------------------------------------------------------------
export default function ProvisionScreen() {
  const router = useRouter();
  const [permission, setPermission] = useState<BlePermissionResult | null>(null);

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
              promptForAuth: true,
            },
          }}
          onComplete={(result) => {
            console.log('Provisioning complete:', result);
            goBack();
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
});
