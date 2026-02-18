/**
 * Tests for the 8 React hooks in src/hooks/.
 *
 * All hooks are thin selectors over the Zustand provisioning store.
 * Five hooks (useDeviceScanner, useBleConnection, useWifiStatus,
 * useDeviceProtocol, useProvisioning) are pure store selectors.
 * Three hooks (useSavedNetworks, useAccessPoint, useDeviceVariables) add
 * local React state (useState/useCallback/useEffect) on top.
 *
 * Testing approach:
 *   - Verify each hook is exported and the store fields it depends on exist
 *   - Verify store actions that hooks delegate to are present and callable
 *   - For hooks with local state, test the underlying store actions they use
 *   - Verify the stepNumber() helper used by useProvisioning
 */

(globalThis as Record<string, unknown>).__DEV__ = false;

// ---------------------------------------------------------------------------
// Mock emitter (same pattern as provisioningStore.test.ts)
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
      networks: [
        { ssid: 'SavedNet1', priority: 5 },
        { ssid: 'SavedNet2', priority: 3 },
      ],
    }),
    addNetwork: jest.fn().mockResolvedValue(undefined),
    delNetwork: jest.fn().mockResolvedValue(undefined),
    connectWifi: jest.fn().mockResolvedValue(undefined),
    disconnectWifi: jest.fn().mockResolvedValue(undefined),
    getApStatus: jest.fn().mockResolvedValue({
      active: true,
      ssid: 'ESP32-AP',
      ip: '192.168.4.1',
      sta_count: 2,
    }),
    startAp: jest.fn().mockResolvedValue(undefined),
    stopAp: jest.fn().mockResolvedValue(undefined),
    getVar: jest.fn().mockResolvedValue({ key: 'firmware', value: '1.0.0' }),
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
      state: 'connected',
      ssid: 'MyWifi',
      rssi: -40,
      quality: 75,
      ip: '192.168.1.42',
      channel: 6,
      netmask: '255.255.255.0',
      gateway: '192.168.1.1',
      dns: '8.8.8.8',
      mac: 'AA:BB:CC:DD:EE:FF',
      hostname: 'esp32',
      uptime_ms: 60000,
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
import { stepNumber } from '../types/provisioning';

// Import hooks to verify they are exported and are functions.
import {
  useDeviceScanner,
  useBleConnection,
  useWifiStatus,
  useDeviceProtocol,
  useProvisioning,
  useSavedNetworks,
  useAccessPoint,
  useDeviceVariables,
} from '../hooks';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorthand to get current store state. */
function getStore() {
  return useProvisioningStore.getState();
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('hooks', () => {
  beforeEach(() => {
    // Create fresh mock services for each test.
    mockTransport = createMockTransport();
    mockProtocol = createMockProtocol();
    mockPoller = createMockPoller();
    mockManager = createMockManager();

    // Reset the store to initial state and tear down subscriptions.
    useProvisioningStore.getState().destroy();
  });

  // ==========================================================================
  // Hook exports verification
  // ==========================================================================

  describe('hook exports', () => {
    it('all 8 hooks are exported as functions', () => {
      expect(typeof useDeviceScanner).toBe('function');
      expect(typeof useBleConnection).toBe('function');
      expect(typeof useWifiStatus).toBe('function');
      expect(typeof useDeviceProtocol).toBe('function');
      expect(typeof useProvisioning).toBe('function');
      expect(typeof useSavedNetworks).toBe('function');
      expect(typeof useAccessPoint).toBe('function');
      expect(typeof useDeviceVariables).toBe('function');
    });
  });

  // ==========================================================================
  // useDeviceScanner field mapping
  // ==========================================================================

  describe('useDeviceScanner — store field mapping', () => {
    it('store exposes discoveredDevices and scanning state fields', () => {
      const s = getStore();
      expect(s).toHaveProperty('discoveredDevices');
      expect(s).toHaveProperty('scanning');
      expect(Array.isArray(s.discoveredDevices)).toBe(true);
      expect(typeof s.scanning).toBe('boolean');
    });

    it('store exposes startScan and stopScan actions', () => {
      const s = getStore();
      expect(typeof s.startScan).toBe('function');
      expect(typeof s.stopScan).toBe('function');
    });

    it('startScan clears devices, sets scanning=true, delegates to manager', () => {
      getStore().initialize();
      useProvisioningStore.setState({
        discoveredDevices: [{ id: 'd1', name: 'D1', rssi: -50 }],
      });

      getStore().startScan();

      expect(getStore().discoveredDevices).toEqual([]);
      expect(getStore().scanning).toBe(true);
      expect(mockManager.scanForDevices).toHaveBeenCalled();
    });

    it('stopScan delegates to transport.stopScan()', () => {
      getStore().initialize();
      getStore().stopScan();

      expect(mockTransport.stopScan).toHaveBeenCalled();
    });
  });

  // ==========================================================================
  // useBleConnection field mapping
  // ==========================================================================

  describe('useBleConnection — store field mapping', () => {
    it('store exposes connectionState, deviceName, deviceId, bleError', () => {
      const s = getStore();
      expect(s).toHaveProperty('connectionState');
      expect(s).toHaveProperty('deviceName');
      expect(s).toHaveProperty('deviceId');
      expect(s).toHaveProperty('bleError');
    });

    it('store exposes connectToDevice and disconnectDevice actions', () => {
      const s = getStore();
      expect(typeof s.connectToDevice).toBe('function');
      expect(typeof s.disconnectDevice).toBe('function');
    });

    it('connectionState reflects transport events', () => {
      getStore().initialize();

      mockTransport._emitter.emit('connectionStateChanged', 'connected');
      expect(getStore().connectionState).toBe('connected');

      mockTransport._emitter.emit('connectionStateChanged', 'disconnected');
      expect(getStore().connectionState).toBe('disconnected');
    });

    it('bleError reflects transport error events', () => {
      getStore().initialize();

      mockTransport._emitter.emit('error', new Error('Connection lost'));
      expect(getStore().bleError).toBe('Connection lost');
    });

    it('connectToDevice sets deviceId and deviceName from transport', async () => {
      getStore().initialize();
      await getStore().connectToDevice('dev-1');

      expect(getStore().deviceId).toBe('dev-1');
      expect(getStore().deviceName).toBe('ESP32-WiFi-Test');
    });
  });

  // ==========================================================================
  // useWifiStatus field mapping
  // ==========================================================================

  describe('useWifiStatus — store field mapping', () => {
    it('store exposes all wifi state fields', () => {
      const s = getStore();
      expect(s).toHaveProperty('wifiState');
      expect(s).toHaveProperty('wifiSsid');
      expect(s).toHaveProperty('wifiIp');
      expect(s).toHaveProperty('wifiRssi');
      expect(s).toHaveProperty('wifiQuality');
      expect(s).toHaveProperty('polling');
      expect(s).toHaveProperty('pollError');
      expect(s).toHaveProperty('connectionFailed');
    });

    it('store exposes pollOnce action', () => {
      expect(typeof getStore().pollOnce).toBe('function');
    });

    it('wifi fields update from poller wifiStateChanged event', () => {
      getStore().initialize();

      mockPoller._emitter.emit('wifiStateChanged', {
        state: 'connected',
        ssid: 'HomeNetwork',
        ip: '10.0.0.5',
        rssi: -30,
        quality: 90,
      });

      const s = getStore();
      expect(s.wifiState).toBe('connected');
      expect(s.wifiSsid).toBe('HomeNetwork');
      expect(s.wifiIp).toBe('10.0.0.5');
      expect(s.wifiRssi).toBe(-30);
      expect(s.wifiQuality).toBe(90);
    });

    it('polling flag synced via connectionSucceeded event', () => {
      getStore().initialize();
      useProvisioningStore.setState({ polling: true });

      mockPoller._emitter.emit('connectionSucceeded');
      expect(getStore().polling).toBe(false);
    });

    it('connectionFailed flag set by connectionFailed event', () => {
      getStore().initialize();
      useProvisioningStore.setState({ polling: true });

      mockPoller._emitter.emit('connectionFailed');
      expect(getStore().connectionFailed).toBe(true);
      expect(getStore().polling).toBe(false);
    });

    it('pollOnce delegates to poller.pollOnce() and returns result', async () => {
      getStore().initialize();
      const result = await getStore().pollOnce();

      expect(mockPoller.pollOnce).toHaveBeenCalled();
      expect(result).toHaveProperty('state', 'connected');
      expect(result).toHaveProperty('ssid', 'MyWifi');
    });
  });

  // ==========================================================================
  // useDeviceProtocol field mapping
  // ==========================================================================

  describe('useDeviceProtocol — store field mapping', () => {
    it('store exposes busy and lastCommandError state fields', () => {
      const s = getStore();
      expect(s).toHaveProperty('busy');
      expect(s).toHaveProperty('lastCommandError');
      expect(typeof s.busy).toBe('boolean');
    });

    it('store exposes all 12 protocol command actions', () => {
      const s = getStore();
      const commandNames = [
        'getStatus',
        'scanNetworks',
        'listNetworks',
        'addNetwork',
        'delNetwork',
        'connectWifi',
        'disconnectWifi',
        'getApStatus',
        'startAp',
        'stopAp',
        'getVar',
        'setVar',
        'factoryReset',
      ];
      for (const name of commandNames) {
        expect(typeof (s as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('busy flag reflects protocol busyChanged events', () => {
      getStore().initialize();

      mockProtocol._emitter.emit('busyChanged', true);
      expect(getStore().busy).toBe(true);

      mockProtocol._emitter.emit('busyChanged', false);
      expect(getStore().busy).toBe(false);
    });

    it('lastCommandError reflects protocol commandError events', () => {
      getStore().initialize();

      mockProtocol._emitter.emit('commandError', new Error('Command timeout'));
      expect(getStore().lastCommandError).toBe('Command timeout');
    });
  });

  // ==========================================================================
  // useProvisioning field mapping
  // ==========================================================================

  describe('useProvisioning — store field mapping', () => {
    it('store exposes all provisioning state fields', () => {
      const s = getStore();
      const stateFields = [
        'step',
        'selectedNetwork',
        'scannedNetworks',
        'provisioningError',
        'connectionState',
        'deviceName',
        'wifiState',
        'wifiIp',
        'wifiSsid',
        'wifiRssi',
        'wifiQuality',
        'connectionFailed',
        'pollError',
        'polling',
        'busy',
      ];
      for (const field of stateFields) {
        expect(s).toHaveProperty(field);
      }
    });

    it('store exposes all 10 provisioning flow actions', () => {
      const s = getStore();
      const actionNames = [
        'provisioningScanForDevices',
        'provisioningConnectToDevice',
        'provisioningScanWifiNetworks',
        'provisioningSelectNetwork',
        'provisioningSubmitCredentials',
        'provisioningRetryConnection',
        'provisioningDeleteNetworkAndReturn',
        'provisioningGoToNetworks',
        'provisioningGoToManage',
        'provisioningReset',
      ];
      for (const name of actionNames) {
        expect(typeof (s as unknown as Record<string, unknown>)[name]).toBe('function');
      }
    });

    it('step field reflects manager stepChanged events', () => {
      getStore().initialize();

      mockManager._emitter.emit('stepChanged', 'networks');
      expect(getStore().step).toBe('networks');

      mockManager._emitter.emit('stepChanged', 'credentials');
      expect(getStore().step).toBe('credentials');
    });

    it('scannedNetworks reflect manager scannedNetworksUpdated events', () => {
      getStore().initialize();

      const networks = [
        { ssid: 'Net1', rssi: -40, auth: 'WPA2' },
        { ssid: 'Net2', rssi: -65, auth: 'OPEN' },
      ];
      mockManager._emitter.emit('scannedNetworksUpdated', networks);

      expect(getStore().scannedNetworks).toEqual(networks);
    });

    it('selectedNetwork reflects manager selectedNetworkChanged events', () => {
      getStore().initialize();

      const network = { ssid: 'TestWifi', rssi: -45, auth: 'WPA2' as const };
      mockManager._emitter.emit('selectedNetworkChanged', network);
      expect(getStore().selectedNetwork).toEqual(network);

      mockManager._emitter.emit('selectedNetworkChanged', null);
      expect(getStore().selectedNetwork).toBeNull();
    });

    it('provisioningError reflects manager provisioningError events', () => {
      getStore().initialize();

      mockManager._emitter.emit('provisioningError', 'Connection refused');
      expect(getStore().provisioningError).toBe('Connection refused');

      mockManager._emitter.emit('provisioningError', null);
      expect(getStore().provisioningError).toBeNull();
    });
  });

  // ==========================================================================
  // stepNumber helper (used by useProvisioning)
  // ==========================================================================

  describe('stepNumber helper', () => {
    it('returns 1-based step number for steps in the standard flow', () => {
      expect(stepNumber('welcome')).toBe(1);
      expect(stepNumber('connect')).toBe(2);
      expect(stepNumber('networks')).toBe(3);
      expect(stepNumber('credentials')).toBe(4);
      expect(stepNumber('connecting')).toBe(5);
      expect(stepNumber('success')).toBe(6);
    });

    it('returns null for "manage" step (not in standard flow)', () => {
      expect(stepNumber('manage')).toBeNull();
    });
  });

  // ==========================================================================
  // useSavedNetworks — integration via store actions
  // ==========================================================================

  describe('useSavedNetworks — store action integration', () => {
    beforeEach(() => {
      getStore().initialize();
    });

    it('listNetworks() calls protocol.listNetworks() and returns networks array', async () => {
      const result = await getStore().listNetworks();

      expect(mockProtocol.listNetworks).toHaveBeenCalledTimes(1);
      expect(result).toEqual([
        { ssid: 'SavedNet1', priority: 5 },
        { ssid: 'SavedNet2', priority: 3 },
      ]);
    });

    it('delNetwork() calls protocol.delNetwork() with the ssid', async () => {
      await getStore().delNetwork('SavedNet1');

      expect(mockProtocol.delNetwork).toHaveBeenCalledWith('SavedNet1');
    });

    it('listNetworks() propagates errors from protocol', async () => {
      mockProtocol.listNetworks.mockRejectedValueOnce(new Error('BLE disconnected'));

      await expect(getStore().listNetworks()).rejects.toThrow('BLE disconnected');
    });

    it('delNetwork() propagates errors from protocol', async () => {
      mockProtocol.delNetwork.mockRejectedValueOnce(new Error('Not found'));

      await expect(getStore().delNetwork('missing')).rejects.toThrow('Not found');
    });

    it('listNetworks followed by delNetwork followed by listNetworks works sequentially', async () => {
      // First list.
      const result1 = await getStore().listNetworks();
      expect(result1).toHaveLength(2);

      // Delete one.
      await getStore().delNetwork('SavedNet1');
      expect(mockProtocol.delNetwork).toHaveBeenCalledWith('SavedNet1');

      // Mock updated response for second list.
      mockProtocol.listNetworks.mockResolvedValueOnce({
        networks: [{ ssid: 'SavedNet2', priority: 3 }],
      });

      const result2 = await getStore().listNetworks();
      expect(result2).toEqual([{ ssid: 'SavedNet2', priority: 3 }]);
    });
  });

  // ==========================================================================
  // useAccessPoint — integration via store actions
  // ==========================================================================

  describe('useAccessPoint — store action integration', () => {
    beforeEach(() => {
      getStore().initialize();
    });

    it('getApStatus() calls protocol.getApStatus() and returns result', async () => {
      const result = await getStore().getApStatus();

      expect(mockProtocol.getApStatus).toHaveBeenCalledTimes(1);
      expect(result).toEqual({
        active: true,
        ssid: 'ESP32-AP',
        ip: '192.168.4.1',
        sta_count: 2,
      });
    });

    it('startAp() calls protocol.startAp() with params', async () => {
      const params = { ssid: 'MyAP', password: 'secret123' };
      await getStore().startAp(params);

      expect(mockProtocol.startAp).toHaveBeenCalledWith(params);
    });

    it('startAp() works without params', async () => {
      await getStore().startAp();

      expect(mockProtocol.startAp).toHaveBeenCalledWith(undefined);
    });

    it('stopAp() calls protocol.stopAp()', async () => {
      await getStore().stopAp();

      expect(mockProtocol.stopAp).toHaveBeenCalledTimes(1);
    });

    it('getApStatus() propagates errors from protocol', async () => {
      mockProtocol.getApStatus.mockRejectedValueOnce(new Error('AP query failed'));

      await expect(getStore().getApStatus()).rejects.toThrow('AP query failed');
    });

    it('startAp() propagates errors from protocol', async () => {
      mockProtocol.startAp.mockRejectedValueOnce(new Error('AP start failed'));

      await expect(getStore().startAp()).rejects.toThrow('AP start failed');
    });

    it('stopAp() propagates errors from protocol', async () => {
      mockProtocol.stopAp.mockRejectedValueOnce(new Error('AP stop failed'));

      await expect(getStore().stopAp()).rejects.toThrow('AP stop failed');
    });

    it('startAp then getApStatus works sequentially', async () => {
      await getStore().startAp({ ssid: 'TestAP' });
      expect(mockProtocol.startAp).toHaveBeenCalledWith({ ssid: 'TestAP' });

      // Mock updated AP status.
      mockProtocol.getApStatus.mockResolvedValueOnce({
        active: true,
        ssid: 'TestAP',
        ip: '192.168.4.1',
        sta_count: 0,
      });

      const status = await getStore().getApStatus();
      expect(status.ssid).toBe('TestAP');
      expect(status.active).toBe(true);
    });

    it('stopAp then getApStatus shows inactive', async () => {
      await getStore().stopAp();

      mockProtocol.getApStatus.mockResolvedValueOnce({
        active: false,
        ssid: '',
        ip: '',
        sta_count: 0,
      });

      const status = await getStore().getApStatus();
      expect(status.active).toBe(false);
    });
  });

  // ==========================================================================
  // useDeviceVariables — integration via store actions
  // ==========================================================================

  describe('useDeviceVariables — store action integration', () => {
    beforeEach(() => {
      getStore().initialize();
    });

    it('getVar() calls protocol.getVar() with the key and returns result', async () => {
      const result = await getStore().getVar('firmware');

      expect(mockProtocol.getVar).toHaveBeenCalledWith('firmware');
      expect(result).toEqual({ key: 'firmware', value: '1.0.0' });
    });

    it('setVar() calls protocol.setVar() with key and value', async () => {
      await getStore().setVar('hostname', 'my-device');

      expect(mockProtocol.setVar).toHaveBeenCalledWith('hostname', 'my-device');
    });

    it('getVar() propagates errors from protocol', async () => {
      mockProtocol.getVar.mockRejectedValueOnce(new Error('Variable not found'));

      await expect(getStore().getVar('missing')).rejects.toThrow('Variable not found');
    });

    it('setVar() propagates errors from protocol', async () => {
      mockProtocol.setVar.mockRejectedValueOnce(new Error('Read-only variable'));

      await expect(getStore().setVar('firmware', '2.0')).rejects.toThrow(
        'Read-only variable',
      );
    });

    it('setVar then getVar reflects updated value', async () => {
      await getStore().setVar('hostname', 'new-name');
      expect(mockProtocol.setVar).toHaveBeenCalledWith('hostname', 'new-name');

      // Mock updated response.
      mockProtocol.getVar.mockResolvedValueOnce({
        key: 'hostname',
        value: 'new-name',
      });

      const result = await getStore().getVar('hostname');
      expect(result).toEqual({ key: 'hostname', value: 'new-name' });
    });

    it('multiple getVar calls for different keys work independently', async () => {
      mockProtocol.getVar
        .mockResolvedValueOnce({ key: 'firmware', value: '1.0.0' })
        .mockResolvedValueOnce({ key: 'hostname', value: 'esp32' })
        .mockResolvedValueOnce({ key: 'serial', value: 'ABC123' });

      const firmware = await getStore().getVar('firmware');
      const hostname = await getStore().getVar('hostname');
      const serial = await getStore().getVar('serial');

      expect(firmware).toEqual({ key: 'firmware', value: '1.0.0' });
      expect(hostname).toEqual({ key: 'hostname', value: 'esp32' });
      expect(serial).toEqual({ key: 'serial', value: 'ABC123' });

      expect(mockProtocol.getVar).toHaveBeenCalledTimes(3);
    });
  });

  // ==========================================================================
  // Cross-hook state consistency
  // ==========================================================================

  describe('cross-hook state consistency', () => {
    beforeEach(() => {
      getStore().initialize();
    });

    it('fields shared between useProvisioning and useBleConnection stay in sync', () => {
      // Both hooks read connectionState and deviceName from the same store.
      mockTransport._emitter.emit('connectionStateChanged', 'connected');
      useProvisioningStore.setState({ deviceName: 'ESP32-Test' });

      const s = getStore();
      // useProvisioning would see these same values.
      expect(s.connectionState).toBe('connected');
      expect(s.deviceName).toBe('ESP32-Test');
    });

    it('fields shared between useProvisioning and useWifiStatus stay in sync', () => {
      // Both hooks read wifiState, wifiSsid, wifiIp, etc.
      mockPoller._emitter.emit('wifiStateChanged', {
        state: 'connected',
        ssid: 'SharedNet',
        ip: '10.0.0.1',
        rssi: -50,
        quality: 60,
      });

      const s = getStore();
      expect(s.wifiState).toBe('connected');
      expect(s.wifiSsid).toBe('SharedNet');
      expect(s.wifiIp).toBe('10.0.0.1');
      expect(s.wifiRssi).toBe(-50);
      expect(s.wifiQuality).toBe(60);
    });

    it('busy field is shared between useProvisioning and useDeviceProtocol', () => {
      mockProtocol._emitter.emit('busyChanged', true);

      const s = getStore();
      expect(s.busy).toBe(true);
    });

    it('polling flag is shared between useProvisioning and useWifiStatus', () => {
      // stepChanged('connecting') sets polling=true.
      mockManager._emitter.emit('stepChanged', 'connecting');
      expect(getStore().polling).toBe(true);

      // connectionSucceeded sets polling=false.
      mockPoller._emitter.emit('connectionSucceeded');
      expect(getStore().polling).toBe(false);
    });
  });

  // ==========================================================================
  // Store initial state matches hook defaults
  // ==========================================================================

  describe('initial state matches expected hook defaults', () => {
    it('useDeviceScanner fields have correct defaults', () => {
      const s = getStore();
      expect(s.discoveredDevices).toEqual([]);
      expect(s.scanning).toBe(false);
    });

    it('useBleConnection fields have correct defaults', () => {
      const s = getStore();
      expect(s.connectionState).toBe('disconnected');
      expect(s.deviceName).toBe('');
      expect(s.deviceId).toBeNull();
      expect(s.bleError).toBeNull();
    });

    it('useWifiStatus fields have correct defaults', () => {
      const s = getStore();
      expect(s.wifiState).toBe('disconnected');
      expect(s.wifiSsid).toBe('');
      expect(s.wifiIp).toBe('');
      expect(s.wifiRssi).toBe(0);
      expect(s.wifiQuality).toBe(0);
      expect(s.polling).toBe(false);
      expect(s.pollError).toBeNull();
      expect(s.connectionFailed).toBe(false);
    });

    it('useDeviceProtocol fields have correct defaults', () => {
      const s = getStore();
      expect(s.busy).toBe(false);
      expect(s.lastCommandError).toBeNull();
    });

    it('useProvisioning fields have correct defaults', () => {
      const s = getStore();
      expect(s.step).toBe('welcome');
      expect(s.selectedNetwork).toBeNull();
      expect(s.scannedNetworks).toEqual([]);
      expect(s.provisioningError).toBeNull();
    });
  });
});
