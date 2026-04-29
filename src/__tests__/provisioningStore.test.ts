/**
 * provisioningStore v1 tests.
 *
 * Verifies the store's reactive shape and the v1 contract: unified `error`
 * envelope, `lastResult` survival across cancel, `device` connection state,
 * step transitions wired from manager events.
 *
 * Service layer is mocked at the module boundary via the service factory.
 */

(globalThis as Record<string, unknown>).__DEV__ = false;

import { useProvisioningStore } from '../store/provisioningStore';
import * as factory from '../serviceFactory';
import type {
  DiscoveredDevice,
  ProvisioningError,
  ProvisioningResult,
  ProvisioningStep,
  ScannedNetwork,
  WifiStatus,
} from '../types';

// ---------------------------------------------------------------------------
// Mock the service factory so the store can drive synthetic events.
// ---------------------------------------------------------------------------

type Listener = (...args: unknown[]) => void;

class StubEmitter {
  private handlers = new Map<string, Set<Listener>>();
  on(event: string, fn: Listener): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(fn);
    return () => this.handlers.get(event)?.delete(fn);
  }
  emit(event: string, ...args: unknown[]): void {
    const set = this.handlers.get(event);
    if (set) for (const h of [...set]) h(...args);
  }
}

const transportEmitter = new StubEmitter();
const pollerEmitter = new StubEmitter();
const managerEmitter = new StubEmitter();

const stubTransport = {
  on: (e: string, h: Listener) => transportEmitter.on(e, h),
  startScan: jest.fn(),
  stopScan: jest.fn(),
  connect: jest.fn(),
  disconnect: jest.fn(),
  isConnected: false,
  connectedDevice: null,
};

const stubProtocol = {
  getStatus: jest.fn(),
  scan: jest.fn().mockResolvedValue({ networks: [] }),
  listNetworks: jest.fn().mockResolvedValue({ networks: [] }),
  addNetwork: jest.fn(),
  delNetwork: jest.fn(),
  connectWifi: jest.fn(),
  disconnectWifi: jest.fn(),
  getApStatus: jest.fn(),
  startAp: jest.fn(),
  stopAp: jest.fn(),
  getVar: jest.fn(),
  setVar: jest.fn(),
  factoryReset: jest.fn(),
};

const stubPoller = {
  on: (e: string, h: Listener) => pollerEmitter.on(e, h),
  startPolling: jest.fn(),
  stopPolling: jest.fn(),
  pollOnce: jest.fn(),
};

const stubManager = {
  on: (e: string, h: Listener) => managerEmitter.on(e, h),
  start: jest.fn(),
  chooseDevice: jest.fn(),
  proceedFromConfigure: jest.fn(),
  rescanWifi: jest.fn(),
  chooseNetwork: jest.fn(),
  backToNetworks: jest.fn(),
  submitPassword: jest.fn(),
  retryJoin: jest.fn(),
  pickDifferentNetwork: jest.fn(),
  pickDifferentDevice: jest.fn(),
  cancel: jest.fn(),
  goToManage: jest.fn(),
};

jest.spyOn(factory, 'initializeServices').mockImplementation(() => {});
jest.spyOn(factory, 'destroyServices').mockResolvedValue(undefined);
jest
  .spyOn(factory, 'getTransport')
  .mockImplementation(() => stubTransport as never);
jest
  .spyOn(factory, 'getProtocol')
  .mockImplementation(() => stubProtocol as never);
jest.spyOn(factory, 'getPoller').mockImplementation(() => stubPoller as never);
jest
  .spyOn(factory, 'getManager')
  .mockImplementation(() => stubManager as never);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function reset() {
  useProvisioningStore.getState().destroy();
  useProvisioningStore.setState({
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
  });
}

beforeEach(() => {
  reset();
  // Trigger initialize so subscriptions wire up against our stubs.
  useProvisioningStore.getState().initialize();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisioningStore — v1 state shape', () => {
  it('starts with the v1 initial state', () => {
    const s = useProvisioningStore.getState();
    expect(s.step).toBe('welcome');
    expect(s.error).toBeNull();
    expect(s.lastResult).toBeNull();
    expect(s.device).toBeNull();
    expect(s.scannedNetworks).toEqual([]);
    expect(s.discoveredDevices).toEqual([]);
  });

  it('exposes verb actions matching the manager surface', () => {
    const s = useProvisioningStore.getState();
    expect(typeof s.start).toBe('function');
    expect(typeof s.chooseDevice).toBe('function');
    expect(typeof s.chooseNetwork).toBe('function');
    expect(typeof s.submitPassword).toBe('function');
    expect(typeof s.cancel).toBe('function');
    expect(typeof s.pickDifferentDevice).toBe('function');
    expect(typeof s.pickDifferentNetwork).toBe('function');
    expect(typeof s.goToManage).toBe('function');
  });
});

describe('provisioningStore — manager event subscriptions', () => {
  it('mirrors stepChanged into store.step', () => {
    managerEmitter.emit('stepChanged', 'scanBle' as ProvisioningStep);
    expect(useProvisioningStore.getState().step).toBe('scanBle');
  });

  it('flips polling=true when step transitions to joiningWifi', () => {
    managerEmitter.emit('stepChanged', 'joiningWifi' as ProvisioningStep);
    expect(useProvisioningStore.getState().polling).toBe(true);
  });

  it('mirrors errorChanged into store.error', () => {
    const err: ProvisioningError = {
      source: 'ble',
      message: 'BLE off',
      recoverable: false,
    };
    managerEmitter.emit('errorChanged', err);
    expect(useProvisioningStore.getState().error).toEqual(err);

    managerEmitter.emit('errorChanged', null);
    expect(useProvisioningStore.getState().error).toBeNull();
  });

  it('mirrors deviceConnectionChanged into store.device', () => {
    managerEmitter.emit('deviceConnectionChanged', {
      status: 'connecting',
      id: 'd1',
      name: 'X',
      rssi: -50,
    });
    expect(useProvisioningStore.getState().device).toMatchObject({
      status: 'connecting',
      id: 'd1',
    });

    managerEmitter.emit('deviceConnectionChanged', null);
    expect(useProvisioningStore.getState().device).toBeNull();
  });

  it('mirrors scannedNetworksUpdated into store.scannedNetworks', () => {
    const networks: ScannedNetwork[] = [
      { ssid: 'A', rssi: -45, auth: 'WPA2' },
    ];
    managerEmitter.emit('scannedNetworksUpdated', networks);
    expect(useProvisioningStore.getState().scannedNetworks).toEqual(networks);
  });

  it('mirrors selectedNetworkChanged into store.selectedNetwork', () => {
    const network: ScannedNetwork = { ssid: 'A', rssi: -45, auth: 'WPA2' };
    managerEmitter.emit('selectedNetworkChanged', network);
    expect(useProvisioningStore.getState().selectedNetwork).toEqual(network);
  });
});

describe('provisioningStore — provisioningComplete + lastResult survival', () => {
  it('captures provisioningComplete into lastResult', () => {
    const result: ProvisioningResult = {
      success: true,
      ssid: 'A',
      ip: '1.2.3.4',
      deviceName: 'X',
      deviceId: 'd1',
    };
    managerEmitter.emit('provisioningComplete', result);
    expect(useProvisioningStore.getState().lastResult).toEqual(result);
  });

  it('lastResult survives provisioningReset (so SuccessScreen can stay rendered)', () => {
    const result: ProvisioningResult = { success: true, ssid: 'A', ip: '1' };
    managerEmitter.emit('provisioningComplete', result);
    expect(useProvisioningStore.getState().lastResult).toEqual(result);

    managerEmitter.emit('provisioningReset');

    const s = useProvisioningStore.getState();
    expect(s.lastResult).toEqual(result); // preserved
    expect(s.step).toBe('welcome'); // reset
    expect(s.device).toBeNull(); // reset
  });

  it('start() clears lastResult before delegating to the manager', async () => {
    const result: ProvisioningResult = { success: true, ssid: 'A', ip: '1' };
    managerEmitter.emit('provisioningComplete', result);

    await useProvisioningStore.getState().start();

    expect(useProvisioningStore.getState().lastResult).toBeNull();
    expect(stubManager.start).toHaveBeenCalled();
  });
});

describe('provisioningStore — transport event subscriptions', () => {
  it('tracks scanning flag from connectionStateChanged', () => {
    transportEmitter.emit('connectionStateChanged', 'scanning');
    expect(useProvisioningStore.getState().scanning).toBe(true);

    transportEmitter.emit('connectionStateChanged', 'disconnected');
    expect(useProvisioningStore.getState().scanning).toBe(false);
  });

  it('accumulates discovered devices', () => {
    const d1: DiscoveredDevice = { id: 'a', name: 'A', rssi: -50 };
    const d2: DiscoveredDevice = { id: 'b', name: 'B', rssi: -60 };
    transportEmitter.emit('deviceDiscovered', d1);
    transportEmitter.emit('deviceDiscovered', d2);
    expect(useProvisioningStore.getState().discoveredDevices).toHaveLength(2);
  });

  it('captures scanCompleted into lastScanResult', () => {
    transportEmitter.emit('scanCompleted', {
      matched: 2,
      total: 5,
      sampleNames: ['Foo'],
    });
    expect(useProvisioningStore.getState().lastScanResult).toEqual({
      matched: 2,
      total: 5,
      sampleNames: ['Foo'],
    });
  });
});

describe('provisioningStore — poller event subscriptions', () => {
  it('mirrors wifiStateChanged into wifi fields', () => {
    const status: WifiStatus = {
      state: 'connected',
      ssid: 'A',
      rssi: -40,
      quality: 90,
      ip: '1.2.3.4',
      channel: 6,
      netmask: '',
      gateway: '',
      dns: '',
      mac: '',
      hostname: '',
      uptime_ms: 0,
      ap_active: false,
    };
    pollerEmitter.emit('wifiStateChanged', status);
    const s = useProvisioningStore.getState();
    expect(s.wifiState).toBe('connected');
    expect(s.wifiSsid).toBe('A');
    expect(s.wifiIp).toBe('1.2.3.4');
    expect(s.wifiQuality).toBe(90);
  });

  it('clears polling on connectionSucceeded / connectionFailed / connectionTimedOut', () => {
    useProvisioningStore.setState({ polling: true });
    pollerEmitter.emit('connectionSucceeded');
    expect(useProvisioningStore.getState().polling).toBe(false);

    useProvisioningStore.setState({ polling: true });
    pollerEmitter.emit('connectionFailed');
    expect(useProvisioningStore.getState().polling).toBe(false);

    useProvisioningStore.setState({ polling: true });
    pollerEmitter.emit('connectionTimedOut');
    expect(useProvisioningStore.getState().polling).toBe(false);
  });
});

describe('provisioningStore — action delegation', () => {
  it('chooseDevice forwards to the manager', async () => {
    const target: DiscoveredDevice = { id: 'd1', name: 'X', rssi: -50 };
    await useProvisioningStore.getState().chooseDevice(target);
    expect(stubManager.chooseDevice).toHaveBeenCalledWith(target);
  });

  it('chooseNetwork forwards to the manager', () => {
    const network: ScannedNetwork = { ssid: 'A', rssi: -45, auth: 'WPA2' };
    useProvisioningStore.getState().chooseNetwork(network);
    expect(stubManager.chooseNetwork).toHaveBeenCalledWith(network);
  });

  it('submitPassword forwards to the manager', async () => {
    await useProvisioningStore.getState().submitPassword('secret');
    expect(stubManager.submitPassword).toHaveBeenCalledWith('secret');
  });

  it('cancel forwards to the manager', async () => {
    await useProvisioningStore.getState().cancel();
    expect(stubManager.cancel).toHaveBeenCalled();
  });
});
