import { View, Text, ActivityIndicator, StyleSheet } from 'react-native';
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

export interface LoadingSpinnerProps {
  message?: string;
  theme?: ProvisioningTheme;
  size?: 'small' | 'large';
}

export function LoadingSpinner({
  message,
  theme,
  size = 'large',
}: LoadingSpinnerProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  return (
    <View style={styles.container}>
      <ActivityIndicator size={size} color={c.primary} />
      {message ? (
        <Text style={[styles.message, { color: c.textSecondary }]}>
          {message}
        </Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 24,
  },
  message: {
    marginTop: 12,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
});
