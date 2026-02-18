import { View, Text, FlatList, StyleSheet } from 'react-native';
import type { ProvisioningTheme, ScannedNetwork } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { NetworkListItem } from './NetworkListItem';

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

export interface NetworkListProps {
  networks: ScannedNetwork[];
  loading: boolean;
  onSelectNetwork: (network: ScannedNetwork) => void;
  theme?: ProvisioningTheme;
}

export function NetworkList({
  networks,
  loading,
  onSelectNetwork,
  theme,
}: NetworkListProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  if (loading) {
    return <LoadingSpinner message="Scanning for networks..." theme={theme} />;
  }

  if (networks.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: c.textSecondary }]}>
          No networks found
        </Text>
      </View>
    );
  }

  return (
    <FlatList
      data={networks}
      keyExtractor={(item, index) => `${item.ssid}-${item.rssi}-${index}`}
      renderItem={({ item }) => (
        <NetworkListItem
          network={item}
          onPress={() => onSelectNetwork(item)}
          theme={theme}
        />
      )}
      style={styles.list}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={false}
    />
  );
}

const styles = StyleSheet.create({
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingVertical: 4,
  },
});
