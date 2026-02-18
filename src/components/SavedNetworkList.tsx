import { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet } from 'react-native';
import type { ProvisioningTheme, SavedNetwork } from '../types';
import { LoadingSpinner } from './LoadingSpinner';
import { SavedNetworkItem } from './SavedNetworkItem';
import { ConfirmDialog } from './ConfirmDialog';

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

export interface SavedNetworkListProps {
  networks: SavedNetwork[];
  loading: boolean;
  onDeleteNetwork: (ssid: string) => void;
  theme?: ProvisioningTheme;
}

export function SavedNetworkList({
  networks,
  loading,
  onDeleteNetwork,
  theme,
}: SavedNetworkListProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  const [showConfirm, setShowConfirm] = useState(false);
  const [networkToDelete, setNetworkToDelete] = useState<SavedNetwork | null>(
    null,
  );

  const handleDeletePress = useCallback((network: SavedNetwork) => {
    setNetworkToDelete(network);
    setShowConfirm(true);
  }, []);

  const handleConfirmDelete = useCallback(() => {
    if (networkToDelete) {
      onDeleteNetwork(networkToDelete.ssid);
    }
    setShowConfirm(false);
    setNetworkToDelete(null);
  }, [networkToDelete, onDeleteNetwork]);

  const handleCancelDelete = useCallback(() => {
    setShowConfirm(false);
    setNetworkToDelete(null);
  }, []);

  if (loading) {
    return <LoadingSpinner message="Loading saved networks..." theme={theme} />;
  }

  if (networks.length === 0) {
    return (
      <View style={styles.emptyContainer}>
        <Text style={[styles.emptyText, { color: c.textSecondary }]}>
          No saved networks
        </Text>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={networks}
        keyExtractor={(item) => item.ssid}
        renderItem={({ item }) => (
          <SavedNetworkItem
            network={item}
            onDelete={() => handleDeletePress(item)}
            theme={theme}
          />
        )}
        showsVerticalScrollIndicator={false}
      />
      <ConfirmDialog
        visible={showConfirm}
        title="Delete Network"
        message={`Remove "${networkToDelete?.ssid ?? ''}" from saved networks?`}
        confirmLabel="Delete"
        cancelLabel="Cancel"
        destructive
        onConfirm={handleConfirmDelete}
        onCancel={handleCancelDelete}
        theme={theme}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 32,
  },
  emptyText: {
    fontSize: 14,
    lineHeight: 20,
  },
});
