import { useEffect, useRef } from 'react';
import { View, Text, Animated, StyleSheet } from 'react-native';
import type { ProvisioningTheme, WifiConnectionState } from '../types';

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

export interface StatusBadgeProps {
  state: WifiConnectionState;
  theme?: ProvisioningTheme;
}

const STATE_LABELS: Record<WifiConnectionState, string> = {
  connected: 'Connected',
  connecting: 'Connecting',
  disconnected: 'Disconnected',
};

export function StatusBadge({ state, theme }: StatusBadgeProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (state === 'connecting') {
      const animation = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 0.3,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ]),
      );
      animation.start();
      return () => animation.stop();
    }
    pulseAnim.setValue(1);
    return undefined;
  }, [state, pulseAnim]);

  let dotColor: string;
  switch (state) {
    case 'connected':
      dotColor = c.success;
      break;
    case 'connecting':
      dotColor = c.warning;
      break;
    case 'disconnected':
    default:
      dotColor = c.textSecondary;
      break;
  }

  return (
    <View style={styles.container}>
      <Animated.View
        style={[
          styles.dot,
          {
            backgroundColor: dotColor,
            opacity: state === 'connecting' ? pulseAnim : 1,
          },
        ]}
      />
      <Text style={[styles.label, { color: c.text }]}>
        {STATE_LABELS[state]}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
  },
});
