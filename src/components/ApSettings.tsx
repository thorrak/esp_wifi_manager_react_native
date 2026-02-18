import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useAccessPoint } from '../hooks/useAccessPoint';
import { ErrorBanner } from './ErrorBanner';
import { LoadingSpinner } from './LoadingSpinner';

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

export interface ApSettingsProps {
  theme?: ProvisioningTheme;
}

export function ApSettings({ theme }: ApSettingsProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;
  const { apStatus, loading, error, startAp, stopAp } = useAccessPoint();

  if (loading && !apStatus) {
    return <LoadingSpinner message="Loading AP status..." theme={theme} />;
  }

  const isActive = apStatus?.active ?? false;

  return (
    <View style={styles.container}>
      <ErrorBanner message={error} theme={theme} />

      <View
        style={[
          styles.statusCard,
          { backgroundColor: c.card, borderColor: c.border, borderRadius },
        ]}
      >
        <View style={styles.statusRow}>
          <Text style={[styles.label, { color: c.textSecondary }]}>
            Status
          </Text>
          <View style={styles.statusIndicator}>
            <View
              style={[
                styles.statusDot,
                {
                  backgroundColor: isActive ? c.success : c.textSecondary,
                },
              ]}
            />
            <Text style={[styles.statusText, { color: c.text }]}>
              {isActive ? 'Active' : 'Inactive'}
            </Text>
          </View>
        </View>

        {isActive && apStatus && (
          <>
            <View style={[styles.divider, { backgroundColor: c.border }]} />
            <View style={styles.detailRow}>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                SSID
              </Text>
              <Text style={[styles.value, { color: c.text }]}>
                {apStatus.ssid}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                IP Address
              </Text>
              <Text style={[styles.value, { color: c.text }]}>
                {apStatus.ip}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={[styles.label, { color: c.textSecondary }]}>
                Clients
              </Text>
              <Text style={[styles.value, { color: c.text }]}>
                {apStatus.sta_count}
              </Text>
            </View>
          </>
        )}
      </View>

      <TouchableOpacity
        onPress={() => (isActive ? stopAp() : startAp())}
        disabled={loading}
        activeOpacity={0.7}
        style={[
          styles.toggleButton,
          {
            backgroundColor: isActive ? c.error : c.primary,
            borderRadius,
            opacity: loading ? 0.6 : 1,
          },
        ]}
      >
        <Text style={[styles.toggleButtonText, { color: c.primaryText }]}>
          {loading ? 'Please wait...' : isActive ? 'Stop AP' : 'Start AP'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  statusCard: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 16,
  },
  statusRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: 14,
    fontWeight: '500',
  },
  divider: {
    height: 1,
    marginVertical: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  label: {
    fontSize: 13,
  },
  value: {
    fontSize: 14,
    fontWeight: '500',
  },
  toggleButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  toggleButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
