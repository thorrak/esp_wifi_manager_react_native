import { useState, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  Modal,
  StyleSheet,
} from 'react-native';
import type { ProvisioningTheme, SavedNetwork } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { useSavedNetworks } from '../hooks/useSavedNetworks';
import { useAccessPoint } from '../hooks/useAccessPoint';
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
// Saved Networks section
// ---------------------------------------------------------------------------

function SavedNetworksSection({
  colors,
  borderRadius,
  theme,
}: {
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
  theme?: ProvisioningTheme;
}) {
  const { networks, loading, error, fetchNetworks, deleteNetwork } =
    useSavedNetworks();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Saved Networks
      </Text>

      {error && <ErrorBanner message={error} theme={theme} />}

      {loading ? (
        <LoadingSpinner
          message="Loading saved networks..."
          theme={theme}
          size="small"
        />
      ) : networks.length === 0 ? (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius,
            },
          ]}
        >
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            No saved networks
          </Text>
        </View>
      ) : (
        networks.map((net: SavedNetwork) => (
          <View
            key={net.ssid}
            style={[
              styles.listItem,
              {
                backgroundColor: colors.card,
                borderColor: colors.border,
                borderRadius,
              },
            ]}
          >
            <View style={styles.listItemContent}>
              <Text style={[styles.listItemTitle, { color: colors.text }]}>
                {net.ssid}
              </Text>
              <Text
                style={[
                  styles.listItemSubtitle,
                  { color: colors.textSecondary },
                ]}
              >
                Priority: {net.priority}
              </Text>
            </View>
            <TouchableOpacity
              onPress={() => deleteNetwork(net.ssid)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.deleteText, { color: colors.error }]}>
                Delete
              </Text>
            </TouchableOpacity>
          </View>
        ))
      )}

      <TouchableOpacity
        style={[
          styles.sectionAction,
          { borderColor: colors.border, borderRadius },
        ]}
        onPress={fetchNetworks}
        disabled={loading}
        activeOpacity={0.7}
      >
        <Text style={[styles.sectionActionText, { color: colors.primary }]}>
          Refresh
        </Text>
      </TouchableOpacity>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Access Point section
// ---------------------------------------------------------------------------

function AccessPointSection({
  colors,
  borderRadius,
  theme,
}: {
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
  theme?: ProvisioningTheme;
}) {
  const { apStatus, loading, error, startAp, stopAp } = useAccessPoint();

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Access Point
      </Text>

      {error && <ErrorBanner message={error} theme={theme} />}

      {loading ? (
        <LoadingSpinner
          message="Loading AP status..."
          theme={theme}
          size="small"
        />
      ) : apStatus ? (
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
          <View style={styles.detailRow}>
            <Text style={[styles.detailLabel, { color: colors.textSecondary }]}>
              Status
            </Text>
            <Text
              style={[
                styles.detailValue,
                {
                  color: apStatus.active ? colors.success : colors.textSecondary,
                },
              ]}
            >
              {apStatus.active ? 'Active' : 'Inactive'}
            </Text>
          </View>
          {apStatus.active && (
            <>
              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />
              <View style={styles.detailRow}>
                <Text
                  style={[
                    styles.detailLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  SSID
                </Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {apStatus.ssid}
                </Text>
              </View>
              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />
              <View style={styles.detailRow}>
                <Text
                  style={[
                    styles.detailLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  IP
                </Text>
                <Text
                  style={[
                    styles.detailValue,
                    { color: colors.text, fontFamily: 'monospace' },
                  ]}
                >
                  {apStatus.ip}
                </Text>
              </View>
              <View
                style={[styles.divider, { backgroundColor: colors.border }]}
              />
              <View style={styles.detailRow}>
                <Text
                  style={[
                    styles.detailLabel,
                    { color: colors.textSecondary },
                  ]}
                >
                  Clients
                </Text>
                <Text style={[styles.detailValue, { color: colors.text }]}>
                  {apStatus.sta_count}
                </Text>
              </View>
            </>
          )}
        </View>
      ) : (
        <View
          style={[
            styles.emptyCard,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              borderRadius,
            },
          ]}
        >
          <Text style={[styles.emptyText, { color: colors.textSecondary }]}>
            AP status unavailable
          </Text>
        </View>
      )}

      <View style={styles.buttonRow}>
        <TouchableOpacity
          style={[
            styles.halfButton,
            {
              backgroundColor: apStatus?.active
                ? colors.border
                : colors.primary,
              borderRadius,
            },
          ]}
          onPress={() => startAp()}
          disabled={loading || apStatus?.active === true}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.halfButtonText,
              {
                color: apStatus?.active
                  ? colors.textSecondary
                  : colors.primaryText,
              },
            ]}
          >
            Start AP
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[
            styles.halfButton,
            {
              backgroundColor:
                !apStatus?.active ? colors.border : colors.error,
              borderRadius,
              marginLeft: 10,
            },
          ]}
          onPress={stopAp}
          disabled={loading || !apStatus?.active}
          activeOpacity={0.7}
        >
          <Text
            style={[
              styles.halfButtonText,
              {
                color: !apStatus?.active
                  ? colors.textSecondary
                  : colors.primaryText,
              },
            ]}
          >
            Stop AP
          </Text>
        </TouchableOpacity>
      </View>
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

  const handleGet = useCallback(async () => {
    if (!key.trim()) return;
    const v = await getVariable(key.trim());
    setResult(v ? `${v.key} = ${v.value}` : 'Variable not found');
  }, [key, getVariable]);

  const handleSet = useCallback(async () => {
    if (!key.trim()) return;
    const ok = await setVariable(key.trim(), value);
    setResult(ok ? 'Variable updated' : 'Failed to set variable');
  }, [key, value, setVariable]);

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Device Variables
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
            <Text
              style={[styles.halfButtonText, { color: colors.primaryText }]}
            >
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
            <Text
              style={[styles.halfButtonText, { color: colors.primaryText }]}
            >
              Set
            </Text>
          </TouchableOpacity>
        </View>
      </View>
    </View>
  );
}

// ---------------------------------------------------------------------------
// Factory Reset section
// ---------------------------------------------------------------------------

function FactoryResetSection({
  colors,
  borderRadius,
}: {
  colors: typeof DEFAULT_COLORS;
  borderRadius: number;
}) {
  const { factoryReset } = useDeviceProtocol();
  const [confirmVisible, setConfirmVisible] = useState(false);

  const handleReset = async () => {
    setConfirmVisible(false);
    try {
      await factoryReset();
    } catch {
      // Error surfaced via store
    }
  };

  return (
    <View style={styles.section}>
      <Text style={[styles.sectionTitle, { color: colors.text }]}>
        Factory Reset
      </Text>

      <TouchableOpacity
        style={[
          styles.dangerButton,
          { borderColor: colors.error, borderRadius },
        ]}
        onPress={() => setConfirmVisible(true)}
        activeOpacity={0.7}
      >
        <Text style={[styles.dangerButtonText, { color: colors.error }]}>
          Factory Reset Device
        </Text>
      </TouchableOpacity>

      <Modal
        visible={confirmVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setConfirmVisible(false)}
      >
        <View style={styles.modalOverlay}>
          <View
            style={[
              styles.modalContent,
              {
                backgroundColor: colors.card,
                borderRadius: borderRadius,
              },
            ]}
          >
            <Text style={[styles.modalTitle, { color: colors.text }]}>
              Confirm Factory Reset
            </Text>
            <Text
              style={[styles.modalMessage, { color: colors.textSecondary }]}
            >
              This will erase all saved networks, variables, and settings on the
              device. This action cannot be undone.
            </Text>

            <View style={styles.modalButtons}>
              <TouchableOpacity
                style={[
                  styles.modalButton,
                  { borderColor: colors.border, borderRadius },
                ]}
                onPress={() => setConfirmVisible(false)}
                activeOpacity={0.7}
              >
                <Text
                  style={[styles.modalButtonText, { color: colors.text }]}
                >
                  Cancel
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={[
                  styles.modalButton,
                  {
                    backgroundColor: colors.error,
                    borderColor: colors.error,
                    borderRadius,
                    marginLeft: 10,
                  },
                ]}
                onPress={handleReset}
                activeOpacity={0.7}
              >
                <Text
                  style={[
                    styles.modalButtonText,
                    { color: colors.primaryText },
                  ]}
                >
                  Reset
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

// ---------------------------------------------------------------------------
// ManageScreen
// ---------------------------------------------------------------------------

export function ManageScreen({ theme }: ManageScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const { reset, provisioningError } = useProvisioning();

  return (
    <View style={[styles.container, { backgroundColor: c.background }]}>
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <ErrorBanner message={provisioningError} theme={theme} />

        <SavedNetworksSection
          colors={c}
          borderRadius={borderRadius}
          theme={theme}
        />

        <AccessPointSection
          colors={c}
          borderRadius={borderRadius}
          theme={theme}
        />

        <DeviceVariablesSection
          colors={c}
          borderRadius={borderRadius}
          theme={theme}
        />

        <FactoryResetSection colors={c} borderRadius={borderRadius} />

        <TouchableOpacity
          style={[styles.backButton, { borderRadius }]}
          onPress={reset}
          activeOpacity={0.8}
        >
          <Text style={[styles.backButtonText, { color: c.textSecondary }]}>
            Back
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 40,
  },

  // Sections
  section: {
    marginBottom: 28,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 12,
  },

  // List items
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingVertical: 14,
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  listItemSubtitle: {
    fontSize: 13,
  },
  deleteText: {
    fontSize: 14,
    fontWeight: '600',
  },

  // Detail cards
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
  },
  detailValue: {
    fontSize: 14,
    fontWeight: '600',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
  },

  // Empty states
  emptyCard: {
    borderWidth: 1,
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: 'center',
    marginBottom: 12,
  },
  emptyText: {
    fontSize: 14,
  },

  // Buttons
  sectionAction: {
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    marginTop: 4,
  },
  sectionActionText: {
    fontSize: 14,
    fontWeight: '600',
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
  dangerButton: {
    paddingVertical: 14,
    alignItems: 'center',
    borderWidth: 2,
  },
  dangerButtonText: {
    fontSize: 16,
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

  // Variable editor
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

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 32,
  },
  modalContent: {
    width: '100%',
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 8,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalMessage: {
    fontSize: 15,
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButtons: {
    flexDirection: 'row',
  },
  modalButton: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderWidth: 1,
  },
  modalButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
});
