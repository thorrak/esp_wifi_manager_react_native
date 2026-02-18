/**
 * Tests for the Zustand provisioning store (store/provisioningStore.ts).
 *
 * The store bridges service events to React state and delegates actions
 * to services. We mock the service factory so that all four services are
 * lightweight mock objects with event emitter capabilities.
 */

// Provide __DEV__ for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mock emitter (same pattern as ProvisioningManager tests)
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

class MockEmitter {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, new Set());
    }
    this.handlers.get(event)!.add(handler);
    return () => {
      this.handlers.get(event)?.delete(handler);
    };
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.handlers.get(event);
    if (set) {
      for (const h of set) {
        h(...args);
      }
    }
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}

// ---------------------------------------------------------------------------
// Mock service factories
// ---------------------------------------------------------------------------

function createMockTransport() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((event: string, handler: EventHandler) => emitter.on(event, handler)),
    off: jest.fn((event: string, handler: EventHandler) => emitter.off(event, handler)),
    startScan: jest.fn(),
    stopScan: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      id: 'dev-1',
      name: 'ESP32-WiFi-Test',
      mtu: 517,
    }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    writeCommand: jest.fn().mockResolvedValue(undefined),
    isConnected: false,
    connectedDevice: { id: 'dev-1', name: 'ESP32-WiFi-Test', mtu: 517 } as {
      id: string;
      name: string;
      mtu: number | null;
    } | null,
    connectionState: 'disconnected' as string,
    removeAllListeners: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockProtocol() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((event: string, handler: EventHandler) => emitter.on(event, handler)),
    off: jest.fn((event: string, handler: EventHandler) => emitter.off(event, handler)),
    getStatus: jest.fn().mockResolvedValue({
      state: 'disconnected',
      ssid: '',
      rssi: 0,
      quality: 0,
      ip: '',
      channel: 0,
      netmask: '',
      gateway: '',
      dns: '',
      mac: '',
      hostname: '',
      uptime_ms: 0,
      ap_active: false,
    }),
    scan: jest.fn().mockResolvedValue({
      networks: [{ ssid: 'TestWifi', rssi: -45, auth: 'WPA2' }],
    }),
    listNetworks: jest.fn().mockResolvedValue({
      networks: [{ ssid: 'SavedNet', priority: 5 }],
    }),
    addNetwork: jest.fn().mockResolvedValue(undefined),
    delNetwork: jest.fn().mockResolvedValue(undefined),
    connectWifi: jest.fn().mockResolvedValue(undefined),
    disconnectWifi: jest.fn().mockResolvedValue(undefined),
    getApStatus: jest.fn().mockResolvedValue({
      active: false,
      ssid: '',
      ip: '',
      sta_count: 0,
    }),
    startAp: jest.fn().mockResolvedValue(undefined),
    stopAp: jest.fn().mockResolvedValue(undefined),
    getVar: jest.fn().mockResolvedValue({ key: 'k', value: 'v' }),
    setVar: jest.fn().mockResolvedValue(undefined),
    factoryReset: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
  };
}

function createMockPoller() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((event: string, handler: EventHandler) => emitter.on(event, handler)),
    off: jest.fn((event: string, handler: EventHandler) => emitter.off(event, handler)),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    pollOnce: jest.fn().mockResolvedValue({
      state: 'disconnected',
      ssid: '',
      rssi: 0,
      quality: 0,
      ip: '',
      channel: 0,
      netmask: '',
      gateway: '',
      dns: '',
      mac: '',
      hostname: '',
      uptime_ms: 0,
      ap_active: false,
    }),
    reset: jest.fn(),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
  };
}

function createMockManager() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((event: string, handler: EventHandler) => emitter.on(event, handler)),
    off: jest.fn((event: string, handler: EventHandler) => emitter.off(event, handler)),
    scanForDevices: jest.fn().mockResolvedValue(undefined),
    connectToDevice: jest.fn().mockResolvedValue(undefined),
    scanWifiNetworks: jest.fn().mockResolvedValue(undefined),
    selectNetwork: jest.fn(),
    submitCredentials: jest.fn().mockResolvedValue(undefined),
    retryConnection: jest.fn().mockResolvedValue(undefined),
    deleteNetworkAndReturn: jest.fn().mockResolvedValue(undefined),
    goToNetworks: jest.fn(),
    goToManage: jest.fn(),
    reset: jest.fn().mockResolvedValue(undefined),
    removeAllListeners: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

// ---------------------------------------------------------------------------
// Create mock instances (module-level so the jest.mock factory can reference them)
// ---------------------------------------------------------------------------

let mockTransport: ReturnType<typeof createMockTransport>;
let mockProtocol: ReturnType<typeof createMockProtocol>;
let mockPoller: ReturnType<typeof createMockPoller>;
let mockManager: ReturnType<typeof createMockManager>;

// ---------------------------------------------------------------------------
// Mock the service factory BEFORE importing the store
// ---------------------------------------------------------------------------

jest.mock('../serviceFactory', () => ({
  initializeServices: jest.fn(),
  destroyServices: jest.fn(),
  getTransport: jest.fn(() => mockTransport),
  getProtocol: jest.fn(() => mockProtocol),
  getPoller: jest.fn(() => mockPoller),
  getManager: jest.fn(() => mockManager),
}));

// Now import the store (it will use the mocked factory).
import { useProvisioningStore } from '../store/provisioningStore';
import type { ProvisioningStoreState } from '../store/provisioningStore';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Get a snapshot of the current store state (excluding actions). */
function getState(): ProvisioningStoreState {
  const s = useProvisioningStore.getState();
  return {
    connectionState: s.connectionState,
    deviceName: s.deviceName,
    deviceId: s.deviceId,
    discoveredDevices: s.discoveredDevices,
    scanning: s.scanning,
    bleError: s.bleError,
    busy: s.busy,
    lastCommandError: s.lastCommandError,
    wifiState: s.wifiState,
    wifiSsid: s.wifiSsid,
    wifiIp: s.wifiIp,
    wifiRssi: s.wifiRssi,
    wifiQuality: s.wifiQuality,
    polling: s.polling,
    pollError: s.pollError,
    connectionFailed: s.connectionFailed,
    step: s.step,
    selectedNetwork: s.selectedNetwork,
    scannedNetworks: s.scannedNetworks,
    provisioningError: s.provisioningError,
  };
}

const expectedInitialState: ProvisioningStoreState = {
  connectionState: 'disconnected',
  deviceName: '',
  deviceId: null,
  discoveredDevices: [],
  scanning: false,
  bleError: null,
  busy: false,
  lastCommandError: null,
  wifiState: 'disconnected',
  wifiSsid: '',
  wifiIp: '',
  wifiRssi: 0,
  wifiQuality: 0,
  polling: false,
  pollError: null,
  connectionFailed: false,
  step: 'welcome',
  selectedNetwork: null,
  scannedNetworks: [],
  provisioningError: null,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisioningStore', () => {
  beforeEach(() => {
    // Create fresh mock services for each test.
    mockTransport = createMockTransport();
    mockProtocol = createMockProtocol();
    mockPoller = createMockPoller();
    mockManager = createMockManager();

    // Reset the store to initial state and tear down subscriptions.
    // We call destroy() to reset the module-level `subscribed` flag.
    useProvisioningStore.getState().destroy();
  });

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  describe('initial state', () => {
    it('has correct default values', () => {
      expect(getState()).toEqual(expectedInitialState);
    });
  });

  // --------------------------------------------------------------------------
  // initialize / destroy lifecycle
  // --------------------------------------------------------------------------

  describe('lifecycle', () => {
    it('initialize() calls initializeServices and subscribes to events', () => {
      const { initializeServices } = require('../serviceFactory');

      useProvisioningStore.getState().initialize();

      expect(initializeServices).toHaveBeenCalled();
      // Verify subscriptions were set up (transport.on, protocol.on, etc.).
      expect(mockTransport.on).toHaveBeenCalled();
      expect(mockProtocol.on).toHaveBeenCalled();
      expect(mockPoller.on).toHaveBeenCalled();
      expect(mockManager.on).toHaveBeenCalled();
    });

    it('initialize() passes config to initializeServices', () => {
      const { initializeServices } = require('../serviceFactory');
      const config = { ble: { deviceNamePrefix: 'Test-' } };

      useProvisioningStore.getState().initialize(config);

      expect(initializeServices).toHaveBeenCalledWith(config);
    });

    it('initialize() is idempotent (subscribes only once)', () => {
      useProvisioningStore.getState().initialize();
      const firstCallCount = mockTransport.on.mock.calls.length;

      useProvisioningStore.getState().initialize();
      const secondCallCount = mockTransport.on.mock.calls.length;

      // No additional subscriptions on second call.
      expect(secondCallCount).toBe(firstCallCount);
    });

    it('destroy() calls destroyServices and resets state', () => {
      const { destroyServices } = require('../serviceFactory');

      useProvisioningStore.getState().initialize();

      // Mutate some state.
      useProvisioningStore.setState({ scanning: true, step: 'networks' });

      useProvisioningStore.getState().destroy();

      expect(destroyServices).toHaveBeenCalled();
      expect(getState()).toEqual(expectedInitialState);
    });

    it('after destroy, re-initialize creates fresh subscriptions', () => {
      useProvisioningStore.getState().initialize();
      useProvisioningStore.getState().destroy();

      // Create fresh mocks for the second initialization.
      mockTransport = createMockTransport();
      mockProtocol = createMockProtocol();
      mockPoller = createMockPoller();
      mockManager = createMockManager();

      useProvisioningStore.getState().initialize();

      // New mock services should have received .on() calls.
      expect(mockTransport.on).toHaveBeenCalled();
      expect(mockManager.on).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Transport event subscriptions
  // --------------------------------------------------------------------------

  describe('transport event subscriptions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('connectionStateChanged updates store connectionState', () => {
      mockTransport._emitter.emit('connectionStateChanged', 'connecting');

      expect(useProvisioningStore.getState().connectionState).toBe('connecting');
    });

    it('deviceDiscovered adds device to discoveredDevices', () => {
      const device = { id: 'dev-1', name: 'ESP32-WiFi-A1', rssi: -55 };
      mockTransport._emitter.emit('deviceDiscovered', device);

      expect(useProvisioningStore.getState().discoveredDevices).toEqual([device]);
    });

    it('deviceDiscovered deduplicates by id', () => {
      const device1 = { id: 'dev-1', name: 'ESP32-WiFi-A1', rssi: -55 };
      const device1Updated = { id: 'dev-1', name: 'ESP32-WiFi-A1', rssi: -40 };
      const device2 = { id: 'dev-2', name: 'ESP32-WiFi-B2', rssi: -60 };

      mockTransport._emitter.emit('deviceDiscovered', device1);
      mockTransport._emitter.emit('deviceDiscovered', device2);
      mockTransport._emitter.emit('deviceDiscovered', device1Updated);

      const devices = useProvisioningStore.getState().discoveredDevices;
      expect(devices).toHaveLength(2);
      // device1 should be replaced by device1Updated (at the end).
      expect(devices.find((d) => d.id === 'dev-1')?.rssi).toBe(-40);
      expect(devices.find((d) => d.id === 'dev-2')).toBeDefined();
    });

    it('scanStopped sets scanning to false', () => {
      useProvisioningStore.setState({ scanning: true });

      mockTransport._emitter.emit('scanStopped');

      expect(useProvisioningStore.getState().scanning).toBe(false);
    });

    it('error sets bleError', () => {
      mockTransport._emitter.emit('error', new Error('BLE scan error'));

      expect(useProvisioningStore.getState().bleError).toBe('BLE scan error');
    });
  });

  // --------------------------------------------------------------------------
  // Protocol event subscriptions
  // --------------------------------------------------------------------------

  describe('protocol event subscriptions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('busyChanged updates store busy', () => {
      mockProtocol._emitter.emit('busyChanged', true);
      expect(useProvisioningStore.getState().busy).toBe(true);

      mockProtocol._emitter.emit('busyChanged', false);
      expect(useProvisioningStore.getState().busy).toBe(false);
    });

    it('commandError updates store lastCommandError', () => {
      mockProtocol._emitter.emit('commandError', new Error('Timeout'));

      expect(useProvisioningStore.getState().lastCommandError).toBe('Timeout');
    });
  });

  // --------------------------------------------------------------------------
  // Poller event subscriptions
  // --------------------------------------------------------------------------

  describe('poller event subscriptions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('wifiStateChanged updates wifi fields', () => {
      mockPoller._emitter.emit('wifiStateChanged', {
        state: 'connected',
        ssid: 'MyWifi',
        ip: '192.168.1.42',
        rssi: -35,
        quality: 80,
      });

      const s = useProvisioningStore.getState();
      expect(s.wifiState).toBe('connected');
      expect(s.wifiSsid).toBe('MyWifi');
      expect(s.wifiIp).toBe('192.168.1.42');
      expect(s.wifiRssi).toBe(-35);
      expect(s.wifiQuality).toBe(80);
    });

    it('wifiStateChanged defaults missing fields to zero/empty', () => {
      mockPoller._emitter.emit('wifiStateChanged', {
        state: 'disconnected',
      });

      const s = useProvisioningStore.getState();
      expect(s.wifiState).toBe('disconnected');
      expect(s.wifiSsid).toBe('');
      expect(s.wifiIp).toBe('');
      expect(s.wifiRssi).toBe(0);
      expect(s.wifiQuality).toBe(0);
    });

    it('connectionSucceeded sets polling to false', () => {
      useProvisioningStore.setState({ polling: true });

      mockPoller._emitter.emit('connectionSucceeded');

      expect(useProvisioningStore.getState().polling).toBe(false);
    });

    it('connectionFailed sets connectionFailed and stops polling', () => {
      useProvisioningStore.setState({ polling: true });

      mockPoller._emitter.emit('connectionFailed');

      const s = useProvisioningStore.getState();
      expect(s.connectionFailed).toBe(true);
      expect(s.polling).toBe(false);
    });

    it('connectionTimedOut sets pollError and stops polling', () => {
      useProvisioningStore.setState({ polling: true });

      mockPoller._emitter.emit('connectionTimedOut');

      const s = useProvisioningStore.getState();
      expect(s.pollError).toBe('Connection timed out');
      expect(s.polling).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Manager event subscriptions
  // --------------------------------------------------------------------------

  describe('manager event subscriptions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('stepChanged updates store step', () => {
      mockManager._emitter.emit('stepChanged', 'networks');

      expect(useProvisioningStore.getState().step).toBe('networks');
    });

    it('stepChanged to "connecting" sets polling=true, clears pollError and connectionFailed', () => {
      useProvisioningStore.setState({
        pollError: 'old error',
        connectionFailed: true,
      });

      mockManager._emitter.emit('stepChanged', 'connecting');

      const s = useProvisioningStore.getState();
      expect(s.step).toBe('connecting');
      expect(s.polling).toBe(true);
      expect(s.pollError).toBeNull();
      expect(s.connectionFailed).toBe(false);
    });

    it('stepChanged to non-connecting step does not affect polling', () => {
      useProvisioningStore.setState({ polling: false });

      mockManager._emitter.emit('stepChanged', 'credentials');

      const s = useProvisioningStore.getState();
      expect(s.step).toBe('credentials');
      expect(s.polling).toBe(false);
    });

    it('scannedNetworksUpdated updates store scannedNetworks', () => {
      const networks = [
        { ssid: 'Net1', rssi: -40, auth: 'WPA2' },
        { ssid: 'Net2', rssi: -65, auth: 'WPA' },
      ];

      mockManager._emitter.emit('scannedNetworksUpdated', networks);

      expect(useProvisioningStore.getState().scannedNetworks).toEqual(networks);
    });

    it('selectedNetworkChanged updates store selectedNetwork', () => {
      const network = { ssid: 'TestWifi', rssi: -45, auth: 'WPA2' as const };

      mockManager._emitter.emit('selectedNetworkChanged', network);
      expect(useProvisioningStore.getState().selectedNetwork).toEqual(network);

      // Also test setting to null.
      mockManager._emitter.emit('selectedNetworkChanged', null);
      expect(useProvisioningStore.getState().selectedNetwork).toBeNull();
    });

    it('provisioningError updates store provisioningError', () => {
      mockManager._emitter.emit('provisioningError', 'Something went wrong');

      expect(useProvisioningStore.getState().provisioningError).toBe(
        'Something went wrong',
      );
    });

    it('provisioningError can be cleared with null', () => {
      useProvisioningStore.setState({ provisioningError: 'old error' });

      mockManager._emitter.emit('provisioningError', null);

      expect(useProvisioningStore.getState().provisioningError).toBeNull();
    });

    it('provisioningReset resets store to initial state', () => {
      // Set some non-default state first.
      useProvisioningStore.setState({
        step: 'success',
        scanning: true,
        wifiSsid: 'MyWifi',
        polling: true,
        connectionFailed: true,
        discoveredDevices: [{ id: 'd1', name: 'D1', rssi: -50 }],
      });

      mockManager._emitter.emit('provisioningReset');

      expect(getState()).toEqual(expectedInitialState);
    });
  });

  // --------------------------------------------------------------------------
  // Store actions: BLE
  // --------------------------------------------------------------------------

  describe('BLE actions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('startScan() clears devices, sets scanning, calls manager.scanForDevices()', () => {
      // Pre-populate some devices.
      useProvisioningStore.setState({
        discoveredDevices: [{ id: 'd1', name: 'D1', rssi: -50 }],
        bleError: 'old error',
      });

      useProvisioningStore.getState().startScan();

      const s = useProvisioningStore.getState();
      expect(s.discoveredDevices).toEqual([]);
      expect(s.scanning).toBe(true);
      expect(s.bleError).toBeNull();
      expect(mockManager.scanForDevices).toHaveBeenCalledTimes(1);
    });

    it('stopScan() calls transport.stopScan()', () => {
      useProvisioningStore.getState().stopScan();

      expect(mockTransport.stopScan).toHaveBeenCalledTimes(1);
    });

    it('connectToDevice() calls transport.connect() and sets deviceId/deviceName', async () => {
      await useProvisioningStore.getState().connectToDevice('dev-1');

      expect(mockTransport.connect).toHaveBeenCalledWith('dev-1');
      const s = useProvisioningStore.getState();
      expect(s.deviceId).toBe('dev-1');
      expect(s.deviceName).toBe('ESP32-WiFi-Test');
    });

    it('connectToDevice() uses deviceId as fallback when connectedDevice is null', async () => {
      mockTransport.connectedDevice = null;

      await useProvisioningStore.getState().connectToDevice('dev-xyz');

      const s = useProvisioningStore.getState();
      expect(s.deviceId).toBe('dev-xyz');
      expect(s.deviceName).toBe('');
    });

    it('disconnectDevice() calls transport.disconnect()', () => {
      useProvisioningStore.getState().disconnectDevice();

      expect(mockTransport.disconnect).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Store actions: Direct protocol commands
  // --------------------------------------------------------------------------

  describe('direct protocol commands', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('getStatus() delegates to protocol.getStatus()', async () => {
      const result = await useProvisioningStore.getState().getStatus();

      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('state');
    });

    it('scanNetworks() calls protocol.scan() and returns networks array', async () => {
      const result = await useProvisioningStore.getState().scanNetworks();

      expect(mockProtocol.scan).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ ssid: 'TestWifi', rssi: -45, auth: 'WPA2' }]);
    });

    it('listNetworks() calls protocol.listNetworks() and returns networks', async () => {
      const result = await useProvisioningStore.getState().listNetworks();

      expect(mockProtocol.listNetworks).toHaveBeenCalledTimes(1);
      expect(result).toEqual([{ ssid: 'SavedNet', priority: 5 }]);
    });

    it('addNetwork() delegates to protocol.addNetwork()', async () => {
      const params = { ssid: 'NewNet', password: 'pass123', priority: 5 };
      await useProvisioningStore.getState().addNetwork(params);

      expect(mockProtocol.addNetwork).toHaveBeenCalledWith(params);
    });

    it('delNetwork() delegates to protocol.delNetwork()', async () => {
      await useProvisioningStore.getState().delNetwork('OldNet');

      expect(mockProtocol.delNetwork).toHaveBeenCalledWith('OldNet');
    });

    it('connectWifi() delegates to protocol.connectWifi()', async () => {
      await useProvisioningStore.getState().connectWifi('MyNet');

      expect(mockProtocol.connectWifi).toHaveBeenCalledWith('MyNet');
    });

    it('connectWifi() works without ssid argument', async () => {
      await useProvisioningStore.getState().connectWifi();

      expect(mockProtocol.connectWifi).toHaveBeenCalledWith(undefined);
    });

    it('disconnectWifi() delegates to protocol.disconnectWifi()', async () => {
      await useProvisioningStore.getState().disconnectWifi();

      expect(mockProtocol.disconnectWifi).toHaveBeenCalledTimes(1);
    });

    it('getApStatus() delegates to protocol.getApStatus()', async () => {
      const result = await useProvisioningStore.getState().getApStatus();

      expect(mockProtocol.getApStatus).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('active');
    });

    it('startAp() delegates to protocol.startAp()', async () => {
      const params = { ssid: 'MyAP', password: 'appass' };
      await useProvisioningStore.getState().startAp(params);

      expect(mockProtocol.startAp).toHaveBeenCalledWith(params);
    });

    it('stopAp() delegates to protocol.stopAp()', async () => {
      await useProvisioningStore.getState().stopAp();

      expect(mockProtocol.stopAp).toHaveBeenCalledTimes(1);
    });

    it('getVar() delegates to protocol.getVar()', async () => {
      const result = await useProvisioningStore.getState().getVar('firmware');

      expect(mockProtocol.getVar).toHaveBeenCalledWith('firmware');
      expect(result).toEqual({ key: 'k', value: 'v' });
    });

    it('setVar() delegates to protocol.setVar()', async () => {
      await useProvisioningStore.getState().setVar('hostname', 'my-device');

      expect(mockProtocol.setVar).toHaveBeenCalledWith('hostname', 'my-device');
    });

    it('factoryReset() delegates to protocol.factoryReset()', async () => {
      await useProvisioningStore.getState().factoryReset();

      expect(mockProtocol.factoryReset).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Store actions: Provisioning flow
  // --------------------------------------------------------------------------

  describe('provisioning flow actions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('provisioningScanForDevices() clears state and calls manager.scanForDevices()', () => {
      useProvisioningStore.setState({
        discoveredDevices: [{ id: 'd1', name: 'D1', rssi: -50 }],
        bleError: 'old',
      });

      useProvisioningStore.getState().provisioningScanForDevices();

      const s = useProvisioningStore.getState();
      expect(s.discoveredDevices).toEqual([]);
      expect(s.scanning).toBe(true);
      expect(s.bleError).toBeNull();
      expect(mockManager.scanForDevices).toHaveBeenCalledTimes(1);
    });

    it('provisioningConnectToDevice() calls manager.connectToDevice() and sets device info', async () => {
      await useProvisioningStore.getState().provisioningConnectToDevice('dev-1');

      expect(mockManager.connectToDevice).toHaveBeenCalledWith('dev-1');
      const s = useProvisioningStore.getState();
      expect(s.deviceId).toBe('dev-1');
      expect(s.deviceName).toBe('ESP32-WiFi-Test');
    });

    it('provisioningConnectToDevice() uses deviceId fallback when connectedDevice is null', async () => {
      mockTransport.connectedDevice = null;

      await useProvisioningStore.getState().provisioningConnectToDevice('dev-xyz');

      const s = useProvisioningStore.getState();
      expect(s.deviceId).toBe('dev-xyz');
      expect(s.deviceName).toBe('');
    });

    it('provisioningScanWifiNetworks() calls manager.scanWifiNetworks()', async () => {
      await useProvisioningStore.getState().provisioningScanWifiNetworks();

      expect(mockManager.scanWifiNetworks).toHaveBeenCalledTimes(1);
    });

    it('provisioningSelectNetwork() calls manager.selectNetwork()', () => {
      const network = { ssid: 'TestWifi', rssi: -45, auth: 'WPA2' as const };

      useProvisioningStore.getState().provisioningSelectNetwork(network);

      expect(mockManager.selectNetwork).toHaveBeenCalledWith(network);
    });

    it('provisioningSubmitCredentials() calls manager.submitCredentials()', async () => {
      await useProvisioningStore.getState().provisioningSubmitCredentials('secret');

      expect(mockManager.submitCredentials).toHaveBeenCalledWith('secret');
    });

    it('provisioningRetryConnection() clears failure state and calls manager.retryConnection()', async () => {
      useProvisioningStore.setState({
        connectionFailed: true,
        pollError: 'timed out',
      });

      await useProvisioningStore.getState().provisioningRetryConnection();

      const s = useProvisioningStore.getState();
      expect(s.connectionFailed).toBe(false);
      expect(s.pollError).toBeNull();
      expect(mockManager.retryConnection).toHaveBeenCalledTimes(1);
    });

    it('provisioningDeleteNetworkAndReturn() calls manager.deleteNetworkAndReturn()', async () => {
      await useProvisioningStore.getState().provisioningDeleteNetworkAndReturn();

      expect(mockManager.deleteNetworkAndReturn).toHaveBeenCalledTimes(1);
    });

    it('provisioningGoToNetworks() calls manager.goToNetworks()', () => {
      useProvisioningStore.getState().provisioningGoToNetworks();

      expect(mockManager.goToNetworks).toHaveBeenCalledTimes(1);
    });

    it('provisioningGoToManage() calls manager.goToManage()', () => {
      useProvisioningStore.getState().provisioningGoToManage();

      expect(mockManager.goToManage).toHaveBeenCalledTimes(1);
    });

    it('provisioningReset() calls manager.reset()', () => {
      useProvisioningStore.getState().provisioningReset();

      expect(mockManager.reset).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Store actions: Poller
  // --------------------------------------------------------------------------

  describe('poller actions', () => {
    beforeEach(() => {
      useProvisioningStore.getState().initialize();
    });

    it('startPolling() sets polling state and calls poller.startPolling()', () => {
      useProvisioningStore.getState().startPolling(30000, 2000);

      const s = useProvisioningStore.getState();
      expect(s.polling).toBe(true);
      expect(s.pollError).toBeNull();
      expect(s.connectionFailed).toBe(false);
      expect(mockPoller.startPolling).toHaveBeenCalledWith(30000, 2000);
    });

    it('startPolling() works with default arguments', () => {
      useProvisioningStore.getState().startPolling();

      expect(mockPoller.startPolling).toHaveBeenCalledWith(undefined, undefined);
      expect(useProvisioningStore.getState().polling).toBe(true);
    });

    it('stopPolling() calls poller.stopPolling() and sets polling to false', () => {
      useProvisioningStore.setState({ polling: true });

      useProvisioningStore.getState().stopPolling();

      expect(mockPoller.stopPolling).toHaveBeenCalledTimes(1);
      expect(useProvisioningStore.getState().polling).toBe(false);
    });

    it('pollOnce() delegates to poller.pollOnce()', async () => {
      const result = await useProvisioningStore.getState().pollOnce();

      expect(mockPoller.pollOnce).toHaveBeenCalledTimes(1);
      expect(result).toHaveProperty('state');
    });
  });

  // --------------------------------------------------------------------------
  // ensureInitialized auto-initialization
  // --------------------------------------------------------------------------

  describe('ensureInitialized', () => {
    it('actions auto-initialize services on first call', () => {
      const { initializeServices } = require('../serviceFactory');

      // Do not call initialize() explicitly — just call an action directly.
      useProvisioningStore.getState().stopScan();

      expect(initializeServices).toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Event unsubscription on destroy
  // --------------------------------------------------------------------------

  describe('event unsubscription on destroy', () => {
    it('events no longer reach the store after destroy', () => {
      useProvisioningStore.getState().initialize();

      // Verify events work before destroy.
      mockTransport._emitter.emit('connectionStateChanged', 'connecting');
      expect(useProvisioningStore.getState().connectionState).toBe('connecting');

      // Destroy the store.
      useProvisioningStore.getState().destroy();

      // Events should no longer update the store.
      mockTransport._emitter.emit('connectionStateChanged', 'connected');
      expect(useProvisioningStore.getState().connectionState).toBe('disconnected');
    });
  });
});
