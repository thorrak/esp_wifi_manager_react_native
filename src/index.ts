// ===========================================================================
// esp-wifi-config-react-native — public surface.
// ---------------------------------------------------------------------------
// AI-agent guidance: when integrating, prefer the high-level surface
// (`useProvisioning` + pre-built screens) unless you specifically need
// raw service classes. Read the canonical step machine in
// types/provisioning.ts → `ProvisioningStep`. The action verbs returned
// from `useProvisioning()` map 1:1 to ProvisioningManager methods.
// ===========================================================================

// ── Types ──
export type {
  // BLE
  BleErrorCode,
  BleConnectionState,
  DiscoveredDevice,
  ConnectedDeviceInfo,
  ScanCompletedInfo,
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
  DeviceConnection,
  ProvisioningError,
  ProvisioningErrorSource,
  ProvisioningResult,
  ProvisioningConfig,
  ProvisioningTheme,
  OnConnectedContext,
  OnConnectedCallback,
  ProvisioningManagerEvents,
} from './types';

export { BleLibraryError } from './types/ble';

// ── Constants ──
export {
  SERVICE_UUID,
  STATUS_CHAR_UUID,
  COMMAND_CHAR_UUID,
  RESPONSE_CHAR_UUID,
  DEVICE_NAME_PREFIX,
  GATT_SETTLE_MS,
} from './constants';
export {
  PROVISIONING_STEP_ORDER,
  STEP_NUMBERS,
  VISIBLE_STEP_COUNT,
  stepNumber,
} from './types/provisioning';

// ── Utilities ──
export { setLogLevel, requestBluetoothPermissions } from './utils';
export type { LogLevel, BlePermissionResult } from './utils';

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
  ConfigureScreen,
  NetworkScanScreen,
  CredentialsScreen,
  ConnectingScreen,
  SuccessScreen,
  ManageScreen,
} from './screens';

// ── Navigation Utilities ──
// Note: ProvisioningNavigator is exported from 'esp-wifi-config-react-native/navigation'
// to avoid requiring @react-navigation peer deps for hooks-only users.
export { SCREEN_NAMES, stepToScreenName } from './navigation/navigationConfig';
export type { ScreenName } from './navigation/navigationConfig';
