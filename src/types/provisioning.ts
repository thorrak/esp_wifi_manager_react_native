import type { ScannedNetwork, WifiStatus } from './wifi';
import type { BleTransportConfig } from './ble';
import type { DeviceProtocolConfig } from './protocol';

export type ProvisioningStep =
  | 'welcome'
  | 'connect'
  | 'networks'
  | 'credentials'
  | 'connecting'
  | 'success'
  | 'manage';

export const PROVISIONING_STEP_ORDER: ProvisioningStep[] = [
  'welcome',
  'connect',
  'networks',
  'credentials',
  'connecting',
  'success',
];

export function stepNumber(step: ProvisioningStep): number | null {
  const idx = PROVISIONING_STEP_ORDER.indexOf(step);
  return idx >= 0 ? idx + 1 : null;
}

export interface ProvisioningResult {
  success: boolean;
  ssid?: string;
  ip?: string;
  deviceName?: string;
  deviceId?: string;
}

export interface ProvisioningConfig {
  ble?: BleTransportConfig;
  protocol?: DeviceProtocolConfig;
  /** Polling interval while waiting for connection (ms). Default: 2000 */
  pollIntervalMs?: number;
  /** Polling timeout (ms). Default: 30000 */
  pollTimeoutMs?: number;
  /** Auto-advance past credentials for OPEN networks. Default: true */
  autoConnectOpenNetworks?: boolean;
  /** Default priority for added networks. Default: 10 */
  defaultNetworkPriority?: number;
}

export interface ProvisioningTheme {
  colors?: {
    primary?: string;
    primaryText?: string;
    background?: string;
    card?: string;
    text?: string;
    textSecondary?: string;
    border?: string;
    error?: string;
    success?: string;
    warning?: string;
  };
  borderRadius?: number;
}

export interface ProvisioningManagerEvents {
  stepChanged: (step: ProvisioningStep) => void;
  provisioningError: (error: string | null) => void;
  scannedNetworksUpdated: (networks: ScannedNetwork[]) => void;
  selectedNetworkChanged: (network: ScannedNetwork | null) => void;
  provisioningComplete: (result: ProvisioningResult) => void;
  provisioningReset: () => void;
  wifiStatusUpdated: (status: WifiStatus) => void;
}
