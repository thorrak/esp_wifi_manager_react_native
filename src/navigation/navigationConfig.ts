import type { ProvisioningStep } from '../types';

/**
 * Logical screen names for the pre-built `ProvisioningNavigator`.
 *
 * Some adjacent sub-steps share a screen (e.g. `scanBle` + `connectingBle`
 * both render `Connect`); the `STEP_TO_SCREEN` map collapses them.
 */
export const SCREEN_NAMES = {
  Welcome: 'Welcome',
  Connect: 'Connect',
  DeviceAuth: 'DeviceAuth',
  Configure: 'Configure',
  NetworkScan: 'NetworkScan',
  Credentials: 'Credentials',
  Joining: 'Joining',
  Success: 'Success',
} as const;

export type ScreenName = (typeof SCREEN_NAMES)[keyof typeof SCREEN_NAMES];

const STEP_TO_SCREEN: Record<ProvisioningStep, ScreenName> = {
  welcome: SCREEN_NAMES.Welcome,
  scanBle: SCREEN_NAMES.Connect,
  enterDeviceAuth: SCREEN_NAMES.DeviceAuth,
  connectingBle: SCREEN_NAMES.Connect,
  configuring: SCREEN_NAMES.Configure,
  scanningWifi: SCREEN_NAMES.NetworkScan,
  chooseNetwork: SCREEN_NAMES.NetworkScan,
  enterCredentials: SCREEN_NAMES.Credentials,
  joiningWifi: SCREEN_NAMES.Joining,
  success: SCREEN_NAMES.Success,
};

/**
 * Convert a step into the corresponding pre-built screen name. Stable across
 * sub-step transitions that share a screen.
 */
export function stepToScreenName(step: ProvisioningStep): ScreenName {
  return STEP_TO_SCREEN[step];
}
