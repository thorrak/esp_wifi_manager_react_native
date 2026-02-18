/**
 * Tests for the ProvisioningManager service (Layer 4 — provisioning wizard
 * orchestration).
 *
 * BleTransport, DeviceProtocol, and ConnectionPoller are all mocked as
 * lightweight objects injected via the constructor.
 */

// Provide a __DEV__ global for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

import { ProvisioningManager } from '../services/ProvisioningManager';
import type { ScannedNetwork, WifiStatus, BleConnectionState } from '../types';
import type { ProvisioningStep, ProvisioningResult } from '../types/provisioning';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWifiStatus(overrides: Partial<WifiStatus> = {}): WifiStatus {
  return {
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
    ...overrides,
  };
}

const testNetwork: ScannedNetwork = {
  ssid: 'TestWifi',
  rssi: -45,
  auth: 'WPA2',
};

const testNetwork2: ScannedNetwork = {
  ssid: 'OtherWifi',
  rssi: -60,
  auth: 'WPA',
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

/**
 * A minimal mock event emitter that supports on/off/emit, matching the
 * TypedEventEmitter interface used by all three services.
 */
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
    connectedDevice: null as { id: string; name: string; mtu: number | null } | null,
    connectionState: 'disconnected' as string,
    removeAllListeners: jest.fn(),
    destroy: jest.fn().mockResolvedValue(undefined),
  };
}

function createMockProtocol() {
  return {
    scan: jest.fn().mockResolvedValue({
      networks: [testNetwork, testNetwork2],
    }),
    addNetwork: jest.fn().mockResolvedValue(undefined),
    delNetwork: jest.fn().mockResolvedValue(undefined),
    connectWifi: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockResolvedValue(makeWifiStatus()),
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
    reset: jest.fn(),
    removeAllListeners: jest.fn(),
    destroy: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvisioningManager', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let protocol: ReturnType<typeof createMockProtocol>;
  let poller: ReturnType<typeof createMockPoller>;
  let manager: ProvisioningManager;

  beforeEach(() => {
    transport = createMockTransport();
    protocol = createMockProtocol();
    poller = createMockPoller();
    manager = new ProvisioningManager(
      transport as never,
      protocol as never,
      poller as never,
    );
  });

  afterEach(async () => {
    await manager.destroy();
  });

  // --------------------------------------------------------------------------
  // Initial state
  // --------------------------------------------------------------------------

  describe('initial state', () => {
    it('step is "welcome"', () => {
      expect(manager.currentStep).toBe('welcome');
    });

    it('no selected network', () => {
      expect(manager.selectedNetwork).toBeNull();
    });

    it('empty scanned networks', () => {
      expect(manager.scannedNetworks).toEqual([]);
    });
  });

  // --------------------------------------------------------------------------
  // scanForDevices
  // --------------------------------------------------------------------------

  describe('scanForDevices', () => {
    it('calls transport.startScan()', async () => {
      await manager.scanForDevices();

      expect(transport.startScan).toHaveBeenCalledTimes(1);
    });

    it('keeps step at "welcome"', async () => {
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      await manager.scanForDevices();

      // Step should remain 'welcome' — no step change emitted since it's already welcome.
      expect(manager.currentStep).toBe('welcome');
    });

    it('disconnects first if currently connected', async () => {
      transport.isConnected = true;

      await manager.scanForDevices();

      expect(transport.disconnect).toHaveBeenCalled();
      expect(transport.startScan).toHaveBeenCalled();
    });

    it('emits provisioningError if startScan throws', async () => {
      transport.startScan.mockImplementation(() => {
        throw new Error('BLE unavailable');
      });

      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.scanForDevices();

      expect(errors.some((e) => e !== null && e.includes('BLE unavailable'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // connectToDevice
  // --------------------------------------------------------------------------

  describe('connectToDevice', () => {
    it('calls transport.connect() and protocol.scan() for WiFi scan', async () => {
      await manager.connectToDevice('dev-1');

      expect(transport.stopScan).toHaveBeenCalled();
      expect(transport.connect).toHaveBeenCalledWith('dev-1');
      expect(protocol.scan).toHaveBeenCalled();
    });

    it('emits step changes through connect -> networks', async () => {
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      await manager.connectToDevice('dev-1');

      expect(steps).toContain('connect');
      expect(steps).toContain('networks');
      // 'connect' must come before 'networks'.
      expect(steps.indexOf('connect')).toBeLessThan(steps.indexOf('networks'));
    });

    it('populates scannedNetworks sorted by rssi (descending)', async () => {
      protocol.scan.mockResolvedValue({
        networks: [
          { ssid: 'Weak', rssi: -80, auth: 'WPA2' },
          { ssid: 'Strong', rssi: -30, auth: 'WPA2' },
          { ssid: 'Medium', rssi: -55, auth: 'WPA' },
        ],
      });

      await manager.connectToDevice('dev-1');

      expect(manager.scannedNetworks).toHaveLength(3);
      expect(manager.scannedNetworks[0]!.ssid).toBe('Strong');
      expect(manager.scannedNetworks[1]!.ssid).toBe('Medium');
      expect(manager.scannedNetworks[2]!.ssid).toBe('Weak');
    });

    it('emits scannedNetworksUpdated', async () => {
      const handler = jest.fn();
      manager.on('scannedNetworksUpdated', handler);

      await manager.connectToDevice('dev-1');

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.any(Array));
    });

    it('reverts to welcome step if connection fails', async () => {
      transport.connect.mockRejectedValue(new Error('Connection refused'));

      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.connectToDevice('dev-1');

      expect(manager.currentStep).toBe('welcome');
      expect(errors.some((e) => e !== null && e.includes('Connection refused'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // selectNetwork
  // --------------------------------------------------------------------------

  describe('selectNetwork', () => {
    it('stores network and emits selectedNetworkChanged', () => {
      const handler = jest.fn();
      manager.on('selectedNetworkChanged', handler);

      manager.selectNetwork(testNetwork);

      expect(manager.selectedNetwork).toBe(testNetwork);
      expect(handler).toHaveBeenCalledWith(testNetwork);
    });

    it('sets step to "credentials"', () => {
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      manager.selectNetwork(testNetwork);

      expect(manager.currentStep).toBe('credentials');
      expect(steps).toContain('credentials');
    });
  });

  // --------------------------------------------------------------------------
  // submitCredentials
  // --------------------------------------------------------------------------

  describe('submitCredentials', () => {
    beforeEach(async () => {
      // Get to the credentials step first.
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
    });

    it('calls addNetwork with correct params', async () => {
      await manager.submitCredentials('mypassword');

      expect(protocol.addNetwork).toHaveBeenCalledWith({
        ssid: 'TestWifi',
        password: 'mypassword',
        priority: 10, // DEFAULT_NETWORK_PRIORITY
      });
    });

    it('calls connectWifi with the selected SSID', async () => {
      await manager.submitCredentials('mypassword');

      expect(protocol.connectWifi).toHaveBeenCalledWith('TestWifi');
    });

    it('starts the poller and sets step to "connecting"', async () => {
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      await manager.submitCredentials('mypassword');

      expect(poller.startPolling).toHaveBeenCalled();
      expect(manager.currentStep).toBe('connecting');
      expect(steps).toContain('connecting');
    });

    it('emits error if no network is selected', async () => {
      // Create a fresh manager without selecting a network.
      const freshManager = new ProvisioningManager(
        transport as never,
        protocol as never,
        poller as never,
      );
      const errors: Array<string | null> = [];
      freshManager.on('provisioningError', (err) => errors.push(err));

      await freshManager.submitCredentials('password');

      expect(errors.some((e) => e !== null && e.includes('No network selected'))).toBe(true);
      await freshManager.destroy();
    });

    it('emits error when addNetwork fails', async () => {
      protocol.addNetwork.mockRejectedValue(new Error('Add network failed'));
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.submitCredentials('password');

      expect(errors.some((e) => e !== null && e.includes('Add network failed'))).toBe(true);
      expect(poller.startPolling).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Connection success via poller
  // --------------------------------------------------------------------------

  describe('connection success', () => {
    beforeEach(async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
      await manager.submitCredentials('mypassword');
    });

    it('when poller emits connectionSucceeded, step goes to "success"', () => {
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      const status = makeWifiStatus({
        state: 'connected',
        ssid: 'TestWifi',
        ip: '192.168.1.42',
      });
      poller._emitter.emit('connectionSucceeded', status);

      expect(manager.currentStep).toBe('success');
      expect(steps).toContain('success');
    });

    it('emits provisioningComplete with result', () => {
      const results: ProvisioningResult[] = [];
      manager.on('provisioningComplete', (result) => results.push(result));

      transport.connectedDevice = { id: 'dev-1', name: 'ESP32-WiFi-Test', mtu: 517 };

      const status = makeWifiStatus({
        state: 'connected',
        ssid: 'TestWifi',
        ip: '192.168.1.42',
      });
      poller._emitter.emit('connectionSucceeded', status);

      expect(results).toHaveLength(1);
      expect(results[0]).toEqual(
        expect.objectContaining({
          success: true,
          ssid: 'TestWifi',
          ip: '192.168.1.42',
          deviceName: 'ESP32-WiFi-Test',
          deviceId: 'dev-1',
        }),
      );
    });
  });

  // --------------------------------------------------------------------------
  // Connection failure via poller
  // --------------------------------------------------------------------------

  describe('connection failure', () => {
    beforeEach(async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
      await manager.submitCredentials('mypassword');
    });

    it('emits provisioningError on connectionFailed', () => {
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      poller._emitter.emit('connectionFailed');

      expect(errors.some((e) => e !== null && e.includes('WiFi connection failed'))).toBe(true);
    });

    it('emits provisioningError on connectionTimedOut', () => {
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      poller._emitter.emit('connectionTimedOut');

      expect(errors.some((e) => e !== null && e.includes('timed out'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // retryConnection
  // --------------------------------------------------------------------------

  describe('retryConnection', () => {
    beforeEach(async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
      await manager.submitCredentials('mypassword');
    });

    it('resets poller, calls connectWifi, and restarts polling', async () => {
      await manager.retryConnection();

      expect(poller.reset).toHaveBeenCalled();
      expect(protocol.connectWifi).toHaveBeenCalledWith('TestWifi');
      // startPolling should have been called again (once from submit, once from retry).
      expect(poller.startPolling).toHaveBeenCalledTimes(2);
    });

    it('emits error if no network is selected', async () => {
      // Create a fresh manager without selecting a network.
      const freshManager = new ProvisioningManager(
        transport as never,
        protocol as never,
        poller as never,
      );
      const errors: Array<string | null> = [];
      freshManager.on('provisioningError', (err) => errors.push(err));

      await freshManager.retryConnection();

      expect(errors.some((e) => e !== null && e.includes('No network selected'))).toBe(true);
      await freshManager.destroy();
    });

    it('emits error if connectWifi fails during retry', async () => {
      protocol.connectWifi.mockRejectedValueOnce(new Error('Retry connect failed'));
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.retryConnection();

      expect(errors.some((e) => e !== null && e.includes('Retry connect failed'))).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // deleteNetworkAndReturn
  // --------------------------------------------------------------------------

  describe('deleteNetworkAndReturn', () => {
    beforeEach(async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
      await manager.submitCredentials('mypassword');
    });

    it('deletes network, rescans, and goes to "networks"', async () => {
      await manager.deleteNetworkAndReturn();

      expect(poller.reset).toHaveBeenCalled();
      expect(protocol.delNetwork).toHaveBeenCalledWith('TestWifi');
      expect(protocol.scan).toHaveBeenCalled(); // WiFi rescan
      expect(manager.currentStep).toBe('networks');
    });

    it('clears selected network and emits selectedNetworkChanged(null)', async () => {
      const handler = jest.fn();
      manager.on('selectedNetworkChanged', handler);

      await manager.deleteNetworkAndReturn();

      expect(manager.selectedNetwork).toBeNull();
      expect(handler).toHaveBeenCalledWith(null);
    });

    it('continues to rescan even if delNetwork fails', async () => {
      protocol.delNetwork.mockRejectedValue(new Error('Delete failed'));

      await manager.deleteNetworkAndReturn();

      // Should still call scan despite delNetwork failure.
      expect(protocol.scan).toHaveBeenCalled();
      expect(manager.currentStep).toBe('networks');
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('disconnects, stops poller, and returns to "welcome"', async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);

      await manager.reset();

      expect(poller.reset).toHaveBeenCalled();
      expect(transport.disconnect).toHaveBeenCalled();
      expect(manager.currentStep).toBe('welcome');
      expect(manager.selectedNetwork).toBeNull();
      expect(manager.scannedNetworks).toEqual([]);
    });

    it('emits provisioningReset', async () => {
      const handler = jest.fn();
      manager.on('provisioningReset', handler);

      await manager.reset();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('emits stepChanged("welcome")', async () => {
      // Move to a different step first.
      await manager.connectToDevice('dev-1');

      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (step) => steps.push(step));

      await manager.reset();

      expect(steps).toContain('welcome');
    });

    it('emits selectedNetworkChanged(null) and scannedNetworksUpdated([])', async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);

      const networkHandler = jest.fn();
      const scannedHandler = jest.fn();
      manager.on('selectedNetworkChanged', networkHandler);
      manager.on('scannedNetworksUpdated', scannedHandler);

      await manager.reset();

      expect(networkHandler).toHaveBeenCalledWith(null);
      expect(scannedHandler).toHaveBeenCalledWith([]);
    });

    it('tolerates disconnect failure during reset', async () => {
      transport.disconnect.mockRejectedValue(new Error('Already disconnected'));

      await expect(manager.reset()).resolves.toBeUndefined();
      expect(manager.currentStep).toBe('welcome');
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('emits provisioningError when operations fail', async () => {
      transport.connect.mockRejectedValue(new Error('BLE error'));
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.connectToDevice('dev-1');

      const nonNullErrors = errors.filter((e) => e !== null);
      expect(nonNullErrors.length).toBeGreaterThan(0);
      expect(nonNullErrors.some((e) => e!.includes('BLE error'))).toBe(true);
    });

    it('clears previous error when starting a new operation', async () => {
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      await manager.scanForDevices();

      // scanForDevices should emit provisioningError(null) to clear.
      expect(errors).toContain(null);
    });
  });

  // --------------------------------------------------------------------------
  // Transport connectionStateChanged watcher
  // --------------------------------------------------------------------------

  describe('transport disconnect mid-flow', () => {
    it('resets to welcome when BLE disconnects during provisioning', async () => {
      await manager.connectToDevice('dev-1');
      manager.selectNetwork(testNetwork);
      await manager.submitCredentials('password');

      // At this point step is 'connecting'.
      expect(manager.currentStep).toBe('connecting');

      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      // Simulate BLE disconnect via transport event.
      transport._emitter.emit('connectionStateChanged', 'disconnected' as BleConnectionState);

      expect(errors.some((e) => e !== null && e.includes('Bluetooth connection lost'))).toBe(true);
      // reset() is called asynchronously, so the step should go back to welcome.
      // Give it a tick to settle.
      await Promise.resolve();
      expect(manager.currentStep).toBe('welcome');
    });

    it('does not reset when BLE disconnects during welcome step', async () => {
      // At welcome step, BLE disconnect should not trigger error.
      const errors: Array<string | null> = [];
      manager.on('provisioningError', (err) => errors.push(err));

      transport._emitter.emit('connectionStateChanged', 'disconnected' as BleConnectionState);

      const nonNullErrors = errors.filter((e) => e !== null);
      expect(nonNullErrors).toHaveLength(0);
      expect(manager.currentStep).toBe('welcome');
    });
  });

  // --------------------------------------------------------------------------
  // WiFi status forwarding
  // --------------------------------------------------------------------------

  describe('wifi status forwarding', () => {
    it('forwards wifiStateChanged from poller as wifiStatusUpdated', async () => {
      const handler = jest.fn();
      manager.on('wifiStatusUpdated', handler);

      const status = makeWifiStatus({ state: 'connecting', ssid: 'TestWifi' });
      poller._emitter.emit('wifiStateChanged', status);

      expect(handler).toHaveBeenCalledWith(status);
    });
  });
});
