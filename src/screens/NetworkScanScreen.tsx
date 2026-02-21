/* react-jsx transform */
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
} from 'react-native';
import type { ProvisioningTheme, ScannedNetwork } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { SignalIcon } from '../components/SignalIcon';

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

export interface NetworkScanScreenProps {
  theme?: ProvisioningTheme;
}

function NetworkListItemInline({
  network,
  onPress,
  colors,
  borderRadius,
  theme,
}: {
  network: ScannedNetwork;
  onPress: () => void;
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
  theme?: ProvisioningTheme;
}) {
  const isOpen = network.auth === 'OPEN';

  return (
    <TouchableOpacity
      style={[
        styles.networkItem,
        {
          backgroundColor: colors.card,
          borderColor: colors.border,
          borderRadius,
        },
      ]}
      onPress={onPress}
      activeOpacity={0.7}
    >
      <SignalIcon rssi={network.rssi} size={22} theme={theme} />
      <View style={styles.networkInfo}>
        <Text style={[styles.networkSsid, { color: colors.text }]}>
          {network.ssid}
        </Text>
        <Text style={[styles.networkAuth, { color: colors.textSecondary }]}>
          {isOpen ? 'Open' : network.auth}
        </Text>
      </View>
      {!isOpen && (
        <Text style={[styles.lockIcon, { color: colors.textSecondary }]}>
          L
        </Text>
      )}
    </TouchableOpacity>
  );
}

export function NetworkScanScreen({ theme }: NetworkScanScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    scannedNetworks,
    scanWifiNetworks,
    selectNetwork,
    provisioningError,
    busy,
  } = useProvisioning();

  const renderNetwork = ({ item }: { item: ScannedNetwork }) => (
    <NetworkListItemInline
      network={item}
      onPress={() => selectNetwork(item)}
      colors={c}
      borderRadius={borderRadius}
      theme={theme}
    />
  );

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ErrorBanner message={provisioningError} theme={theme} />

      {busy ? (
        <LoadingSpinner message="Scanning for networks..." theme={theme} />
      ) : (
        <>
          <FlatList
            data={scannedNetworks}
            keyExtractor={(item, idx) => `${item.ssid}-${idx}`}
            renderItem={renderNetwork}
            contentContainerStyle={styles.listContent}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={[styles.emptyText, { color: c.textSecondary }]}>
                  No WiFi networks found. Try scanning again.
                </Text>
              </View>
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
              onPress={scanWifiNetworks}
              activeOpacity={0.8}
            >
              <Text
                style={[
                  styles.scanButtonText,
                  { color: c.primary },
                ]}
              >
                Scan Again
              </Text>
            </TouchableOpacity>
          </View>
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  listContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 8,
  },
  networkItem: {
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
  networkInfo: {
    flex: 1,
    marginLeft: 12,
  },
  networkSsid: {
    fontSize: 16,
    fontWeight: '600',
    marginBottom: 2,
  },
  networkAuth: {
    fontSize: 13,
  },
  lockIcon: {
    fontSize: 16,
    fontWeight: '700',
    marginLeft: 8,
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
    paddingTop: 16,
    paddingBottom: 68,
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
