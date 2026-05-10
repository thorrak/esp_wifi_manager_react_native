/**
 * Zustand store — bridges the service layers into React.
 *
 * v2 differences from v1:
 *   - No `polling` / WiFi-state fields. The SDK's atomic provision() call
 *     replaces the poller, so the store no longer carries `wifiState`,
 *     `wifiSsid`, `wifiIp`, `wifiRssi`, `wifiQuality`, `polling`.
 *   - No `addNetwork` / `delNetwork` / `connectWifi` / `disconnectWifi`
 *     / `getApStatus` / `startAp` / `stopAp` / `factoryReset` actions —
 *     those endpoints don't exist in the new firmware protocol.
 *   - New: `getVersion`, `getCapabilities`, `getNetworkPolicy`,
 *     `listVars`, `delVar` actions for the custom protocomm endpoints.
 */

import { create } from 'zustand';

import {
  destroyServices,
  getManager,
  getProtocol,
  getTransport,
  initializeServices,
} from '../serviceFactory';

import type {
  DeviceCapabilities,
  DeviceConnection,
  DeviceNetworkPolicy,
  DeviceVariable,
  DeviceVersionInfo,
  DiscoveredDevice,
  ProvisioningConfig,
  ProvisioningError,
  ProvisioningResult,
  ProvisioningStep,
  ProvisionResult,
  ScanCompletedInfo,
  ScannedNetwork,
} from '../types';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

export interface ProvisioningStoreState {
  // -- Wizard --
  step: ProvisioningStep;
  error: ProvisioningError | null;
  /** Latest successful result. Survives `cancel()`; cleared on next `start()`. */
  lastResult: ProvisioningResult | null;
  /** Most recent SDK provision() result. Cleared when starting a new run. */
  lastProvisionResult: ProvisionResult | null;

  // -- Devices --
  discoveredDevices: DiscoveredDevice[];
  device: DeviceConnection;
  scanning: boolean;
  lastScanResult: ScanCompletedInfo | null;

  // -- WiFi --
  scannedNetworks: ScannedNetwork[];
  selectedNetwork: ScannedNetwork | null;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export interface ProvisioningStoreActions {
  // -- Lifecycle --
  initialize: (config?: ProvisioningConfig) => void;
  destroy: () => void;

  // -- Wizard verbs --
  start: () => Promise<void>;
  chooseDevice: (target: DiscoveredDevice) => Promise<void>;
  proceedFromConfigure: () => Promise<void>;
  rescanWifi: () => Promise<void>;
  chooseNetwork: (network: ScannedNetwork) => void;
  backToNetworks: () => void;
  submitPassword: (password: string) => Promise<void>;
  retryJoin: (password?: string) => Promise<void>;
  pickDifferentNetwork: () => Promise<void>;
  pickDifferentDevice: () => Promise<void>;
  cancel: () => Promise<void>;
  goToManage: () => void;

  // -- Direct protocol commands --
  scanWifi: () => Promise<ScannedNetwork[]>;
  getVersion: () => Promise<DeviceVersionInfo>;
  getCapabilities: () => Promise<DeviceCapabilities>;
  getNetworkPolicy: () => Promise<DeviceNetworkPolicy>;
  listVars: () => Promise<DeviceVariable[]>;
  getVar: (key: string) => Promise<DeviceVariable | null>;
  setVar: (key: string, value: string) => Promise<void>;
  delVar: (key: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Default state
// ---------------------------------------------------------------------------

const initialState: ProvisioningStoreState = {
  step: 'welcome',
  error: null,
  lastResult: null,
  lastProvisionResult: null,

  discoveredDevices: [],
  device: null,
  scanning: false,
  lastScanResult: null,

  scannedNetworks: [],
  selectedNetwork: null,
};

// ---------------------------------------------------------------------------
// Subscription wiring
// ---------------------------------------------------------------------------

let unsubscribers: Array<() => void> = [];
let subscribedManager: object | null = null;

type SetState = (
  partial:
    | Partial<ProvisioningStoreState>
    | ((state: ProvisioningStoreState) => Partial<ProvisioningStoreState>),
) => void;

function subscribeToServices(set: SetState): void {
  const manager = getManager();
  if (subscribedManager === manager) return;

  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  subscribedManager = manager;

  const transport = getTransport();

  // Transport
  unsubscribers.push(
    transport.on('connectionStateChanged', (state) => {
      set({ scanning: state === 'scanning' });
    }),
  );
  unsubscribers.push(
    transport.on('deviceDiscovered', (device) => {
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
    transport.on('scanCompleted', (info) => {
      set({ lastScanResult: info });
    }),
  );

  // Manager
  unsubscribers.push(
    manager.on('stepChanged', (step) => {
      set({ step });
    }),
  );
  unsubscribers.push(
    manager.on('errorChanged', (error) => {
      set({ error });
    }),
  );
  unsubscribers.push(
    manager.on('scannedNetworksUpdated', (networks) => {
      set({ scannedNetworks: networks });
    }),
  );
  unsubscribers.push(
    manager.on('selectedNetworkChanged', (network) => {
      set({ selectedNetwork: network });
    }),
  );
  unsubscribers.push(
    manager.on('deviceConnectionChanged', (device) => {
      set({ device });
    }),
  );
  unsubscribers.push(
    manager.on('provisioningComplete', (result) => {
      set({ lastResult: result });
    }),
  );
  unsubscribers.push(
    manager.on('provisionResult', (result) => {
      set({ lastProvisionResult: result });
    }),
  );
  unsubscribers.push(
    manager.on('provisioningReset', () => {
      set((s) => ({
        ...initialState,
        lastResult: s.lastResult,
      }));
    }),
  );
}

function ensureInitialized(set: SetState, config?: ProvisioningConfig): void {
  initializeServices(config);
  subscribeToServices(set);
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useProvisioningStore = create<
  ProvisioningStoreState & ProvisioningStoreActions
>()((set) => ({
  ...initialState,

  // Lifecycle
  initialize: (config) => {
    ensureInitialized(set, config);
  },

  destroy: () => {
    for (const unsub of unsubscribers) unsub();
    unsubscribers = [];
    subscribedManager = null;
    void destroyServices();
    set(initialState);
  },

  // Wizard verbs
  start: async () => {
    ensureInitialized(set);
    set({
      lastResult: null,
      lastProvisionResult: null,
      discoveredDevices: [],
    });
    await getManager().start();
  },

  chooseDevice: async (target) => {
    ensureInitialized(set);
    await getManager().chooseDevice(target);
  },

  proceedFromConfigure: async () => {
    ensureInitialized(set);
    await getManager().proceedFromConfigure();
  },

  rescanWifi: async () => {
    ensureInitialized(set);
    await getManager().rescanWifi();
  },

  chooseNetwork: (network) => {
    ensureInitialized(set);
    getManager().chooseNetwork(network);
  },

  backToNetworks: () => {
    ensureInitialized(set);
    getManager().backToNetworks();
  },

  submitPassword: async (password) => {
    ensureInitialized(set);
    await getManager().submitPassword(password);
  },

  retryJoin: async (password) => {
    ensureInitialized(set);
    await getManager().retryJoin(password);
  },

  pickDifferentNetwork: async () => {
    ensureInitialized(set);
    await getManager().pickDifferentNetwork();
  },

  pickDifferentDevice: async () => {
    ensureInitialized(set);
    set({ discoveredDevices: [] });
    await getManager().pickDifferentDevice();
  },

  cancel: async () => {
    ensureInitialized(set);
    await getManager().cancel();
  },

  goToManage: () => {
    ensureInitialized(set);
    getManager().goToManage();
  },

  // Direct protocol commands
  scanWifi: async () => {
    ensureInitialized(set);
    return getProtocol().scanWifi();
  },
  getVersion: async () => {
    ensureInitialized(set);
    return getProtocol().getVersion();
  },
  getCapabilities: async () => {
    ensureInitialized(set);
    return getProtocol().getCapabilities();
  },
  getNetworkPolicy: async () => {
    ensureInitialized(set);
    return getProtocol().getNetworkPolicy();
  },
  listVars: async () => {
    ensureInitialized(set);
    return getProtocol().listVars();
  },
  getVar: async (key) => {
    ensureInitialized(set);
    return getProtocol().getVar(key);
  },
  setVar: async (key, value) => {
    ensureInitialized(set);
    return getProtocol().setVar(key, value);
  },
  delVar: async (key) => {
    ensureInitialized(set);
    return getProtocol().delVar(key);
  },
}));
