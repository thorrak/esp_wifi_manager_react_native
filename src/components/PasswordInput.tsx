import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet } from 'react-native';
import type { ProvisioningTheme, WifiAuthType } from '../types';

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

export interface PasswordInputProps {
  value: string;
  onChangeText: (text: string) => void;
  authType?: WifiAuthType;
  placeholder?: string;
  theme?: ProvisioningTheme;
}

export function PasswordInput({
  value,
  onChangeText,
  authType,
  placeholder = 'Enter password',
  theme,
}: PasswordInputProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;
  const [secure, setSecure] = useState(true);

  if (authType === 'OPEN') {
    return (
      <View
        style={[
          styles.openContainer,
          { backgroundColor: c.background, borderRadius },
        ]}
      >
        <Text style={[styles.openText, { color: c.textSecondary }]}>
          This is an open network — no password required
        </Text>
      </View>
    );
  }

  return (
    <View
      style={[
        styles.inputContainer,
        { borderColor: c.border, borderRadius },
      ]}
    >
      <TextInput
        style={[styles.input, { color: c.text }]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={c.textSecondary}
        secureTextEntry={secure}
        autoCapitalize="none"
        autoCorrect={false}
      />
      <TouchableOpacity
        onPress={() => setSecure((prev) => !prev)}
        style={styles.toggleButton}
        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      >
        <Text style={[styles.toggleText, { color: c.primary }]}>
          {secure ? 'Show' : 'Hide'}
        </Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  openContainer: {
    paddingVertical: 14,
    paddingHorizontal: 16,
  },
  openText: {
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    paddingHorizontal: 12,
  },
  input: {
    flex: 1,
    fontSize: 16,
    paddingVertical: 12,
  },
  toggleButton: {
    paddingLeft: 8,
  },
  toggleText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
