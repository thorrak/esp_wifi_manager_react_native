import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme, ScannedNetwork } from '../types';
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

export interface NetworkListItemProps {
  network: ScannedNetwork;
  onPress: () => void;
  theme?: ProvisioningTheme;
}

export function NetworkListItem({
  network,
  onPress,
  theme,
}: NetworkListItemProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;

  const isOpen = network.auth === 'OPEN';
  const displayName = network.ssid || 'Hidden Network';

  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.7}
      style={[
        styles.container,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderRadius,
        },
      ]}
    >
      <View style={styles.leftSection}>
        <Text
          style={[
            styles.ssid,
            { color: network.ssid ? c.text : c.textSecondary },
            !network.ssid && styles.ssidItalic,
          ]}
          numberOfLines={1}
        >
          {displayName}
        </Text>
        <View style={styles.badges}>
          <View
            style={[
              styles.authBadge,
              { backgroundColor: c.background, borderColor: c.border },
            ]}
          >
            <Text style={[styles.authText, { color: c.textSecondary }]}>
              {network.auth}
            </Text>
          </View>
        </View>
      </View>
      <View style={styles.rightSection}>
        {!isOpen && (
          <Text style={[styles.lockIcon, { color: c.textSecondary }]}>
            {'\u{1F512}'}
          </Text>
        )}
        <SignalIcon rssi={network.rssi} size={18} theme={theme} />
      </View>
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
  leftSection: {
    flex: 1,
    marginRight: 12,
  },
  ssid: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  ssidItalic: {
    fontStyle: 'italic',
  },
  badges: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  authBadge: {
    borderWidth: 1,
    borderRadius: 4,
    paddingHorizontal: 6,
    paddingVertical: 2,
  },
  authText: {
    fontSize: 11,
    fontWeight: '500',
  },
  rightSection: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  lockIcon: {
    fontSize: 14,
    marginRight: 8,
  },
});
