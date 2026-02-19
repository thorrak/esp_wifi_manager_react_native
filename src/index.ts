// ── Types ──
export type {
  // BLE
  BleConnectionState,
  DiscoveredDevice,
  ConnectedDeviceInfo,
  BleTransportConfig,
  BleTransportEvents,
  // Protocol
  CommandName,
  AddNetworkParams,
  DelNetworkParams,
  ConnectParams,
  StartApParams,
  GetVarParams,
  SetVarParams,
  CommandEnvelope,
  ResponseEnvelope,
  ResponseEnvelopeOk,
  ResponseEnvelopeError,
  DeviceProtocolConfig,
  DeviceProtocolEvents,
  // WiFi
  WifiConnectionState,
  WifiAuthType,
  WifiStatus,
  ScannedNetwork,
  SavedNetwork,
  ScanResponseData,
  ListNetworksResponseData,
  ApStatus,
  DeviceVariable,
  // Provisioning
  ProvisioningStep,
  ProvisioningResult,
  ProvisioningConfig,
  ProvisioningTheme,
  ProvisioningManagerEvents,
} from './types';

// ── Constants ──
export {
  SERVICE_UUID,
  STATUS_CHAR_UUID,
  COMMAND_CHAR_UUID,
  RESPONSE_CHAR_UUID,
  DEVICE_NAME_PREFIX,
  GATT_SETTLE_MS,
} from './constants';
export { PROVISIONING_STEP_ORDER, stepNumber } from './types/provisioning';

// ── Utilities ──
export { setLogLevel } from './utils';
export type { LogLevel } from './utils';

// ── Service Classes (for headless / advanced use) ──
export { BleTransport } from './services/BleTransport';
export { DeviceProtocol } from './services/DeviceProtocol';
export { ConnectionPoller } from './services/ConnectionPoller';
export type { ConnectionPollerEvents } from './services/ConnectionPoller';
export { ProvisioningManager } from './services/ProvisioningManager';

// ── Service Factory (singleton access) ──
export {
  getTransport,
  getProtocol,
  getPoller,
  getManager,
  initializeServices,
  destroyServices,
} from './serviceFactory';

// ── Zustand Store ──
export { useProvisioningStore } from './store';
export type { ProvisioningStoreState, ProvisioningStoreActions } from './store';

// ── React Hooks ──
export { useProvisioning } from './hooks/useProvisioning';
export { useDeviceScanner } from './hooks/useDeviceScanner';
export { useBleConnection } from './hooks/useBleConnection';
export { useWifiStatus } from './hooks/useWifiStatus';
export { useDeviceProtocol } from './hooks/useDeviceProtocol';
export { useSavedNetworks } from './hooks/useSavedNetworks';
export { useAccessPoint } from './hooks/useAccessPoint';
export { useDeviceVariables } from './hooks/useDeviceVariables';

// ── Pre-Built UI Components ──
export {
  ErrorBanner,
  LoadingSpinner,
  SignalIcon,
  StatusBadge,
  StepIndicator,
  PasswordInput,
  ConfirmDialog,
  NetworkList,
  NetworkListItem,
  SavedNetworkList,
  SavedNetworkItem,
  ApSettings,
  VariableEditor,
  DeviceListItem,
} from './components';

// ── Pre-Built Screens ──
export {
  WelcomeScreen,
  ConnectScreen,
  NetworkScanScreen,
  CredentialsScreen,
  ConnectingScreen,
  SuccessScreen,
  ManageScreen,
} from './screens';

// ── Navigation Utilities ──
// Note: ProvisioningNavigator is exported from 'esp-wifi-manager-react-native/navigation'
// to avoid requiring @react-navigation peer deps for hooks-only users.
export { SCREEN_NAMES, stepToScreenName } from './navigation/navigationConfig';
export type { ScreenName } from './navigation/navigationConfig';
