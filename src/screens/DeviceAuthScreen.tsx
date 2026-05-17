/**
 * DeviceAuthScreen — captures the device-auth credentials needed for the
 * protocomm handshake when the wizard inserts the `enterDeviceAuth` step.
 *
 * Renders different inputs based on the configured security version
 * (surfaced through `authMode`):
 *   - `'pop'` — single Proof-of-Possession field for Security 1.
 *   - `'srp'` — username + SRP-password fields for Security 2.
 *   - `null` — should never render (sec0 skips the step entirely).
 *
 * Pre-fills the last-entered values when the screen is re-shown after an
 * `unauthorized` bounce so the user can fix a typo instead of starting
 * over. The submission goes through `submitDeviceAuth()`, which routes
 * the credentials into the next `connect()` attempt.
 */

import { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
} from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useProvisioning } from '../hooks/useProvisioning';
import { ErrorBanner } from '../components/ErrorBanner';

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

export interface DeviceAuthScreenProps {
  theme?: ProvisioningTheme;
}

export function DeviceAuthScreen({ theme }: DeviceAuthScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    authMode,
    defaultAuthValues,
    pendingAuth,
    device,
    error,
    submitDeviceAuth,
    pickDifferentDevice,
  } = useProvisioning();

  // Pre-fill: pendingAuth wins (unauthorized bounce), else config defaults.
  const initialPop = pendingAuth?.pop ?? defaultAuthValues.pop ?? '';
  const initialUsername =
    pendingAuth?.username ?? defaultAuthValues.username ?? '';

  const [pop, setPop] = useState(initialPop);
  const [username, setUsername] = useState(initialUsername);
  const [showPop, setShowPop] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Sync seeded values if the unauthorized bounce updates them after mount.
  useEffect(() => {
    if (initialPop && !pop) setPop(initialPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialPop]);

  const deviceName = device?.name ?? 'device';
  const isUnauthorized = error?.code === 'unauthorized';

  const handleSubmit = async () => {
    if (submitting) return;
    setSubmitting(true);
    try {
      await submitDeviceAuth({ pop, username });
    } finally {
      setSubmitting(false);
    }
  };

  const handleBack = () => {
    if (submitting) return;
    void pickDifferentDevice();
  };

  const popLabel = authMode === 'srp' ? 'Password' : 'Proof of Possession';
  const popPlaceholder =
    authMode === 'srp' ? 'SRP password' : 'PoP code (e.g. abcd1234)';
  const submitDisabled =
    submitting ||
    pop.length === 0 ||
    (authMode === 'srp' && username.length === 0);

  if (authMode === null) {
    // Defensive — sec0 shouldn't have routed here. Render a tiny note so
    // a developer notices instead of silently breaking the wizard.
    return (
      <View style={[styles.container, { backgroundColor: c.background }]}>
        <Text style={[styles.title, { color: c.text, padding: 24 }]}>
          No device authentication is required for this security level.
        </Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <ErrorBanner
          message={
            isUnauthorized
              ? 'Authentication rejected. Check the values and try again.'
              : error?.message ?? null
          }
          theme={theme}
        />

        <Text style={[styles.title, { color: c.text }]}>
          Authenticate {deviceName}
        </Text>
        <Text style={[styles.subtitle, { color: c.textSecondary }]}>
          {authMode === 'srp'
            ? 'Enter the username and password configured on this device.'
            : 'Enter the Proof-of-Possession code printed on the device or supplied by your administrator.'}
        </Text>

        {authMode === 'srp' && (
          <View style={styles.field}>
            <Text style={[styles.label, { color: c.text }]}>Username</Text>
            <View
              style={[
                styles.inputContainer,
                {
                  borderColor: c.border,
                  backgroundColor: c.card,
                  borderRadius,
                },
              ]}
            >
              <TextInput
                style={[styles.input, { color: c.text }]}
                value={username}
                onChangeText={setUsername}
                placeholder="Username"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!submitting}
                returnKeyType="next"
              />
            </View>
          </View>
        )}

        <View style={styles.field}>
          <Text style={[styles.label, { color: c.text }]}>{popLabel}</Text>
          <View
            style={[
              styles.inputContainer,
              {
                borderColor: c.border,
                backgroundColor: c.card,
                borderRadius,
              },
            ]}
          >
            <TextInput
              style={[styles.input, { color: c.text }]}
              value={pop}
              onChangeText={setPop}
              secureTextEntry={!showPop}
              placeholder={popPlaceholder}
              placeholderTextColor={c.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!submitting}
              returnKeyType="done"
              onSubmitEditing={() => void handleSubmit()}
            />
            <TouchableOpacity
              style={styles.toggleButton}
              onPress={() => setShowPop(!showPop)}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
            >
              <Text style={[styles.toggleText, { color: c.textSecondary }]}>
                {showPop ? 'Hide' : 'Show'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity
          style={[
            styles.connectButton,
            {
              backgroundColor: submitDisabled ? c.border : c.primary,
              borderRadius,
            },
          ]}
          onPress={() => void handleSubmit()}
          disabled={submitDisabled}
          activeOpacity={0.8}
        >
          <Text style={[styles.connectButtonText, { color: c.primaryText }]}>
            {submitting ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.backButton, { borderRadius }]}
          onPress={handleBack}
          disabled={submitting}
          activeOpacity={0.8}
        >
          <Text style={[styles.backButtonText, { color: c.textSecondary }]}>
            Back to devices
          </Text>
        </TouchableOpacity>
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 16,
    paddingTop: 24,
    paddingBottom: 32,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 24,
  },
  field: {
    marginBottom: 20,
  },
  label: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 8,
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 14,
  },
  toggleButton: {
    paddingLeft: 12,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
  connectButton: {
    paddingVertical: 16,
    alignItems: 'center',
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  connectButtonText: {
    fontSize: 17,
    fontWeight: '600',
  },
  backButton: {
    paddingVertical: 14,
    alignItems: 'center',
  },
  backButtonText: {
    fontSize: 16,
    fontWeight: '600',
  },
});
