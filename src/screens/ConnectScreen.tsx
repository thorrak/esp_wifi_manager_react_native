/* react-jsx transform */
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { ProvisioningTheme, DiscoveredDevice } from '../types';
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

export interface ConnectScreenProps {
  theme?: ProvisioningTheme;
}

function DeviceListItemInline({
  device,
  onPress,
  colors,
  borderRadius,
}: {
  device: DiscoveredDevice;
  onPress: () => void;
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
}) {
  return (
    <TouchableOpacity
      style={[
        styles.deviceItem,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <View style={styles.deviceInfo}>
        <Text style={[styles.deviceName, { color: colors.text }]}>
          {device.name || 'Unknown Device'}
        </Text>
        <Text style={[styles.deviceId, { color: colors.textSecondary }]}>
          {device.id}
        </Text>
      </View>
      <Text style={[styles.deviceRssi, { color: colors.textSecondary }]}>
        {device.rssi} dBm
      </Text>
    </TouchableOpacity>
  );
}

export function ConnectScreen({ theme }: ConnectScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    connectToDevice,
    connectionState,
    deviceName,
    provisioningError,
  } = useProvisioning();
  const { discoveredDevices, scanning, startScan } = useDeviceScanner();

  // Full-screen connecting overlay
  if (connectionState === 'connecting') {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <LoadingSpinner
          message={`Connecting to ${deviceName || 'device'}...`}
          theme={theme}
        />
      </View>
    );
  }

  const renderDevice = ({ item }: { item: DiscoveredDevice }) => (
    <DeviceListItemInline
      device={item}
      onPress={() => connectToDevice(item.id)}
      colors={c}
      borderRadius={borderRadius}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ErrorBanner message={provisioningError} theme={theme} />

      {scanning && (
        <View style={styles.scanningHeader}>
          <LoadingSpinner
            message="Searching for devices..."
            theme={theme}
            size="small"
          />
        </View>
      )}

      <FlatList
        data={discoveredDevices}
        keyExtractor={(item) => item.id}
        renderItem={renderDevice}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          !scanning ? (
            <View style={styles.emptyContainer}>
              <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                No devices found. Make sure your ESP32 is powered on and in
                range.
              </Text>
            </View>
          ) : null
        }
      />

      <View style={styles.footer}>
        <TouchableOpacity
          style={[
            styles.scanButton,
            {
              borderColor: c.primary,
              borderRadius,
            },
          ]}
          onPress={startScan}
          disabled={scanning}
          activeOpacity={0.8}
        >
          <Text
            style={[
              styles.scanButtonText,
              {
                color: scanning ? c.textSecondary : c.primary,
              },
            ]}
          >
            Scan Again
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scanningHeader: {
    paddingTop: 8,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  deviceItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  deviceInfo: {
    flex: 1,
  },
  deviceName: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  deviceId: {
    fontSize: 12,
    fontFamily: 'monospace',
  },
  deviceRssi: {
    fontSize: 13,
    marginLeft: 12,
  },
  emptyContainer: {
    paddingVertical: 48,
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  emptyText: {
    fontSize: 15,
    lineHeight: 22,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: 16,
    paddingVertical: 16,
  },
  scanButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
  },
  scanButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
