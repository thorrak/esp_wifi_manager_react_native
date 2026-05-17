/**
 * ProvisioningNavigator — drop-in pre-built wizard.
 *
 * Wraps `useProvisioning` + the pre-built screens in a self-contained
 * `NavigationIndependentTree` so it works inside Expo Router or any
 * existing React Navigation tree without conflict. Step transitions
 * drive screen navigation via the `stepToScreenName` map.
 */

import { createContext, useContext, useEffect, useRef } from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';

import { NavigationIndependentTree } from '@react-navigation/core';
import {
  NavigationContainer,
  createNavigationContainerRef,
} from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';

import { useProvisioning } from '../hooks/useProvisioning';
import { ConfigureScreen } from '../screens/ConfigureScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { ConnectingScreen } from '../screens/ConnectingScreen';
import { CredentialsScreen } from '../screens/CredentialsScreen';
import { DeviceAuthScreen } from '../screens/DeviceAuthScreen';
import { NetworkScanScreen } from '../screens/NetworkScanScreen';
import { SuccessScreen } from '../screens/SuccessScreen';
import { WelcomeScreen } from '../screens/WelcomeScreen';
import { useProvisioningStore } from '../store/provisioningStore';
import {
  PROVISIONING_STEP_ORDER,
  stepNumber as getStepNumber,
} from '../types/provisioning';
import type {
  ProvisioningConfig,
  ProvisioningResult,
  ProvisioningStep,
  ProvisioningTheme,
} from '../types';
import { SCREEN_NAMES, stepToScreenName } from './navigationConfig';

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface ProvisioningNavigatorContext {
  theme?: ProvisioningTheme;
  onComplete?: (result: ProvisioningResult) => void;
}

const NavigatorContext = createContext<ProvisioningNavigatorContext>({});

export function useNavigatorContext() {
  return useContext(NavigatorContext);
}

// ---------------------------------------------------------------------------
// Stack types
// ---------------------------------------------------------------------------

export type RootStackParamList = {
  [SCREEN_NAMES.Welcome]: undefined;
  [SCREEN_NAMES.Connect]: undefined;
  [SCREEN_NAMES.DeviceAuth]: undefined;
  [SCREEN_NAMES.Configure]: undefined;
  [SCREEN_NAMES.NetworkScan]: undefined;
  [SCREEN_NAMES.Credentials]: undefined;
  [SCREEN_NAMES.Joining]: undefined;
  [SCREEN_NAMES.Success]: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Header step indicator
// ---------------------------------------------------------------------------

function StepIndicatorHeader({
  currentStep,
  colors,
}: {
  currentStep: ProvisioningStep;
  colors: typeof DEFAULT_COLORS;
}) {
  const num = getStepNumber(currentStep);
  if (num === null) return null;

  // PROVISIONING_STEP_ORDER includes substeps; use distinct visible steps.
  const visibleSteps = Array.from(
    new Set(
      PROVISIONING_STEP_ORDER.map((s) => getStepNumber(s)).filter(
        (n): n is number => n !== null,
      ),
    ),
  );

  return (
    <View style={headerStyles.stepContainer}>
      {visibleSteps.map((stepIdx) => {
        const isActive = stepIdx === num;
        const isComplete = stepIdx < num;
        return (
          <View
            key={stepIdx}
            style={[
              headerStyles.stepDot,
              {
                backgroundColor:
                  isComplete || isActive ? colors.primary : colors.border,
                opacity: isActive ? 1 : isComplete ? 0.7 : 0.4,
              },
            ]}
          />
        );
      })}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Screen wrappers
// ---------------------------------------------------------------------------

function WelcomeScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <WelcomeScreen theme={theme} />;
}

function ConnectScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ConnectScreen theme={theme} />;
}

function DeviceAuthScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <DeviceAuthScreen theme={theme} />;
}

function ConfigureScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ConfigureScreen theme={theme} />;
}

function NetworkScanScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <NetworkScanScreen theme={theme} />;
}

function CredentialsScreenWrapper() {
  const { theme } = useNavigatorContext();
  const backToNetworks = useProvisioningStore((s) => s.backToNetworks);
  return <CredentialsScreen theme={theme} onGoBack={backToNetworks} />;
}

function JoiningScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ConnectingScreen theme={theme} />;
}

function SuccessScreenWrapper() {
  const { theme, onComplete } = useNavigatorContext();
  const { lastResult } = useProvisioning();

  const handleComplete = () => {
    if (onComplete && lastResult) onComplete(lastResult);
  };

  return <SuccessScreen theme={theme} onComplete={handleComplete} />;
}

// ---------------------------------------------------------------------------
// ProvisioningNavigator
// ---------------------------------------------------------------------------

export interface ProvisioningNavigatorProps {
  /** Called once with the latched result when provisioning completes. */
  onComplete?: (result: ProvisioningResult) => void;
  /** Called when the user dismisses the wizard from the Welcome screen. */
  onDismiss?: () => void;
  /** Visual customization. */
  theme?: ProvisioningTheme;
  /** BLE / protocol / poller / flow configuration. */
  config?: ProvisioningConfig;
}

/**
 * Drop-in WiFi provisioning wizard. Mounts an isolated React Navigation
 * tree and drives screens off the manager's step machine.
 *
 * @example
 * <ProvisioningNavigator
 *   config={{ ble: { deviceNamePrefix: 'MyDevice-' } }}
 *   onComplete={(r) => router.push(`/devices/${r.deviceId}`)}
 *   onDismiss={() => router.back()}
 * />
 */
export function ProvisioningNavigator({
  onComplete,
  onDismiss,
  theme,
  config,
}: ProvisioningNavigatorProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  const step = useProvisioningStore((s) => s.step);
  const device = useProvisioningStore((s) => s.device);
  const initialize = useProvisioningStore((s) => s.initialize);
  const destroy = useProvisioningStore((s) => s.destroy);
  const cancel = useProvisioningStore((s) => s.cancel);

  const navigationRef = useRef(
    createNavigationContainerRef<RootStackParamList>(),
  );

  // Initialize services on mount, destroy on unmount.
  useEffect(() => {
    initialize(config);
    return () => {
      destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate when the step transitions to a new screen. Adjacent sub-steps
  // mapped to the same screen produce no navigation.
  const prevScreenRef = useRef(stepToScreenName(step));
  useEffect(() => {
    const screenName = stepToScreenName(step);
    if (prevScreenRef.current === screenName) return;
    prevScreenRef.current = screenName;

    const nav = navigationRef.current;
    if (nav.isReady()) {
      try {
        nav.reset({ index: 0, routes: [{ name: screenName }] });
      } catch {
        // Navigation might not be ready yet
      }
    }
  }, [step]);

  const isConnected = device?.status === 'connected';
  const showStepIndicator = getStepNumber(step) !== null;

  const contextValue: ProvisioningNavigatorContext = { theme, onComplete };

  return (
    <NavigatorContext.Provider value={contextValue}>
      <NavigationIndependentTree>
        <NavigationContainer ref={navigationRef.current}>
          <Stack.Navigator
            initialRouteName={SCREEN_NAMES.Welcome}
            screenOptions={{
              headerStyle: { backgroundColor: c.card },
              headerTintColor: c.text,
              headerTitleStyle: { fontWeight: '600', fontSize: 17 },
              headerShadowVisible: false,
              animation: 'slide_from_right',
              gestureEnabled: false,
              headerRight: () =>
                isConnected ? (
                  <TouchableOpacity
                    onPress={() => void cancel()}
                    hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  >
                    <Text
                      style={{
                        color: c.error,
                        fontSize: 14,
                        fontWeight: '600',
                      }}
                    >
                      Disconnect
                    </Text>
                  </TouchableOpacity>
                ) : null,
              headerTitle: () => (
                <View style={headerStyles.titleContainer}>
                  {device?.name ? (
                    <Text
                      style={[
                        headerStyles.deviceLabel,
                        { color: c.textSecondary },
                      ]}
                      numberOfLines={1}
                    >
                      {device.name}
                    </Text>
                  ) : null}
                  {showStepIndicator && (
                    <StepIndicatorHeader currentStep={step} colors={c} />
                  )}
                </View>
              ),
            }}
          >
            <Stack.Screen
              name={SCREEN_NAMES.Welcome}
              component={WelcomeScreenWrapper}
              options={{
                title: 'WiFi Setup',
                headerLeft: onDismiss
                  ? () => (
                      <TouchableOpacity
                        onPress={onDismiss}
                        hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                      >
                        <Text
                          style={{
                            color: c.primary,
                            fontSize: 16,
                            fontWeight: '600',
                          }}
                        >
                          Close
                        </Text>
                      </TouchableOpacity>
                    )
                  : undefined,
              }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.Connect}
              component={ConnectScreenWrapper}
              options={{ title: 'Select Device' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.DeviceAuth}
              component={DeviceAuthScreenWrapper}
              options={{ title: 'Device Authentication' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.Configure}
              component={ConfigureScreenWrapper}
              options={{ title: 'Configure Device' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.NetworkScan}
              component={NetworkScanScreenWrapper}
              options={{ title: 'WiFi Networks' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.Credentials}
              component={CredentialsScreenWrapper}
              options={{ title: 'Enter Password' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.Joining}
              component={JoiningScreenWrapper}
              options={{ title: 'Connecting' }}
            />
            <Stack.Screen
              name={SCREEN_NAMES.Success}
              component={SuccessScreenWrapper}
              options={{ title: 'Connected' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </NavigationIndependentTree>
    </NavigatorContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headerStyles = StyleSheet.create({
  titleContainer: {
    alignItems: 'center',
  },
  deviceLabel: {
    fontSize: 12,
    marginBottom: 2,
  },
  stepContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  stepDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
});
