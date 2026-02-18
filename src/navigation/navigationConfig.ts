import type { ProvisioningStep } from '../types';

export const SCREEN_NAMES = {
  Welcome: 'Welcome',
  Connect: 'Connect',
  NetworkScan: 'NetworkScan',
  Credentials: 'Credentials',
  Connecting: 'Connecting',
  Success: 'Success',
  Manage: 'Manage',
} as const;

export type ScreenName = (typeof SCREEN_NAMES)[keyof typeof SCREEN_NAMES];

const STEP_TO_SCREEN: Record<ProvisioningStep, ScreenName> = {
  welcome: SCREEN_NAMES.Welcome,
  connect: SCREEN_NAMES.Connect,
  networks: SCREEN_NAMES.NetworkScan,
  credentials: SCREEN_NAMES.Credentials,
  connecting: SCREEN_NAMES.Connecting,
  success: SCREEN_NAMES.Success,
  manage: SCREEN_NAMES.Manage,
};

export function stepToScreenName(step: ProvisioningStep): ScreenName {
  return STEP_TO_SCREEN[step];
}
