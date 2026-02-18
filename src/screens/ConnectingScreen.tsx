/* react-jsx transform */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { StatusBadge } from '../components/StatusBadge';

const DEFAULT_COLORS = {
  primary: '#2563EB',
  primaryText: '#FFFFFF',
  background: '#F8FAFC',
  card: '#FFFFFF',
  text: '#1E293B',
  textSecondary: '#64748B',
  border: '#E2E8F0',
  error: '#EF4444',
  success: '#22C55E',
  warning: '#F59E0B',
};

export interface ConnectingScreenProps {
  theme?: ProvisioningTheme;
}

export function ConnectingScreen({ theme }: ConnectingScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    wifiSsid,
    wifiState,
    selectedNetwork,
    connectionFailed,
    pollError,
    provisioningError,
    retryConnection,
    deleteNetworkAndReturn,
    reset,
  } = useProvisioning();

  const targetSsid = wifiSsid || selectedNetwork?.ssid || '';

  // Sub-state: Connection failed
  if (connectionFailed) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ErrorBanner message={provisioningError} theme={theme} />
        <View style={styles.centerContent}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: c.error + '15' },
            ]}
          >
            <Text style={[styles.iconText, { color: c.error }]}>!</Text>
          </View>

          <Text style={[styles.title, { color: c.text }]}>
            Connection Failed
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            Could not connect to "{targetSsid}". Please check the password and
            try again.
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: c.primary, borderRadius },
            ]}
            onPress={retryConnection}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: c.primaryText }]}>
              Retry
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.outlineButton,
              { borderColor: c.primary, borderRadius },
            ]}
            onPress={deleteNetworkAndReturn}
            activeOpacity={0.8}
          >
            <Text style={[styles.outlineButtonText, { color: c.primary }]}>
              Choose Another Network
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.textButton, { borderRadius }]}
            onPress={reset}
            activeOpacity={0.8}
          >
            <Text style={[styles.textButtonText, { color: c.textSecondary }]}>
              Leave
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Sub-state: Poll error / timed out
  if (pollError) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ErrorBanner message={provisioningError} theme={theme} />
        <View style={styles.centerContent}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: c.warning + '15' },
            ]}
          >
            <Text style={[styles.iconText, { color: c.warning }]}>?</Text>
          </View>

          <Text style={[styles.title, { color: c.text }]}>
            Connection Timed Out
          </Text>
          <Text style={[styles.subtitle, { color: c.textSecondary }]}>
            {pollError}
          </Text>

          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: c.primary, borderRadius },
            ]}
            onPress={retryConnection}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: c.primaryText }]}>
              Retry
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.textButton, { borderRadius }]}
            onPress={reset}
            activeOpacity={0.8}
          >
            <Text style={[styles.textButtonText, { color: c.textSecondary }]}>
              Back
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Sub-state: Polling / connecting
  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ErrorBanner message={provisioningError} theme={theme} />
      <View style={styles.centerContent}>
        <LoadingSpinner
          message={`Connecting to ${targetSsid}...`}
          theme={theme}
        />
        <View style={styles.statusRow}>
          <StatusBadge state={wifiState} theme={theme} />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  iconCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  iconText: {
    fontSize: 36,
    fontWeight: '700',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
    marginBottom: 32,
  },
  statusRow: {
    marginTop: 16,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  outlineButton: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
    marginBottom: 12,
  },
  outlineButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  textButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  textButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
