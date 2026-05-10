/* react-jsx transform */
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';

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

export interface SuccessScreenProps {
  theme?: ProvisioningTheme;
  onComplete?: () => void;
}

export function SuccessScreen({ theme, onComplete }: SuccessScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    lastResult,
    lastProvisionResult,
    device,
    goToManage,
    cancel,
  } = useProvisioning();

  // The SDK's provision() doesn't return the device IP — we surface the
  // SSID and the SDK status string ("success", typically) instead. Apps
  // that need the IP can fetch it over Wi-Fi after provisioning lands.
  const ssid = lastResult?.ssid || lastProvisionResult?.ssid;
  const status = lastProvisionResult?.status ?? lastResult?.provisionStatus;
  const deviceName = lastResult?.deviceName ?? device?.name;

  const handleDone = () => {
    if (onComplete) onComplete();
    void cancel();
  };

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.content}>
        <View
          style={[
            styles.iconCircle,
            { backgroundColor: c.success + '15' },
          ]}
        >
          <Text style={[styles.checkmark, { color: c.success }]}>
            {'\u2713'}
          </Text>
        </View>

        <Text style={[styles.title, { color: c.text }]}>Connected!</Text>

        <View
          style={[
            styles.detailsCard,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              borderRadius,
            },
          ]}
        >
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: c.textSecondary }]}>
              Status
            </Text>
            <Text style={[styles.detailValue, { color: c.success }]}>
              {status ?? 'Provisioned'}
            </Text>
          </View>

          <View style={[styles.divider, { backgroundColor: c.border }]} />

          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: c.textSecondary }]}>
              Network
            </Text>
            <Text style={[styles.detailValue, { color: c.text }]}>
              {ssid}
            </Text>
          </View>

          {deviceName ? (
            <>
              <View style={[styles.divider, { backgroundColor: c.border }]} />
              <View style={styles.detailRow}>
                <Text
                  style={[styles.detailLabel, { color: c.textSecondary }]}
                >
                  Device
                </Text>
                <Text style={[styles.detailValue, { color: c.text }]}>
                  {deviceName}
                </Text>
              </View>
            </>
          ) : null}
        </View>

        <TouchableOpacity
          style={[
            styles.primaryButton,
            { backgroundColor: c.primary, borderRadius },
          ]}
          onPress={handleDone}
          activeOpacity={0.8}
        >
          <Text style={[styles.primaryButtonText, { color: c.primaryText }]}>
            Done
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.outlineButton,
            { borderColor: c.primary, borderRadius },
          ]}
          onPress={goToManage}
          activeOpacity={0.8}
        >
          <Text style={[styles.outlineButtonText, { color: c.primary }]}>
            Manage Device
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  content: {
    alignItems: 'center',
  },
  iconCircle: {
    width: 96,
    height: 96,
    borderRadius: 48,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  checkmark: {
    fontSize: 48,
    fontWeight: '700',
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 24,
  },
  detailsCard: {
    width: '100%',
    borderWidth: 1,
    padding: 16,
    marginBottom: 32,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  primaryButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  outlineButton: {
    width: '100%',
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
  },
  outlineButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
