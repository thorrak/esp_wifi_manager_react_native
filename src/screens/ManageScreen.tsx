/**
 * ManageScreen — post-success "device tools" screen.
 *
 * In v2 this is intentionally minimal: ESP-IDF Network Provisioning over
 * BLE only exposes a small set of custom protocomm endpoints
 * (version / capabilities / vars / network-policy). Saved-network
 * management, AP control, and factory reset all relied on the deleted
 * custom 0xFFE0 service — those operations are now performed over the
 * device's HTTP API once it's on the network, not over BLE.
 *
 * What we DO keep on BLE is the device-variable editor, since the
 * `esp-wifi-config-vars` endpoint is the canonical way to push
 * application-specific config alongside the WiFi credentials.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { useDeviceVariables } from '../hooks/useDeviceVariables';
import { useDeviceProtocol } from '../hooks/useDeviceProtocol';
import { ErrorBanner } from '../components/ErrorBanner';
import { LoadingSpinner } from '../components/LoadingSpinner';

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

export interface ManageScreenProps {
  theme?: ProvisioningTheme;
}

// ---------------------------------------------------------------------------
// Device Info section
// ---------------------------------------------------------------------------

function DeviceInfoSection({
  colors,
  borderRadius,
  theme,
}: {
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
  theme?: ProvisioningTheme;
}) {
  const { getVersion, getCapabilities, loading, error } = useDeviceProtocol();
  const [version, setVersion] = useState<Record<string, unknown> | null>(null);
  const [capabilities, setCapabilities] = useState<string[] | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [v, c] = await Promise.all([getVersion(), getCapabilities()]);
        setVersion(v as Record<string, unknown>);
        setCapabilities(c.capabilities ?? []);
      } catch {
        /* surfaced via hook error */
      }
    })();
    // Run once on mount; the hook's protocol singleton is stable.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>Device Info</Text>

      {error && <ErrorBanner message={error} theme={theme} />}

      {loading && !version ? (
        <LoadingSpinner message="Loading…" theme={theme} size="small" />
      ) : (
        <View
          style={[
            styles.detailCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius,
            },
          ]}
        >
          {version
            ? Object.entries(version).map(([k, v], i) => (
                <View
                  key={k}
                  style={[
                    styles.detailRow,
                    i > 0 && { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
                  ]}
                >
                  <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>{k}</Text>
                  <Text style={[styles.detailValue, { color: colors.text }]} numberOfLines={2}>
                    {String(v)}
                  </Text>
                </View>
              ))
            : null}

          {capabilities && capabilities.length > 0 ? (
            <View
              style={[
                styles.detailRow,
                { borderTopColor: colors.border, borderTopWidth: StyleSheet.hairlineWidth },
              ]}
            >
              <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>capabilities</Text>
              <Text style={[styles.detailValue, { color: colors.text }]}>
                {capabilities.join(', ')}
              </Text>
            </View>
          ) : null}
        </View>
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Device Variables section
// ---------------------------------------------------------------------------

function DeviceVariablesSection({
  colors,
  borderRadius,
  theme,
}: {
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
  theme?: ProvisioningTheme;
}) {
  const { getVariable, setVariable, error } = useDeviceVariables();
  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [result, setResult] = useState<string | null>(null);

  const handleGet = async () => {
    if (!key.trim()) return;
    const v = await getVariable(key.trim());
    setResult(v ? `${v.key} = ${v.value}` : 'Variable not found');
  };

  const handleSet = async () => {
    if (!key.trim()) return;
    const ok = await setVariable(key.trim(), value);
    setResult(ok ? 'Variable updated' : 'Failed to set variable');
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Device Variables
      </Text>
      <Text style={[styles.sectionHelp, { color: colors.textSecondary }]}>
        Read or write application config keys exposed by the firmware via the
        `esp-wifi-config-vars` protocomm endpoint.
      </Text>

      {error && <ErrorBanner message={error} theme={theme} />}

      <View
        style={[
          styles.detailCard,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            borderRadius,
          },
        ]}
      >
        <Text style={[styles.varInputLabel, { color: colors.textSecondary }]}>
          Key
        </Text>
        <TextInput
          style={[
            styles.varInput,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              borderRadius: borderRadius / 2,
              color: colors.text,
            },
          ]}
          value={key}
          onChangeText={setKey}
          placeholder="Enter key name"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />

        <Text
          style={[
            styles.varInputLabel,
            { color: colors.textSecondary, marginTop: 12 },
          ]}
        >
          Value
        </Text>
        <TextInput
          style={[
            styles.varInput,
            {
              borderColor: colors.border,
              backgroundColor: colors.background,
              borderRadius: borderRadius / 2,
              color: colors.text,
            },
          ]}
          value={value}
          onChangeText={setValue}
          placeholder="Enter value"
          placeholderTextColor={colors.textSecondary}
          autoCapitalize="none"
          autoCorrect={false}
        />

        {result && (
          <Text style={[styles.varResult, { color: colors.text }]}>
            {result}
          </Text>
        )}

        <View style={styles.buttonRow}>
          <TouchableOpacity
            style={[
              styles.halfButton,
              { backgroundColor: colors.primary, borderRadius },
            ]}
            onPress={handleGet}
            activeOpacity={0.7}
          >
            <Text style={[styles.halfButtonText, { color: colors.primaryText }]}>
              Get
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[
              styles.halfButton,
              { backgroundColor: colors.primary, borderRadius, marginLeft: 10 },
            ]}
            onPress={handleSet}
            activeOpacity={0.7}
          >
            <Text style={[styles.halfButtonText, { color: colors.primaryText }]}>
              Set
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ManageScreen
// ---------------------------------------------------------------------------

export function ManageScreen({ theme }: ManageScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const { cancel, error } = useProvisioning();

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ErrorBanner message={error?.message ?? null} theme={theme} />

        <DeviceInfoSection colors={c} borderRadius={borderRadius} theme={theme} />
        <DeviceVariablesSection
          colors={c}
          borderRadius={borderRadius}
          theme={theme}
        />

        <Text style={[styles.footnote, { color: c.textSecondary }]}>
          Saved-network management, SoftAP control, and factory reset moved to
          the device's HTTP API in firmware 0.1.0. Connect to the device over
          Wi-Fi and use the REST endpoints there for those operations.
        </Text>

        <TouchableOpacity
          style={[styles.backButton, { borderRadius }]}
          onPress={() => void cancel()}
          activeOpacity={0.8}
        >
          <Text style={[styles.backButtonText, { color: c.textSecondary }]}>
            Done
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1 },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 6,
  },
  sectionHelp: {
    fontSize: 13,
    marginBottom: 12,
    lineHeight: 18,
  },
  detailCard: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 12,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 8,
  },
  detailLabel: {
    fontSize: 14,
    fontWeight: '500',
    flex: 1,
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
    flex: 2,
    textAlign: 'right',
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 12,
  },
  halfButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  halfButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 8,
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
  varInputLabel: {
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  varInput: {
    borderWidth: 1,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 15,
  },
  varResult: {
    fontSize: 14,
    fontFamily: 'monospace',
    paddingVertical: 10,
  },
  footnote: {
    fontSize: 13,
    lineHeight: 19,
    marginTop: 4,
    marginBottom: 24,
  },
});
