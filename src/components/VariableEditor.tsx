import { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Animated,
  StyleSheet,
} from 'react-native';
import type { ProvisioningTheme } from '../types';
import { useDeviceVariables } from '../hooks/useDeviceVariables';
import { ErrorBanner } from './ErrorBanner';

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

export interface VariableEditorProps {
  theme?: ProvisioningTheme;
}

export function VariableEditor({ theme }: VariableEditorProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };
  const borderRadius = theme?.borderRadius ?? 8;
  const { error, getVariable, setVariable } = useDeviceVariables();

  const [key, setKey] = useState('');
  const [value, setValue] = useState('');
  const [loading, setLoading] = useState(false);
  const [showSaved, setShowSaved] = useState(false);
  const savedOpacity = useRef(new Animated.Value(0)).current;
  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (savedTimer.current) {
        clearTimeout(savedTimer.current);
      }
    };
  }, []);

  const handleGet = useCallback(async () => {
    if (!key.trim()) return;
    setLoading(true);
    const result = await getVariable(key.trim());
    if (result) {
      setValue(result.value);
    }
    setLoading(false);
  }, [key, getVariable]);

  const handleSet = useCallback(async () => {
    if (!key.trim()) return;
    setLoading(true);
    const success = await setVariable(key.trim(), value);
    setLoading(false);

    if (success) {
      setShowSaved(true);
      Animated.timing(savedOpacity, {
        toValue: 1,
        duration: 200,
        useNativeDriver: true,
      }).start();

      if (savedTimer.current) {
        clearTimeout(savedTimer.current);
      }
      savedTimer.current = setTimeout(() => {
        Animated.timing(savedOpacity, {
          toValue: 0,
          duration: 400,
          useNativeDriver: true,
        }).start(() => setShowSaved(false));
      }, 2000);
    }
  }, [key, value, setVariable, savedOpacity]);

  return (
    <View style={styles.container}>
      <ErrorBanner message={error} theme={theme} />

      <Text style={[styles.label, { color: c.textSecondary }]}>Key</Text>
      <TextInput
        style={[
          styles.input,
          { color: c.text, borderColor: c.border, borderRadius },
        ]}
        value={key}
        onChangeText={setKey}
        placeholder="Variable key"
        placeholderTextColor={c.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <Text style={[styles.label, { color: c.textSecondary }]}>Value</Text>
      <TextInput
        style={[
          styles.input,
          { color: c.text, borderColor: c.border, borderRadius },
        ]}
        value={value}
        onChangeText={setValue}
        placeholder="Variable value"
        placeholderTextColor={c.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
      />

      <View style={styles.buttonRow}>
        <TouchableOpacity
          onPress={handleGet}
          disabled={loading || !key.trim()}
          activeOpacity={0.7}
          style={[
            styles.button,
            styles.getButton,
            {
              borderColor: c.primary,
              borderRadius,
              opacity: loading || !key.trim() ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.getButtonText, { color: c.primary }]}>Get</Text>
        </TouchableOpacity>

        <TouchableOpacity
          onPress={handleSet}
          disabled={loading || !key.trim()}
          activeOpacity={0.7}
          style={[
            styles.button,
            styles.setButton,
            {
              backgroundColor: c.primary,
              borderRadius,
              opacity: loading || !key.trim() ? 0.5 : 1,
            },
          ]}
        >
          <Text style={[styles.setButtonText, { color: c.primaryText }]}>
            Set
          </Text>
        </TouchableOpacity>
      </View>

      {showSaved && (
        <Animated.View
          style={[styles.savedContainer, { opacity: savedOpacity }]}
        >
          <Text style={[styles.savedText, { color: c.success }]}>Saved!</Text>
        </Animated.View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 4,
  },
  label: {
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 6,
    marginTop: 12,
  },
  input: {
    borderWidth: 1,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
  },
  buttonRow: {
    flexDirection: 'row',
    marginTop: 16,
  },
  button: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
  },
  getButton: {
    borderWidth: 1,
    marginRight: 8,
  },
  getButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  setButton: {},
  setButtonText: {
    fontSize: 15,
    fontWeight: '600',
  },
  savedContainer: {
    alignItems: 'center',
    marginTop: 12,
  },
  savedText: {
    fontSize: 14,
    fontWeight: '600',
  },
});
