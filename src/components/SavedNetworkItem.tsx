import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme, SavedNetwork } from '../types';

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

export interface SavedNetworkItemProps {
  network: SavedNetwork;
  onDelete: () => void;
  theme?: ProvisioningTheme;
}

export function SavedNetworkItem({
  network,
  onDelete,
  theme,
}: SavedNetworkItemProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;

  return (
    <View
      style={[
        styles.container,
        { backgroundColor: c.card, borderColor: c.border, borderRadius },
      ]}
    >
      <View style={styles.info}>
        <Text style={[styles.ssid, { color: c.text }]} numberOfLines={1}>
          {network.ssid}
        </Text>
        <View
          style={[
            styles.priorityBadge,
            { backgroundColor: c.background, borderColor: c.border },
          ]}
        >
          <Text style={[styles.priorityText, { color: c.textSecondary }]}>
            Priority: {network.priority}
          </Text>
        </View>
      </View>
      <TouchableOpacity
        onPress={onDelete}
        style={styles.deleteButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.deleteText, { color: c.error }]}>X</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderWidth: 1,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 8,
  },
  info: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 12,
  },
  ssid: {
    fontSize: 15,
    fontWeight: '500',
    marginRight: 8,
    flexShrink: 1,
  },
  priorityBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  priorityText: {
    fontSize: 11,
    fontWeight: '500',
  },
  deleteButton: {
    padding: 4,
  },
  deleteText: {
    fontSize: 16,
    fontWeight: '700',
  },
});
