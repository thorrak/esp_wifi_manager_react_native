import { useEffect, useRef, createContext, useContext } from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import type {
  ProvisioningTheme,
  ProvisioningConfig,
  ProvisioningResult,
  ProvisioningStep,
} from '../types';
import { stepNumber as getStepNumber, PROVISIONING_STEP_ORDER } from '../types/provisioning';
import { useProvisioning } from '../hooks/useProvisioning';
import { useBleConnection } from '../hooks/useBleConnection';
import { useProvisioningStore } from '../store/provisioningStore';
import { SCREEN_NAMES, stepToScreenName } from './navigationConfig';
/* ScreenName type used in stepToScreenName return */

import { WelcomeScreen } from '../screens/WelcomeScreen';
import { ConnectScreen } from '../screens/ConnectScreen';
import { NetworkScanScreen } from '../screens/NetworkScanScreen';
import { CredentialsScreen } from '../screens/CredentialsScreen';
import { ConnectingScreen } from '../screens/ConnectingScreen';
import { SuccessScreen } from '../screens/SuccessScreen';
import { ManageScreen } from '../screens/ManageScreen';

// ---------------------------------------------------------------------------
// Context for passing theme and callbacks to screens
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
// Types
// ---------------------------------------------------------------------------

export type RootStackParamList = {
  [SCREEN_NAMES.Welcome]: undefined;
  [SCREEN_NAMES.Connect]: undefined;
  [SCREEN_NAMES.NetworkScan]: undefined;
  [SCREEN_NAMES.Credentials]: undefined;
  [SCREEN_NAMES.Connecting]: undefined;
  [SCREEN_NAMES.Success]: undefined;
  [SCREEN_NAMES.Manage]: undefined;
};

const Stack = createNativeStackNavigator<RootStackParamList>();

// ---------------------------------------------------------------------------
// Default theme colors (for header)
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
// StepIndicator inline (header component)
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

  return (
    <View style={headerStyles.stepContainer}>
      {PROVISIONING_STEP_ORDER.map((_, idx) => {
        const stepIdx = idx + 1;
        const isActive = stepIdx === num;
        const isComplete = stepIdx < num;
        return (
          <View
            key={idx}
            style={[
              headerStyles.stepDot,
              {
                backgroundColor: isComplete
                  ? colors.primary
                  : isActive
                  ? colors.primary
                  : colors.border,
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
// Screen wrappers that pull theme/callbacks from context
// ---------------------------------------------------------------------------

function WelcomeScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <WelcomeScreen theme={theme} />;
}

function ConnectScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ConnectScreen theme={theme} />;
}

function NetworkScanScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <NetworkScanScreen theme={theme} />;
}

function CredentialsScreenWrapper() {
  const { theme } = useNavigatorContext();
  const goToNetworks = useProvisioningStore((s) => s.provisioningGoToNetworks);
  return <CredentialsScreen theme={theme} onGoBack={goToNetworks} />;
}

function ConnectingScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ConnectingScreen theme={theme} />;
}

function SuccessScreenWrapper() {
  const { theme, onComplete } = useNavigatorContext();
  const { wifiSsid, wifiIp, deviceName } = useProvisioning();
  const { deviceId } = useBleConnection();

  const handleComplete = () => {
    if (onComplete) {
      onComplete({
        success: true,
        ssid: wifiSsid,
        ip: wifiIp,
        deviceName,
        deviceId: deviceId ?? undefined,
      });
    }
  };

  return <SuccessScreen theme={theme} onComplete={handleComplete} />;
}

function ManageScreenWrapper() {
  const { theme } = useNavigatorContext();
  return <ManageScreen theme={theme} />;
}

// ---------------------------------------------------------------------------
// ProvisioningNavigator
// ---------------------------------------------------------------------------

export interface ProvisioningNavigatorProps {
  onComplete?: (result: ProvisioningResult) => void;
  onDismiss?: () => void;
  theme?: ProvisioningTheme;
  config?: ProvisioningConfig;
}

export function ProvisioningNavigator({
  onComplete,
  onDismiss,
  theme,
  config,
}: ProvisioningNavigatorProps) {
  const c = { ...DEFAULT_COLORS, ...theme?.colors };

  const step = useProvisioningStore((s) => s.step);
  const connectionState = useProvisioningStore((s) => s.connectionState);
  const deviceName = useProvisioningStore((s) => s.deviceName);
  const initialize = useProvisioningStore((s) => s.initialize);
  const destroy = useProvisioningStore((s) => s.destroy);
  const disconnectDevice = useProvisioningStore((s) => s.disconnectDevice);

  const navigationRef = useRef<any>(null);

  // Initialize services on mount, destroy on unmount
  useEffect(() => {
    if (config) {
      initialize(config);
    } else {
      initialize();
    }
    return () => {
      destroy();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Navigate when step changes
  useEffect(() => {
    const screenName = stepToScreenName(step);
    if (navigationRef.current) {
      const nav = navigationRef.current;
      // Use reset to avoid stacking screens
      try {
        nav.reset({
          index: 0,
          routes: [{ name: screenName }],
        });
      } catch {
        // Navigation might not be ready yet
      }
    }
  }, [step]);

  const isConnected = connectionState === 'connected';
  const showStepIndicator = getStepNumber(step) !== null;

  const contextValue: ProvisioningNavigatorContext = {
    theme,
    onComplete,
  };

  return (
    <NavigatorContext.Provider value={contextValue}>
      <Stack.Navigator
        // @ts-expect-error -- navigator ref typing varies between RN Nav versions
        ref={navigationRef}
        initialRouteName={SCREEN_NAMES.Welcome}
        screenOptions={{
          headerStyle: {
            backgroundColor: c.card,
          },
          headerTintColor: c.text,
          headerTitleStyle: {
            fontWeight: '600',
            fontSize: 17,
          },
          headerShadowVisible: false,
          animation: 'slide_from_right',
          gestureEnabled: false,
          headerRight: () =>
            isConnected ? (
              <TouchableOpacity
                onPress={disconnectDevice}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Text style={{ color: c.error, fontSize: 14, fontWeight: '600' }}>
                  Disconnect
                </Text>
              </TouchableOpacity>
            ) : null,
          headerTitle: () => (
            <View style={headerStyles.titleContainer}>
              {isConnected && deviceName ? (
                <Text
                  style={[headerStyles.deviceLabel, { color: c.textSecondary }]}
                  numberOfLines={1}
                >
                  {deviceName}
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
          name={SCREEN_NAMES.Connecting}
          component={ConnectingScreenWrapper}
          options={{ title: 'Connecting' }}
        />
        <Stack.Screen
          name={SCREEN_NAMES.Success}
          component={SuccessScreenWrapper}
          options={{ title: 'Connected' }}
        />
        <Stack.Screen
          name={SCREEN_NAMES.Manage}
          component={ManageScreenWrapper}
          options={{ title: 'Manage Device' }}
        />
      </Stack.Navigator>
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
