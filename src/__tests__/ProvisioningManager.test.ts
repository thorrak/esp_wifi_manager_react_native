/**
 * ProvisioningManager v1 tests.
 *
 * Covers the new step machine, verb-based actions, error envelope,
 * `onConnected` branching, and the post-success disconnect regression.
 *
 * BleTransport / DeviceProtocol / ConnectionPoller are stubbed as plain
 * objects with the methods the manager actually calls.
 */

(globalThis as Record<string, unknown>).__DEV__ = false;

import { ProvisioningManager } from '../services/ProvisioningManager';
import { BleLibraryError } from '../types/ble';
import type {
  BleConnectionState,
  DeviceConnection,
  DiscoveredDevice,
  ProvisioningError,
  ProvisioningResult,
  ProvisioningStep,
  ScannedNetwork,
  WifiStatus,
} from '../types';

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

const networkA: ScannedNetwork = { ssid: 'NetworkA', rssi: -45, auth: 'WPA2' };
const networkB: ScannedNetwork = { ssid: 'NetworkB', rssi: -60, auth: 'WPA' };

const targetDevice: DiscoveredDevice = {
  id: 'dev-1',
  name: 'ESP32-Test',
  rssi: -55,
};

// ---------------------------------------------------------------------------
// Mock factories
// ---------------------------------------------------------------------------

type EventHandler = (...args: unknown[]) => void;

class MockEmitter {
  private handlers = new Map<string, Set<EventHandler>>();

  on(event: string, handler: EventHandler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  off(event: string, handler: EventHandler): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    const set = this.handlers.get(event);
    if (set) for (const h of [...set]) h(...args);
  }

  removeAllListeners(): void {
    this.handlers.clear();
  }
}

function createMockTransport() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((e: string, h: EventHandler) => emitter.on(e, h)),
    off: jest.fn((e: string, h: EventHandler) => emitter.off(e, h)),
    startScan: jest.fn().mockResolvedValue(undefined),
    stopScan: jest.fn(),
    connect: jest.fn().mockResolvedValue({
      id: 'dev-1',
      name: 'ESP32-Test',
      mtu: 517,
    }),
    disconnect: jest.fn().mockResolvedValue(undefined),
    isConnected: false,
    connectedDevice: { id: 'dev-1', name: 'ESP32-Test', mtu: 517 } as
      | { id: string; name: string; mtu: number | null }
      | null,
  };
}

function createMockProtocol() {
  return {
    scan: jest.fn().mockResolvedValue({ networks: [networkA, networkB] }),
    addNetwork: jest.fn().mockResolvedValue(undefined),
    delNetwork: jest.fn().mockResolvedValue(undefined),
    connectWifi: jest.fn().mockResolvedValue(undefined),
    getStatus: jest.fn().mockResolvedValue(makeWifiStatus()),
  };
}

function createMockPoller() {
  const emitter = new MockEmitter();
  return {
    _emitter: emitter,
    on: jest.fn((e: string, h: EventHandler) => emitter.on(e, h)),
    off: jest.fn((e: string, h: EventHandler) => emitter.off(e, h)),
    startPolling: jest.fn(),
    stopPolling: jest.fn(),
    reset: jest.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ProvisioningManager v1', () => {
  let transport: ReturnType<typeof createMockTransport>;
  let protocol: ReturnType<typeof createMockProtocol>;
  let poller: ReturnType<typeof createMockPoller>;
  let manager: ProvisioningManager;

  beforeEach(() => {
    transport = createMockTransport();
    protocol = createMockProtocol();
    poller = createMockPoller();
  });

  afterEach(async () => {
    if (manager) await manager.destroy();
  });

  function build(opts?: {
    onConnected?: (ctx: unknown) => Promise<void>;
  }): ProvisioningManager {
    manager = new ProvisioningManager(
      transport as never,
      protocol as never,
      poller as never,
      opts?.onConnected
        ? { flow: { onConnected: opts.onConnected as never } }
        : undefined,
    );
    return manager;
  }

  // -------------------------------------------------------------------------
  // Initial state
  // -------------------------------------------------------------------------

  describe('initial state', () => {
    it('step is welcome, no selected/scanned networks, no device, no error', () => {
      build();
      expect(manager.currentStep).toBe('welcome');
      expect(manager.selectedNetwork).toBeNull();
      expect(manager.scannedNetworks).toEqual([]);
      expect(manager.device).toBeNull();
      expect(manager.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // start()
  // -------------------------------------------------------------------------

  describe('start', () => {
    it('transitions to scanBle and starts a scan', async () => {
      build();
      await manager.start();
      expect(manager.currentStep).toBe('scanBle');
      expect(transport.startScan).toHaveBeenCalledTimes(1);
    });

    it('disconnects first if currently connected', async () => {
      transport.isConnected = true;
      build();
      await manager.start();
      expect(transport.disconnect).toHaveBeenCalled();
      expect(transport.startScan).toHaveBeenCalled();
    });

    it('emits a ble error if startScan throws', async () => {
      transport.startScan.mockRejectedValueOnce(new Error('BLE unavailable'));
      build();
      const errors: Array<ProvisioningError | null> = [];
      manager.on('errorChanged', (e) => errors.push(e));
      await manager.start();
      const last = errors[errors.length - 1];
      expect(last?.source).toBe('ble');
      expect(last?.message).toContain('BLE unavailable');
    });
  });

  // -------------------------------------------------------------------------
  // chooseDevice — happy path
  // -------------------------------------------------------------------------

  describe('chooseDevice (no onConnected)', () => {
    it('drives the full path: connectingBle → configuring → scanningWifi → chooseNetwork', async () => {
      build();
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (s) => steps.push(s));

      await manager.chooseDevice(targetDevice);

      expect(steps).toEqual([
        'connectingBle',
        'configuring',
        'scanningWifi',
        'chooseNetwork',
      ]);
      expect(manager.currentStep).toBe('chooseNetwork');
      expect(transport.connect).toHaveBeenCalledWith('dev-1');
      expect(protocol.scan).toHaveBeenCalledTimes(1);
      expect(manager.scannedNetworks).toHaveLength(2);
    });

    it('updates device state through connecting → connected', async () => {
      build();
      const updates: Array<DeviceConnection> = [];
      manager.on('deviceConnectionChanged', (d) => updates.push(d));

      await manager.chooseDevice(targetDevice);

      expect(updates[0]).toMatchObject({
        status: 'connecting',
        id: 'dev-1',
        name: 'ESP32-Test',
      });
      expect(updates[updates.length - 1]).toMatchObject({
        status: 'connected',
        id: 'dev-1',
        name: 'ESP32-Test',
      });
    });

    it('on transport.connect failure, returns to scanBle with a ble error', async () => {
      transport.connect.mockRejectedValueOnce(
        new BleLibraryError('scan_error', 'BLE failed'),
      );
      build();
      await manager.chooseDevice(targetDevice);

      expect(manager.currentStep).toBe('scanBle');
      expect(manager.error?.source).toBe('ble');
      expect(manager.error?.code).toBe('scan_error');
      expect(manager.error?.recoverable).toBe(true);
      expect(manager.device).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // chooseDevice — onConnected branching
  // -------------------------------------------------------------------------

  describe('chooseDevice (with onConnected)', () => {
    it('runs onConnected then advances to scanningWifi', async () => {
      const onConnected = jest.fn().mockResolvedValue(undefined);
      build({ onConnected });

      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (s) => steps.push(s));

      await manager.chooseDevice(targetDevice);

      expect(onConnected).toHaveBeenCalledTimes(1);
      expect(steps).toEqual([
        'connectingBle',
        'configuring',
        'scanningWifi',
        'chooseNetwork',
      ]);
    });

    it('parks on configuring with a flow error if onConnected throws', async () => {
      const onConnected = jest
        .fn()
        .mockRejectedValueOnce(new Error('hostname rejected'));
      build({ onConnected });

      await manager.chooseDevice(targetDevice);

      expect(manager.currentStep).toBe('configuring');
      expect(manager.error?.source).toBe('flow');
      expect(manager.error?.message).toContain('hostname rejected');
      expect(protocol.scan).not.toHaveBeenCalled();
    });

    it('proceedFromConfigure resumes the flow', async () => {
      const onConnected = jest.fn().mockRejectedValueOnce(new Error('boom'));
      build({ onConnected });
      await manager.chooseDevice(targetDevice);
      expect(manager.currentStep).toBe('configuring');

      await manager.proceedFromConfigure();

      expect(manager.currentStep).toBe('chooseNetwork');
      expect(protocol.scan).toHaveBeenCalledTimes(1);
    });

    it('proceedFromConfigure is a no-op outside configuring step', async () => {
      build();
      await manager.proceedFromConfigure(); // step is 'welcome'
      expect(manager.currentStep).toBe('welcome');
      expect(protocol.scan).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // Network selection / submitPassword / poller integration
  // -------------------------------------------------------------------------

  describe('credentials and joining', () => {
    beforeEach(async () => {
      build();
      await manager.chooseDevice(targetDevice);
    });

    it('chooseNetwork transitions to enterCredentials', () => {
      manager.chooseNetwork(networkA);
      expect(manager.currentStep).toBe('enterCredentials');
      expect(manager.selectedNetwork).toEqual(networkA);
    });

    it('backToNetworks returns to chooseNetwork', () => {
      manager.chooseNetwork(networkA);
      manager.backToNetworks();
      expect(manager.currentStep).toBe('chooseNetwork');
      expect(manager.selectedNetwork).toBeNull();
    });

    it('submitPassword transitions immediately to joiningWifi', async () => {
      manager.chooseNetwork(networkA);
      const steps: ProvisioningStep[] = [];
      manager.on('stepChanged', (s) => steps.push(s));

      await manager.submitPassword('pw');

      expect(steps[0]).toBe('joiningWifi');
      expect(protocol.addNetwork).toHaveBeenCalledWith({
        ssid: 'NetworkA',
        password: 'pw',
        priority: 10,
      });
      expect(protocol.connectWifi).toHaveBeenCalledWith('NetworkA');
      expect(poller.startPolling).toHaveBeenCalled();
    });

    it('submitPassword surfaces a protocol error if addNetwork fails', async () => {
      protocol.addNetwork.mockRejectedValueOnce(new Error('refused'));
      manager.chooseNetwork(networkA);

      await manager.submitPassword('pw');

      expect(manager.currentStep).toBe('joiningWifi');
      expect(manager.error?.source).toBe('protocol');
      expect(manager.error?.message).toContain('refused');
      expect(poller.startPolling).not.toHaveBeenCalled();
    });

    it('connectionFailed event sets a recoverable poller error', async () => {
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');

      poller._emitter.emit('connectionFailed');

      expect(manager.error?.source).toBe('poller');
      expect(manager.error?.code).toBe('connection_failed');
      expect(manager.error?.recoverable).toBe(true);
      expect(manager.currentStep).toBe('joiningWifi');
    });

    it('connectionTimedOut event sets a recoverable poller timeout error', async () => {
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');

      poller._emitter.emit('connectionTimedOut');

      expect(manager.error?.code).toBe('connection_timeout');
      expect(manager.error?.recoverable).toBe(true);
    });

    it('connectionSucceeded transitions to success and emits provisioningComplete', async () => {
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');

      const results: ProvisioningResult[] = [];
      manager.on('provisioningComplete', (r) => results.push(r));

      const status = makeWifiStatus({
        state: 'connected',
        ssid: 'NetworkA',
        ip: '192.168.1.5',
      });
      poller._emitter.emit('connectionSucceeded', status);

      expect(manager.currentStep).toBe('success');
      expect(results).toHaveLength(1);
      expect(results[0]).toMatchObject({
        success: true,
        ssid: 'NetworkA',
        ip: '192.168.1.5',
      });
    });
  });

  // -------------------------------------------------------------------------
  // Post-success BLE drop regression
  // -------------------------------------------------------------------------

  describe('regression: post-success BLE disconnect must not error', () => {
    it('stays on success when transport disconnects after success', async () => {
      build();
      await manager.chooseDevice(targetDevice);
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');

      poller._emitter.emit(
        'connectionSucceeded',
        makeWifiStatus({ state: 'connected', ssid: 'NetworkA', ip: '1.2.3.4' }),
      );
      expect(manager.currentStep).toBe('success');

      const errors: Array<ProvisioningError | null> = [];
      manager.on('errorChanged', (e) => errors.push(e));
      const stepsAfter: ProvisioningStep[] = [];
      manager.on('stepChanged', (s) => stepsAfter.push(s));

      // Simulate the device dropping BLE GATT seconds after success.
      transport._emitter.emit(
        'connectionStateChanged',
        'disconnected' as BleConnectionState,
      );

      expect(manager.currentStep).toBe('success');
      expect(stepsAfter).toEqual([]);
      expect(errors).toEqual([]); // no spurious error emitted
    });

    it('also stays on manage when transport disconnects', async () => {
      build();
      await manager.chooseDevice(targetDevice);
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');
      poller._emitter.emit(
        'connectionSucceeded',
        makeWifiStatus({ state: 'connected' }),
      );
      manager.goToManage();

      transport._emitter.emit('connectionStateChanged', 'disconnected');

      expect(manager.currentStep).toBe('manage');
      expect(manager.error).toBeNull();
    });
  });

  // -------------------------------------------------------------------------
  // Mid-flow disconnect IS still an error
  // -------------------------------------------------------------------------

  describe('mid-flow disconnect surfaces error and cancels', () => {
    it('disconnect during chooseNetwork emits a ble error and triggers cancel', async () => {
      build();
      await manager.chooseDevice(targetDevice);
      expect(manager.currentStep).toBe('chooseNetwork');

      const errors: ProvisioningError[] = [];
      manager.on('errorChanged', (e) => {
        if (e) errors.push(e);
      });

      transport._emitter.emit('connectionStateChanged', 'disconnected');

      expect(errors[0]?.source).toBe('ble');
      expect(errors[0]?.code).toBe('connection_lost');
      // cancel() runs synchronously up to the disconnect await, transitioning
      // step to 'welcome' before the test resumes.
      expect(manager.currentStep).toBe('welcome');
    });
  });

  // -------------------------------------------------------------------------
  // pickDifferentNetwork / pickDifferentDevice / cancel
  // -------------------------------------------------------------------------

  describe('navigation verbs', () => {
    beforeEach(async () => {
      build();
      await manager.chooseDevice(targetDevice);
      manager.chooseNetwork(networkA);
      await manager.submitPassword('pw');
    });

    it('pickDifferentNetwork deletes the network and returns to chooseNetwork', async () => {
      await manager.pickDifferentNetwork();

      expect(protocol.delNetwork).toHaveBeenCalledWith('NetworkA');
      expect(manager.selectedNetwork).toBeNull();
      expect(manager.currentStep).toBe('chooseNetwork');
    });

    it('pickDifferentNetwork tolerates delNetwork failure', async () => {
      protocol.delNetwork.mockRejectedValueOnce(new Error('not stored'));
      await manager.pickDifferentNetwork();
      expect(manager.currentStep).toBe('chooseNetwork');
    });

    it('cancel returns to welcome and clears state', async () => {
      await manager.cancel();

      expect(manager.currentStep).toBe('welcome');
      expect(manager.selectedNetwork).toBeNull();
      expect(manager.scannedNetworks).toEqual([]);
      expect(manager.device).toBeNull();
      expect(manager.error).toBeNull();
      expect(transport.disconnect).toHaveBeenCalled();
    });

    it('pickDifferentDevice disconnects and starts a fresh scan', async () => {
      transport.isConnected = true;
      await manager.pickDifferentDevice();
      expect(manager.currentStep).toBe('scanBle');
      expect(transport.disconnect).toHaveBeenCalled();
      expect(transport.startScan).toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  // rescanWifi
  // -------------------------------------------------------------------------

  describe('rescanWifi', () => {
    it('reruns the WiFi scan from chooseNetwork', async () => {
      build();
      await manager.chooseDevice(targetDevice);
      protocol.scan.mockClear();

      await manager.rescanWifi();

      expect(protocol.scan).toHaveBeenCalledTimes(1);
      expect(manager.currentStep).toBe('chooseNetwork');
    });

    it('is a no-op outside chooseNetwork/scanningWifi', async () => {
      build();
      await manager.rescanWifi();
      expect(protocol.scan).not.toHaveBeenCalled();
    });
  });
});
