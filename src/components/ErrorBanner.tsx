import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
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

export interface ErrorBannerProps {
  message: string | null;
  onDismiss?: () => void;
  theme?: ProvisioningTheme;
}

export function ErrorBanner({ message, onDismiss, theme }: ErrorBannerProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;

  if (!message) {
    return null;
  }

  return (
    <View
      style={[
        styles.container,
        {
          backgroundColor: c.card,
          borderColor: c.border,
          borderLeftColor: c.error,
          borderRadius,
        },
      ]}
    >
      <Text style={[styles.icon, { color: c.error }]}>!</Text>
      <Text style={[styles.message, { color: c.text }]} numberOfLines={3}>
        {message}
      </Text>
      {onDismiss && (
        <TouchableOpacity
          onPress={onDismiss}
          style={styles.dismissButton}
          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
        >
          <Text style={[styles.dismissText, { color: c.textSecondary }]}>
            X
          </Text>
        </TouchableOpacity>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderLeftWidth: 4,
    paddingVertical: 12,
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  icon: {
    fontSize: 16,
    fontWeight: '700',
    width: 24,
    height: 24,
    borderRadius: 12,
    borderWidth: 2,
    textAlign: 'center',
    lineHeight: 20,
    marginRight: 10,
    overflow: 'hidden',
  },
  message: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
  },
  dismissButton: {
    marginLeft: 8,
    padding: 4,
  },
  dismissText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
