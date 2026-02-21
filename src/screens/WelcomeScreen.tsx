/* react-jsx transform */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { useDeviceScanner } from '../hooks/useDeviceScanner';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSpinner } from '../components/LoadingSpinner';

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

export interface WelcomeScreenProps {
  theme?: ProvisioningTheme;
}

export function WelcomeScreen({ theme }: WelcomeScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const { scanForDevices, provisioningError } = useProvisioning();
  const { scanning, bleError } = useDeviceScanner();

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <View
            style={[
              styles.iconCircle,
              { backgroundColor: c.primary + '15' },
            ]}
          >
            <Text style={[styles.iconText, { color: c.primary }]}>W</Text>
          </View>
        </View>

        <Text style={[styles.title, { color: c.text }]}>WiFi Setup</Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          Connect to your ESP32 device to configure WiFi
        </Text>

        <ErrorBanner message={provisioningError ?? bleError} theme={theme} />

        {scanning ? (
          <LoadingSpinner message="Searching for devices..." theme={theme} />
        ) : (
          <TouchableOpacity
            style={[
              styles.button,
              { backgroundColor: c.primary, borderRadius },
            ]}
            onPress={scanForDevices}
            activeOpacity={0.8}
          >
            <Text style={[styles.buttonText, { color: c.primaryText }]}>
              Find Devices
            </Text>
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  content: {
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 32,
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: {
    fontSize: 40,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    lineHeight: 24,
    textAlign: 'center',
    marginBottom: 32,
  },
  button: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  buttonText: {
    fontSize: 17,
    fontWeight: '600',
  },
});
