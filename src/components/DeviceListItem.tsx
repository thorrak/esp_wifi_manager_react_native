import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme, DiscoveredDevice } from '../types';
import { SignalIcon } from './SignalIcon';

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

export interface DeviceListItemProps {
  device: DiscoveredDevice;
  onPress: () => void;
  theme?: ProvisioningTheme;
}

function truncateId(id: string, maxLength = 16): string {
  if (id.length <= maxLength) return id;
  return id.slice(0, maxLength) + '...';
}

export function DeviceListItem({
  device,
  onPress,
  theme,
}: DeviceListItemProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.container,
        { backgroundColor: c.card, borderColor: c.border, borderRadius },
      ]}
    >
      <View style={styles.info}>
        <Text style={[styles.name, { color: c.text }]} numberOfLines={1}>
          {device.name || 'Unknown Device'}
        </Text>
        <Text style={[styles.id, { color: c.textSecondary }]} numberOfLines={1}>
          {truncateId(device.id)}
        </Text>
      </View>
      <SignalIcon rssi={device.rssi} size={18} theme={theme} />
    </TouchableOpacity>
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
    marginRight: 12,
  },
  name: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 2,
  },
  id: {
    fontSize: 12,
  },
});
