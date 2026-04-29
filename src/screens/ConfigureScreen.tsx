/**
 * ConfigureScreen — default rendering for the `configuring` step.
 *
 * Only visible when the consumer has supplied a `flow.onConnected`
 * callback (otherwise the step transitions instantly). Renders a generic
 * "Setting up…" indicator while the callback runs, plus an error pane if
 * the callback throws.
 *
 * Apps that want custom mid-flow UI (e.g. a hostname/mDNS form) should
 * skip this screen entirely and render their own component on
 * `step === 'configuring'`, calling `proceedFromConfigure()` when done.
 */

import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';

import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSpinner } from '../components/LoadingSpinner';
import { useProvisioning } from '../hooks/useProvisioning';
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

export interface ConfigureScreenProps {
  theme?: ProvisioningTheme;
}

export function ConfigureScreen({ theme }: ConfigureScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const { device, error, proceedFromConfigure, pickDifferentDevice } =
    useProvisioning();

  const failed = error?.source === 'flow';

  if (failed) {
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <ErrorBanner message={error.message} theme={theme} />
        <View style={styles.center}>
          <Text style={[styles.title, { color: c.text }]}>Setup failed</Text>
          <Text style={[styles.body, { color: c.textSecondary }]}>
            {error.message}
          </Text>
          <TouchableOpacity
            style={[
              styles.primaryButton,
              { backgroundColor: c.primary, borderRadius },
            ]}
            onPress={() => void proceedFromConfigure()}
            activeOpacity={0.8}
          >
            <Text style={[styles.primaryButtonText, { color: c.primaryText }]}>
              Skip and continue
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.outlineButton,
              { borderColor: c.primary, borderRadius },
            ]}
            onPress={() => void pickDifferentDevice()}
            activeOpacity={0.8}
          >
            <Text style={[styles.outlineButtonText, { color: c.primary }]}>
              Pick a different device
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <View style={styles.center}>
        <LoadingSpinner
          message={
            device?.status === 'connected'
              ? `Setting up ${device.name}…`
              : 'Setting up device…'
          }
          theme={theme}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
    textAlign: 'center',
  },
  body: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
    textAlign: 'center',
  },
  primaryButton: {
    width: '100%',
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
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
