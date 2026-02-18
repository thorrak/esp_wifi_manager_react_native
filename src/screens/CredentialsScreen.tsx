import { useState } from 'react';
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
import { SignalIcon } from '../components/SignalIcon';

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

export interface CredentialsScreenProps {
  theme?: ProvisioningTheme;
  onGoBack?: () => void;
}

export function CredentialsScreen({ theme, onGoBack }: CredentialsScreenProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 12;

  const {
    selectedNetwork,
    submitCredentials,
    provisioningError,
    busy,
  } = useProvisioning();

  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const isOpen = selectedNetwork?.auth === 'OPEN';
  const ssid = selectedNetwork?.ssid ?? '';

  const handleConnect = () => {
    if (isOpen) {
      submitCredentials('');
    } else {
      submitCredentials(password);
    }
  };

  const handleBack = () => {
    if (onGoBack) {
      onGoBack();
    }
  };

  return (
    <KeyboardAvoidingView
      style={[styles.container, { backgroundColor: c.background }]}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <ScrollView
        contentContainerStyle={styles.scrollContent}
        keyboardShouldPersistTaps="handled"
      >
        <ErrorBanner message={provisioningError} theme={theme} />

        <View
          style={[
            styles.networkCard,
            {
              backgroundColor: c.card,
              borderColor: c.border,
              borderRadius,
            },
          ]}
        >
          <View style={styles.networkHeader}>
            {selectedNetwork && (
              <SignalIcon
                rssi={selectedNetwork.rssi}
                size={24}
                theme={theme}
              />
            )}
            <View style={styles.networkDetails}>
              <Text style={[styles.networkSsid, { color: c.text }]}>
                {ssid}
              </Text>
              <Text style={[styles.networkAuth, { color: c.textSecondary }]}>
                {isOpen ? 'Open Network' : selectedNetwork?.auth ?? ''}
              </Text>
            </View>
          </View>
        </View>

        <Text style={[styles.title, { color: c.text }]}>
          Connect to {ssid}
        </Text>

        {isOpen ? (
          <View style={styles.openNotice}>
            <Text style={[styles.openNoticeText, { color: c.textSecondary }]}>
              This is an open network. No password is required.
            </Text>
          </View>
        ) : (
          <View style={styles.passwordSection}>
            <Text style={[styles.label, { color: c.text }]}>Password</Text>
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
                value={password}
                onChangeText={setPassword}
                secureTextEntry={!showPassword}
                placeholder="Enter WiFi password"
                placeholderTextColor={c.textSecondary}
                autoCapitalize="none"
                autoCorrect={false}
                editable={!busy}
                returnKeyType="done"
                onSubmitEditing={handleConnect}
              />
              <TouchableOpacity
                style={styles.toggleButton}
                onPress={() => setShowPassword(!showPassword)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text
                  style={[styles.toggleText, { color: c.textSecondary }]}
                >
                  {showPassword ? 'Hide' : 'Show'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        <TouchableOpacity
          style={[
            styles.connectButton,
            {
              backgroundColor: busy ? c.border : c.primary,
              borderRadius,
            },
          ]}
          onPress={handleConnect}
          disabled={busy || (!isOpen && password.length === 0)}
          activeOpacity={0.8}
        >
          <Text style={[styles.connectButtonText, { color: c.primaryText }]}>
            {busy ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.backButton, { borderRadius }]}
          onPress={handleBack}
          disabled={busy}
          activeOpacity={0.8}
        >
          <Text style={[styles.backButtonText, { color: c.textSecondary }]}>
            Back
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
  networkCard: {
    borderWidth: 1,
    padding: 16,
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  networkHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  networkDetails: {
    marginLeft: 12,
    flex: 1,
  },
  networkSsid: {
    fontSize: 17,
    fontWeight: '600',
    marginBottom: 2,
  },
  networkAuth: {
    fontSize: 13,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    marginBottom: 20,
  },
  openNotice: {
    marginBottom: 24,
  },
  openNoticeText: {
    fontSize: 15,
    lineHeight: 22,
  },
  passwordSection: {
    marginBottom: 24,
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
