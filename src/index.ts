// ===========================================================================
// esp-wifi-config-react-native — public surface (v2).
// ---------------------------------------------------------------------------
// AI-agent guidance: when integrating, prefer the high-level surface
// (`useProvisioning` + pre-built screens) unless you specifically need
// raw service classes. Read the canonical step machine in
// types/provisioning.ts → `ProvisioningStep`. The action verbs returned
// from `useProvisioning()` map 1:1 to ProvisioningManager methods.
//
// v2 wraps Espressif's official iOS / Android provisioning SDK
// (@orbital-systems/react-native-esp-idf-provisioning) instead of speaking
// the deleted custom JSON-over-GATT protocol directly.
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
  SecurityVersion,
  // Protocol
  DeviceVersionInfo,
  DeviceCapabilities,
  DeviceVariable,
  DeviceNetworkPolicy,
  VarsRequest,
  VarsResponse,
  DeviceProtocolConfig,
  DeviceProtocolEvents,
  // WiFi
  WifiAuthType,
  ScannedNetwork,
  ProvisionResult,
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
  DEVICE_NAME_PREFIX,
  DEFAULT_POP,
  DEFAULT_SECURITY2_USERNAME,
  DEFAULT_SCAN_TIMEOUT_MS,
  DEFAULT_SDK_TIMEOUT_MS,
} from './constants/ble';
export {
  PROV_ENDPOINT_VERSION,
  PROV_ENDPOINT_CAPABILITIES,
  PROV_ENDPOINT_VARS,
  PROV_ENDPOINT_NETWORK_POLICY,
  DEFAULT_ENDPOINT_TIMEOUT_MS,
  DEFAULT_WIFI_SCAN_TIMEOUT_MS,
  DEFAULT_PROVISION_TIMEOUT_MS,
} from './constants/protocol';
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
export { ProvisioningManager } from './services/ProvisioningManager';

// ── Service Factory (singleton access) ──
export {
  getTransport,
  getProtocol,
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
export { useDeviceProtocol } from './hooks/useDeviceProtocol';
export { useDeviceVariables } from './hooks/useDeviceVariables';

// ── Pre-Built UI Components ──
export {
  ErrorBanner,
  LoadingSpinner,
  SignalIcon,
  StepIndicator,
  PasswordInput,
  ConfirmDialog,
  NetworkList,
  NetworkListItem,
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
export { SCREEN_NAMES, stepToScreenName } from './navigation/navigationConfig';
export type { ScreenName } from './navigation/navigationConfig';
