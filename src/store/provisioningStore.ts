/**
 * Zustand store — bridges the four service layers into React.
 *
 * Two responsibilities:
 *   1. Mirror service state into Zustand state via event subscriptions
 *   2. Expose actions that delegate to services (verb-named, 1:1 with manager)
 *
 * The store IS the canonical reactive state surface. Hooks read from it; the
 * manager emits events that fan out into store updates. Service event
 * subscriptions are wired lazily on first action call (`ensureInitialized`).
 */

import { create } from 'zustand';

import {
  destroyServices,
  getManager,
  getPoller,
  getProtocol,
  getTransport,
  initializeServices,
} from '../serviceFactory';

import type {
  AddNetworkParams,
  ApStatus,
  DeviceConnection,
  DeviceVariable,
  DiscoveredDevice,
  ProvisioningConfig,
  ProvisioningError,
  ProvisioningResult,
  ProvisioningStep,
  SavedNetwork,
  ScanCompletedInfo,
  ScannedNetwork,
  StartApParams,
  WifiConnectionState,
  WifiStatus,
} from '../types';

// ---------------------------------------------------------------------------
// State interface
// ---------------------------------------------------------------------------

export interface ProvisioningStoreState {
  // -- Wizard --
  /** Current step in the provisioning state machine. */
  step: ProvisioningStep;
  /** Most recent unified error envelope, or `null` when no error is active. */
  error: ProvisioningError | null;
  /** Latest successful result. Survives `cancel()`; cleared on next `start()`. */
  lastResult: ProvisioningResult | null;

  // -- Devices --
  /** Discovered (but not yet selected) devices from the most recent scan. */
  discoveredDevices: DiscoveredDevice[];
  /** Connection target / current connected device, or `null` when idle. */
  device: DeviceConnection;
  /** Whether a BLE scan is currently in progress. */
  scanning: boolean;
  /** Diagnostics from the most recent completed scan. */
  lastScanResult: ScanCompletedInfo | null;

  // -- WiFi --
  /** Networks returned by the most recent WiFi scan, RSSI-sorted. */
  scannedNetworks: ScannedNetwork[];
  /** Currently selected network (during credential entry / join). */
  selectedNetwork: ScannedNetwork | null;
  /** Live WiFi state from the device while polling. */
  wifiState: WifiConnectionState;
  wifiSsid: string;
  wifiIp: string;
  wifiRssi: number;
  wifiQuality: number;
  /** Whether the connection poller is currently running. */
  polling: boolean;
}

// ---------------------------------------------------------------------------
// Actions interface
// ---------------------------------------------------------------------------

export interface ProvisioningStoreActions {
  // -- Lifecycle --
  initialize: (config?: ProvisioningConfig) => void;
  destroy: () => void;

  // -- Wizard verbs (delegate to ProvisioningManager) --
  start: () => Promise<void>;
  chooseDevice: (target: DiscoveredDevice) => Promise<void>;
  proceedFromConfigure: () => Promise<void>;
  rescanWifi: () => Promise<void>;
  chooseNetwork: (network: ScannedNetwork) => void;
  backToNetworks: () => void;
  submitPassword: (password: string) => Promise<void>;
  retryJoin: () => Promise<void>;
  pickDifferentNetwork: () => Promise<void>;
  pickDifferentDevice: () => Promise<void>;
  cancel: () => Promise<void>;
  goToManage: () => void;

  // -- Direct protocol commands (for advanced/headless paths) --
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

  // -- Poller (advanced) --
  startPolling: (timeoutMs?: number, intervalMs?: number) => void;
  stopPolling: () => void;
  pollOnce: () => Promise<WifiStatus>;
}

// ---------------------------------------------------------------------------
// Default state values
// ---------------------------------------------------------------------------

const initialState: ProvisioningStoreState = {
  step: 'welcome',
  error: null,
  lastResult: null,

  discoveredDevices: [],
  device: null,
  scanning: false,
  lastScanResult: null,

  scannedNetworks: [],
  selectedNetwork: null,
  wifiState: 'disconnected',
  wifiSsid: '',
  wifiIp: '',
  wifiRssi: 0,
  wifiQuality: 0,
  polling: false,
};

// ---------------------------------------------------------------------------
// Module-level subscription tracking
// ---------------------------------------------------------------------------

let unsubscribers: Array<() => void> = [];
// Identity of the manager we're currently subscribed to. We track this (not
// just the unsubscribers array length) so that if `destroyServices()` is
// called externally and a fresh manager is created on the next
// `initializeServices()`, we detect the change and re-wire — instead of
// leaking subscriptions to the dead emitter and silently dropping events.
let subscribedManager: object | null = null;

type SetState = (
  partial:
    | Partial<ProvisioningStoreState>
    | ((state: ProvisioningStoreState) => Partial<ProvisioningStoreState>),
) => void;

/**
 * Subscribe to all service events and sync state. Detects when the
 * underlying services have been replaced (via destroyServices() +
 * initializeServices()) and re-wires against the new manager.
 */
function subscribeToServices(set: SetState): void {
  const manager = getManager();
  if (subscribedManager === manager) return;

  // Different manager (or first time) — tear down any stale subscriptions
  // before re-wiring.
  for (const unsub of unsubscribers) unsub();
  unsubscribers = [];
  subscribedManager = manager;

  const transport = getTransport();
  const poller = getPoller();

  // -- Transport ------------------------------------------------------------

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

  // -- Poller ---------------------------------------------------------------

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
      set({ polling: false });
    }),
  );

  unsubscribers.push(
    poller.on('connectionTimedOut', () => {
      set({ polling: false });
    }),
  );

  // -- Manager --------------------------------------------------------------

  unsubscribers.push(
    manager.on('stepChanged', (step) => {
      const updates: Partial<ProvisioningStoreState> = { step };
      if (step === 'joiningWifi') updates.polling = true;
      set(updates);
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
    manager.on('provisioningReset', () => {
      // Note: lastResult is intentionally preserved across reset so the
      // success screen still has data after the device drops BLE post-join.
      set((s) => ({
        ...initialState,
        lastResult: s.lastResult,
      }));
    }),
  );
}

/** Ensure services + subscriptions are wired. Safe to call from any action. */
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

  // =========================================================================
  // Lifecycle
  // =========================================================================

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

  // =========================================================================
  // Wizard verbs — delegate to ProvisioningManager
  // =========================================================================

  start: async () => {
    ensureInitialized(set);
    // Clear lastResult at the start of a new run so the success screen from
    // a previous provisioning doesn't leak into this one.
    set({ lastResult: null, discoveredDevices: [] });
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

  retryJoin: async () => {
    ensureInitialized(set);
    await getManager().retryJoin();
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

  addNetwork: async (params) => {
    ensureInitialized(set);
    return getProtocol().addNetwork(params);
  },

  delNetwork: async (ssid) => {
    ensureInitialized(set);
    return getProtocol().delNetwork(ssid);
  },

  connectWifi: async (ssid) => {
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

  startAp: async (params) => {
    ensureInitialized(set);
    return getProtocol().startAp(params);
  },

  stopAp: async () => {
    ensureInitialized(set);
    return getProtocol().stopAp();
  },

  getVar: async (key) => {
    ensureInitialized(set);
    return getProtocol().getVar(key);
  },

  setVar: async (key, value) => {
    ensureInitialized(set);
    return getProtocol().setVar(key, value);
  },

  factoryReset: async () => {
    ensureInitialized(set);
    return getProtocol().factoryReset();
  },

  // =========================================================================
  // Poller (advanced)
  // =========================================================================

  startPolling: (timeoutMs, intervalMs) => {
    ensureInitialized(set);
    set({ polling: true });
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
