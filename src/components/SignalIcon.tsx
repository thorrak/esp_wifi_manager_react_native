import { View, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';

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

export interface SignalIconProps {
  rssi: number;
  size?: number;
  theme?: ProvisioningTheme;
}

function getSignalLevel(rssi: number): number {
  if (rssi >= -50) return 4;
  if (rssi >= -60) return 3;
  if (rssi >= -70) return 2;
  if (rssi >= -80) return 1;
  return 0;
}

export function SignalIcon({ rssi, size = 20, theme }: SignalIconProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const level = getSignalLevel(rssi);

  const barWidth = Math.round(size / 5);
  const gap = Math.round(size / 10);

  return (
    <View style={[styles.container, { height: size, width: size }]}>
      {[1, 2, 3, 4].map((bar) => {
        const barHeight = Math.round((bar / 4) * size);
        const active = bar <= level;
        return (
          <View
            key={bar}
            style={[
              styles.bar,
              {
                width: barWidth,
                height: barHeight,
                backgroundColor: active ? c.primary : c.border,
                marginLeft: bar === 1 ? 0 : gap,
                borderRadius: barWidth / 2,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  bar: {},
});
