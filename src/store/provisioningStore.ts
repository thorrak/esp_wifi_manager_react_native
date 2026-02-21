/**
 * Zustand store that bridges the four service layers to React.
 *
 * Two responsibilities:
 *   1. Mirror service state into Zustand state (via event subscriptions)
 *   2. Expose actions that delegate to services
 *
 * The service event subscriptions are set up lazily on the first action call
 * that requires services (`ensureInitialized`).
 */

import { create } from 'zustand';
import {
  getTransport,
  getProtocol,
  getPoller,
  getManager,
  initializeServices,
  destroyServices,
} from '../serviceFactory';
import type {
  ProvisioningConfig,
  ProvisioningStep,
  ScannedNetwork,
  WifiConnectionState,
  WifiStatus,
  SavedNetwork,
  ApStatus,
  DeviceVariable,
  AddNetworkParams,
  StartApParams,
  BleConnectionState,
  DiscoveredDevice,
} from '../types';

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface ProvisioningStoreState {
  // BLE slice
  connectionState: BleConnectionState;
  deviceName: string;
  deviceId: string | null;
  discoveredDevices: DiscoveredDevice[];
  scanning: boolean;
  bleError: string | null;

  // Protocol slice
  busy: boolean;
  lastCommandError: string | null;

  // Poller slice
  wifiState: WifiConnectionState;
  wifiSsid: string;
  wifiIp: string;
  wifiRssi: number;
  wifiQuality: number;
  polling: boolean;
  pollError: string | null;
  connectionFailed: boolean;

  // Provisioning slice
  step: ProvisioningStep;
  selectedNetwork: ScannedNetwork | null;
  scannedNetworks: ScannedNetwork[];
  provisioningError: string | null;
}

// ---------------------------------------------------------------------------
// Actions interface
// ---------------------------------------------------------------------------

export interface ProvisioningStoreActions {
  // Lifecycle
  initialize: (config?: ProvisioningConfig) => void;
  destroy: () => void;

  // BLE
  startScan: () => void;
  stopScan: () => void;
  connectToDevice: (deviceId: string) => Promise<void>;
  disconnectDevice: () => void;

  // Direct protocol commands
  getStatus: () => Promise<WifiStatus>;
  scanNetworks: () => Promise<ScannedNetwork[]>;
  listNetworks: () => Promise<SavedNetwork[]>;
  addNetwork: (params: AddNetworkParams) => Promise<void>;
  delNetwork: (ssid: string) => Promise<void>;
  connectWifi: (ssid?: string) => Promise<void>;
  disconnectWifi: () => Promise<void>;
  getApStatus: () => Promise<ApStatus>;
  startAp: (params?: StartApParams) => Promise<void>;
  stopAp: () => Promise<void>;
  getVar: (key: string) => Promise<DeviceVariable>;
  setVar: (key: string, value: string) => Promise<void>;
  factoryReset: () => Promise<void>;

  // Provisioning flow
  provisioningScanForDevices: () => void;
  provisioningConnectToDevice: (deviceId: string) => Promise<void>;
  provisioningScanWifiNetworks: () => Promise<void>;
  provisioningSelectNetwork: (network: ScannedNetwork) => void;
  provisioningSubmitCredentials: (password: string) => Promise<void>;
  provisioningRetryConnection: () => Promise<void>;
  provisioningDeleteNetworkAndReturn: () => Promise<void>;
  provisioningGoToNetworks: () => void;
  provisioningGoToManage: () => void;
  provisioningReset: () => void;

  // Poller
  startPolling: (timeoutMs?: number, intervalMs?: number) => void;
  stopPolling: () => void;
  pollOnce: () => Promise<WifiStatus>;
}

// ---------------------------------------------------------------------------
// Default state values
// ---------------------------------------------------------------------------

const initialState: ProvisioningStoreState = {
  // BLE
  connectionState: 'disconnected',
  deviceName: '',
  deviceId: null,
  discoveredDevices: [],
  scanning: false,
  bleError: null,

  // Protocol
  busy: false,
  lastCommandError: null,

  // Poller
  wifiState: 'disconnected',
  wifiSsid: '',
  wifiIp: '',
  wifiRssi: 0,
  wifiQuality: 0,
  polling: false,
  pollError: null,
  connectionFailed: false,

  // Provisioning
  step: 'welcome',
  selectedNetwork: null,
  scannedNetworks: [],
  provisioningError: null,
};

// ---------------------------------------------------------------------------
// Module-level subscription tracking
// ---------------------------------------------------------------------------

let unsubscribers: (() => void)[] = [];

/**
 * Subscribe to all service events and sync their state into the Zustand store.
 * Idempotent -- no-ops if already subscribed.
 */
function subscribeToServices(
  set: (
    partial:
      | Partial<ProvisioningStoreState>
      | ((state: ProvisioningStoreState) => Partial<ProvisioningStoreState>),
  ) => void,
): void {
  if (unsubscribers.length > 0) {
    return;
  }

  const transport = getTransport();
  const protocol = getProtocol();
  const poller = getPoller();
  const manager = getManager();

  // -- Transport events -----------------------------------------------------

  unsubscribers.push(
    transport.on('connectionStateChanged', (state: BleConnectionState) => {
      set({ connectionState: state });
    }),
  );

  unsubscribers.push(
    transport.on('deviceDiscovered', (device: DiscoveredDevice) => {
      set((s) => ({
        discoveredDevices: [
          ...s.discoveredDevices.filter((d) => d.id !== device.id),
          device,
        ],
      }));
    }),
  );

  unsubscribers.push(
    transport.on('scanStopped', () => {
      set({ scanning: false });
    }),
  );

  unsubscribers.push(
    transport.on('error', (err: Error) => {
      set({ bleError: err.message });
    }),
  );

  // -- Protocol events ------------------------------------------------------

  unsubscribers.push(
    protocol.on('busyChanged', (busy: boolean) => {
      set({ busy });
    }),
  );

  unsubscribers.push(
    protocol.on('commandError', (err: Error) => {
      set({ lastCommandError: err.message });
    }),
  );

  // -- Poller events --------------------------------------------------------

  unsubscribers.push(
    poller.on('wifiStateChanged', (status: WifiStatus) => {
      set({
        wifiState: status.state,
        wifiSsid: status.ssid || '',
        wifiIp: status.ip || '',
        wifiRssi: status.rssi || 0,
        wifiQuality: status.quality || 0,
      });
    }),
  );

  unsubscribers.push(
    poller.on('connectionSucceeded', () => {
      set({ polling: false });
    }),
  );

  unsubscribers.push(
    poller.on('connectionFailed', () => {
      set({ connectionFailed: true, polling: false });
    }),
  );

  unsubscribers.push(
    poller.on('connectionTimedOut', () => {
      set({ pollError: 'Connection timed out', polling: false });
    }),
  );

  // -- Manager events -------------------------------------------------------

  unsubscribers.push(
    manager.on('stepChanged', (step: ProvisioningStep) => {
      const updates: Partial<ProvisioningStoreState> = { step };
      // When step transitions to 'connecting', polling is active
      if (step === 'connecting') {
        updates.polling = true;
        updates.pollError = null;
        updates.connectionFailed = false;
      }
      set(updates);
    }),
  );

  unsubscribers.push(
    manager.on('scannedNetworksUpdated', (networks: ScannedNetwork[]) => {
      set({ scannedNetworks: networks });
    }),
  );

  unsubscribers.push(
    manager.on('selectedNetworkChanged', (network: ScannedNetwork | null) => {
      set({ selectedNetwork: network });
    }),
  );

  unsubscribers.push(
    manager.on('provisioningError', (error: string | null) => {
      set({ provisioningError: error });
    }),
  );

  unsubscribers.push(
    manager.on('provisioningReset', () => {
      set(initialState);
    }),
  );
}

/**
 * Ensure services are created and event subscriptions are wired up.
 * Idempotent -- safe to call from every action.
 */
function ensureInitialized(
  set: (
    partial:
      | Partial<ProvisioningStoreState>
      | ((state: ProvisioningStoreState) => Partial<ProvisioningStoreState>),
  ) => void,
  config?: ProvisioningConfig,
): void {
  initializeServices(config);
  subscribeToServices(set);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProvisioningStore = create<
  ProvisioningStoreState & ProvisioningStoreActions
>()((set) => ({
  // -- Initial state --------------------------------------------------------
  ...initialState,

  // =========================================================================
  // Lifecycle
  // =========================================================================

  initialize: (config?: ProvisioningConfig) => {
    ensureInitialized(set, config);
  },

  destroy: () => {
    // Tear down event subscriptions
    for (const unsub of unsubscribers) {
      unsub();
    }
    unsubscribers = [];

    // Tear down services.  destroyServices() is async (BLE teardown), but
    // we reset store state immediately so the UI updates without waiting.
    // The BleTransport._destroyed flag prevents stale native callbacks from
    // surfacing after this point.
    void destroyServices();

    // Reset store state
    set(initialState);
  },

  // =========================================================================
  // BLE
  // =========================================================================

  startScan: () => {
    ensureInitialized(set);
    set({ discoveredDevices: [], scanning: true, bleError: null });
    getManager().scanForDevices();
  },

  stopScan: () => {
    ensureInitialized(set);
    getTransport().stopScan();
  },

  connectToDevice: async (deviceId: string) => {
    ensureInitialized(set);
    const transport = getTransport();
    await transport.connect(deviceId);
    const info = transport.connectedDevice;
    set({
      deviceId: info?.id ?? deviceId,
      deviceName: info?.name ?? '',
    });
  },

  disconnectDevice: () => {
    ensureInitialized(set);
    void getTransport().disconnect();
  },

  // =========================================================================
  // Direct protocol commands
  // =========================================================================

  getStatus: async () => {
    ensureInitialized(set);
    return getProtocol().getStatus();
  },

  scanNetworks: async () => {
    ensureInitialized(set);
    const result = await getProtocol().scan();
    return result.networks;
  },

  listNetworks: async () => {
    ensureInitialized(set);
    const result = await getProtocol().listNetworks();
    return result.networks;
  },

  addNetwork: async (params: AddNetworkParams) => {
    ensureInitialized(set);
    return getProtocol().addNetwork(params);
  },

  delNetwork: async (ssid: string) => {
    ensureInitialized(set);
    return getProtocol().delNetwork(ssid);
  },

  connectWifi: async (ssid?: string) => {
    ensureInitialized(set);
    return getProtocol().connectWifi(ssid);
  },

  disconnectWifi: async () => {
    ensureInitialized(set);
    return getProtocol().disconnectWifi();
  },

  getApStatus: async () => {
    ensureInitialized(set);
    return getProtocol().getApStatus();
  },

  startAp: async (params?: StartApParams) => {
    ensureInitialized(set);
    return getProtocol().startAp(params);
  },

  stopAp: async () => {
    ensureInitialized(set);
    return getProtocol().stopAp();
  },

  getVar: async (key: string) => {
    ensureInitialized(set);
    return getProtocol().getVar(key);
  },

  setVar: async (key: string, value: string) => {
    ensureInitialized(set);
    return getProtocol().setVar(key, value);
  },

  factoryReset: async () => {
    ensureInitialized(set);
    return getProtocol().factoryReset();
  },

  // =========================================================================
  // Provisioning flow (delegates to ProvisioningManager)
  // =========================================================================

  provisioningScanForDevices: () => {
    ensureInitialized(set);
    set({ discoveredDevices: [], scanning: true, bleError: null });
    getManager().scanForDevices();
  },

  provisioningConnectToDevice: async (deviceId: string) => {
    ensureInitialized(set);
    await getManager().connectToDevice(deviceId);
    const info = getTransport().connectedDevice;
    set({
      deviceId: info?.id ?? deviceId,
      deviceName: info?.name ?? '',
    });
  },

  provisioningScanWifiNetworks: async () => {
    ensureInitialized(set);
    await getManager().scanWifiNetworks();
  },

  provisioningSelectNetwork: (network: ScannedNetwork) => {
    ensureInitialized(set);
    getManager().selectNetwork(network);
  },

  provisioningSubmitCredentials: async (password: string) => {
    ensureInitialized(set);
    await getManager().submitCredentials(password);
  },

  provisioningRetryConnection: async () => {
    ensureInitialized(set);
    set({ connectionFailed: false, pollError: null });
    await getManager().retryConnection();
  },

  provisioningDeleteNetworkAndReturn: async () => {
    ensureInitialized(set);
    await getManager().deleteNetworkAndReturn();
  },

  provisioningGoToNetworks: () => {
    ensureInitialized(set);
    getManager().goToNetworks();
  },

  provisioningGoToManage: () => {
    ensureInitialized(set);
    getManager().goToManage();
  },

  provisioningReset: () => {
    ensureInitialized(set);
    void getManager().reset();
  },

  // =========================================================================
  // Poller
  // =========================================================================

  startPolling: (timeoutMs?: number, intervalMs?: number) => {
    ensureInitialized(set);
    set({ polling: true, pollError: null, connectionFailed: false });
    getPoller().startPolling(timeoutMs, intervalMs);
  },

  stopPolling: () => {
    ensureInitialized(set);
    getPoller().stopPolling();
    set({ polling: false });
  },

  pollOnce: async () => {
    ensureInitialized(set);
    return getPoller().pollOnce();
  },
}));
