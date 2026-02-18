/**
 * Tests for the BleTransport service (Layer 1 — BLE scanning, connection,
 * notification reassembly, and command writing).
 *
 * react-native-ble-plx is fully mocked via src/__mocks__/react-native-ble-plx.ts.
 */

// Provide a __DEV__ global for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

import {
  BleManager,
  Device,
  Characteristic,
  State,
} from '../__mocks__/react-native-ble-plx';
import { BleTransport } from '../services/BleTransport';
import {
  SERVICE_UUID,
  COMMAND_CHAR_UUID,
  RESPONSE_CHAR_UUID,
  STATUS_CHAR_UUID,
} from '../constants/ble';
import { stringToBase64 } from '../utils';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a set of three Characteristic objects matching the expected UUIDs. */
function makeCharacteristics(): Characteristic[] {
  return [
    new Characteristic(STATUS_CHAR_UUID),
    new Characteristic(COMMAND_CHAR_UUID),
    new Characteristic(RESPONSE_CHAR_UUID),
  ];
}

/**
 * Create a BleTransport with short timeouts for tests.
 * gattSettleMs is set to 0 to avoid delays in write tests.
 */
function createTransport(overrides?: Record<string, unknown>): BleTransport {
  return new BleTransport({
    scanTimeoutMs: 5000,
    gattSettleMs: 0,
    connectionTimeoutMs: 5000,
    ...overrides,
  });
}

/**
 * Given a mock BleManager instance, return the scan callback that was
 * registered by the most recent startDeviceScan call.
 */
function getScanCallback(
  manager: BleManager,
): (error: unknown, device: Device | null) => void {
  return (manager.startDeviceScan as jest.Mock).mock.calls[
    (manager.startDeviceScan as jest.Mock).mock.calls.length - 1
  ][2];
}

/**
 * Set up a mock Device so its characteristicsForService returns the
 * standard set of three characteristics.
 */
function setupDeviceWithCharacteristics(device: Device): void {
  (device.characteristicsForService as jest.Mock).mockResolvedValue(
    makeCharacteristics(),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('BleTransport', () => {
  let transport: BleTransport;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(async () => {
    if (transport) {
      await transport.destroy();
    }
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // Scanning
  // --------------------------------------------------------------------------

  describe('scanning', () => {
    it('startScan begins scanning and emits deviceDiscovered for matching devices', () => {
      transport = createTransport();
      const discovered: Array<{ id: string; name: string }> = [];
      transport.on('deviceDiscovered', (device) => discovered.push(device));

      transport.startScan();

      expect(transport.connectionState).toBe('scanning');

      // Retrieve the callback that BleManager.startDeviceScan was invoked with.
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const scanCb = getScanCallback(manager);

      // Simulate a matching device being found.
      const device = new Device('dev-1', 'ESP32-WiFi-ABC', -60, 517);
      scanCb(null, device);

      expect(discovered).toHaveLength(1);
      expect(discovered[0]).toEqual(
        expect.objectContaining({ id: 'dev-1', name: 'ESP32-WiFi-ABC' }),
      );
    });

    it('startScan filters by device name prefix', () => {
      transport = createTransport({ deviceNamePrefix: 'ESP32-WiFi-' });
      const discovered: Array<{ id: string; name: string }> = [];
      transport.on('deviceDiscovered', (device) => discovered.push(device));

      transport.startScan();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const scanCb = getScanCallback(manager);

      // Device with wrong prefix should be ignored.
      scanCb(null, new Device('dev-no-match', 'OtherDevice', -70, 517));
      expect(discovered).toHaveLength(0);

      // Device with null name should be ignored.
      scanCb(null, new Device('dev-null-name', null, -70, 517));
      expect(discovered).toHaveLength(0);

      // Device with correct prefix should be emitted.
      scanCb(null, new Device('dev-match', 'ESP32-WiFi-XYZ', -50, 517));
      expect(discovered).toHaveLength(1);
      expect(discovered[0]!.name).toBe('ESP32-WiFi-XYZ');
    });

    it('startScan deduplicates devices by id', () => {
      transport = createTransport();
      const discovered: Array<{ id: string }> = [];
      transport.on('deviceDiscovered', (device) => discovered.push(device));

      transport.startScan();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const scanCb = getScanCallback(manager);

      scanCb(null, new Device('dev-1', 'ESP32-WiFi-A', -50, 517));
      scanCb(null, new Device('dev-1', 'ESP32-WiFi-A', -45, 517)); // duplicate

      expect(discovered).toHaveLength(1);
    });

    it('stopScan stops scanning and emits scanStopped', () => {
      transport = createTransport();
      const scanStoppedHandler = jest.fn();
      transport.on('scanStopped', scanStoppedHandler);

      transport.startScan();
      expect(transport.connectionState).toBe('scanning');

      transport.stopScan();

      expect(transport.connectionState).toBe('disconnected');
      expect(scanStoppedHandler).toHaveBeenCalledTimes(1);

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      expect(manager.stopDeviceScan).toHaveBeenCalled();
    });

    it('stopScan is a no-op when not scanning', () => {
      transport = createTransport();
      const scanStoppedHandler = jest.fn();
      transport.on('scanStopped', scanStoppedHandler);

      transport.stopScan();

      expect(scanStoppedHandler).not.toHaveBeenCalled();
    });

    it('scan auto-stops after timeout', () => {
      transport = createTransport({ scanTimeoutMs: 3000 });
      const scanStoppedHandler = jest.fn();
      transport.on('scanStopped', scanStoppedHandler);

      transport.startScan();
      expect(transport.connectionState).toBe('scanning');

      jest.advanceTimersByTime(3000);

      expect(transport.connectionState).toBe('disconnected');
      expect(scanStoppedHandler).toHaveBeenCalledTimes(1);
    });

    it('startScan is a no-op when already scanning', () => {
      transport = createTransport();
      transport.startScan();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const callCount = (manager.startDeviceScan as jest.Mock).mock.calls.length;

      transport.startScan(); // should be ignored

      expect((manager.startDeviceScan as jest.Mock).mock.calls.length).toBe(callCount);
    });

    it('emits error and resets state when scan callback receives an error', () => {
      transport = createTransport();
      const errors: Error[] = [];
      transport.on('error', (err) => errors.push(err));

      transport.startScan();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const scanCb = getScanCallback(manager);

      scanCb({ message: 'Bluetooth unavailable' }, null);

      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain('Bluetooth unavailable');
      expect(transport.connectionState).toBe('disconnected');
    });
  });

  // --------------------------------------------------------------------------
  // Connecting
  // --------------------------------------------------------------------------

  describe('connecting', () => {
    it('connect discovers service and characteristics', async () => {
      transport = createTransport();

      // Set up the mock device returned by connectToDevice.
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      const result = await transport.connect('dev-1');

      expect(manager.connectToDevice).toHaveBeenCalledWith('dev-1', expect.any(Object));
      expect(mockDevice.discoverAllServicesAndCharacteristics).toHaveBeenCalled();
      expect(mockDevice.characteristicsForService).toHaveBeenCalledWith(SERVICE_UUID);
      expect(result.id).toBe('dev-1');
      expect(result.name).toBe('ESP32-WiFi-ABC');
    });

    it('connect emits connectionStateChanged through connecting -> connected', async () => {
      transport = createTransport();
      const states: string[] = [];
      transport.on('connectionStateChanged', (state) => states.push(state));

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      expect(states).toEqual(['connecting', 'connected']);
    });

    it('connect sets connectedDevice info', async () => {
      transport = createTransport();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-Test', -40, 512);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      expect(transport.connectedDevice).toBeNull();

      await transport.connect('dev-1');

      expect(transport.connectedDevice).toEqual({
        id: 'dev-1',
        name: 'ESP32-WiFi-Test',
        mtu: 512,
      });
      expect(transport.isConnected).toBe(true);
    });

    it('connect throws and resets state when characteristics are missing', async () => {
      transport = createTransport();
      const errors: Error[] = [];
      transport.on('error', (err) => errors.push(err));

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      // Only return the status characteristic — missing command and response.
      (mockDevice.characteristicsForService as jest.Mock).mockResolvedValue([
        new Characteristic(STATUS_CHAR_UUID),
      ]);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await expect(transport.connect('dev-1')).rejects.toThrow(
        /Missing required characteristics/,
      );

      expect(transport.connectionState).toBe('disconnected');
      expect(transport.connectedDevice).toBeNull();
      expect(errors).toHaveLength(1);
    });

    it('connect stops an active scan before connecting', async () => {
      transport = createTransport();
      const scanStoppedHandler = jest.fn();
      transport.on('scanStopped', scanStoppedHandler);

      transport.startScan();
      expect(transport.connectionState).toBe('scanning');

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      expect(scanStoppedHandler).toHaveBeenCalled();
      expect(transport.connectionState).toBe('connected');
    });

    it('connect sets up response and status notification monitors', async () => {
      transport = createTransport();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      // Should have two monitorCharacteristicForService calls: response + status.
      expect(mockDevice.monitorCharacteristicForService).toHaveBeenCalledTimes(2);
      const monitorCalls = (mockDevice.monitorCharacteristicForService as jest.Mock).mock.calls;
      const monitoredUuids = monitorCalls.map(
        (call: unknown[]) => call[1],
      );
      expect(monitoredUuids).toContain(RESPONSE_CHAR_UUID);
      expect(monitoredUuids).toContain(STATUS_CHAR_UUID);
    });
  });

  // --------------------------------------------------------------------------
  // Disconnect
  // --------------------------------------------------------------------------

  describe('disconnect', () => {
    it('disconnect clears state and emits connectionStateChanged', async () => {
      transport = createTransport();
      const states: string[] = [];
      transport.on('connectionStateChanged', (state) => states.push(state));

      // Connect first.
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);
      await transport.connect('dev-1');

      states.length = 0; // Clear states from connect.

      await transport.disconnect();

      expect(transport.connectionState).toBe('disconnected');
      expect(transport.connectedDevice).toBeNull();
      expect(transport.isConnected).toBe(false);
      expect(states).toContain('disconnected');
      expect(manager.cancelDeviceConnection).toHaveBeenCalledWith('dev-1');
    });

    it('disconnect is safe to call when not connected', async () => {
      transport = createTransport();

      await expect(transport.disconnect()).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Chunked response reassembly
  // --------------------------------------------------------------------------

  describe('chunked response reassembly', () => {
    /**
     * Helper: connect a transport and return the response notification
     * callback so we can simulate incoming BLE notifications.
     */
    async function connectAndGetResponseCallback(): Promise<
      (error: unknown, char: Characteristic | null) => void
    > {
      transport = createTransport();
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      // Find the monitorCharacteristicForService call for the response char.
      const monitorCalls = (mockDevice.monitorCharacteristicForService as jest.Mock).mock.calls;
      const responseCall = monitorCalls.find(
        (call: unknown[]) => call[1] === RESPONSE_CHAR_UUID,
      );
      return responseCall[2];
    }

    it('single complete response is dispatched immediately', async () => {
      const notifyCb = await connectAndGetResponseCallback();
      const responses: string[] = [];
      transport.on('response', (json) => responses.push(json));

      const json = '{"status":"ok","data":{}}';
      const base64 = stringToBase64(json);
      notifyCb(null, new Characteristic(RESPONSE_CHAR_UUID, base64));

      expect(responses).toHaveLength(1);
      expect(responses[0]).toBe(json);
    });

    it('multi-chunk response is buffered and dispatched when complete', async () => {
      const notifyCb = await connectAndGetResponseCallback();
      const responses: string[] = [];
      transport.on('response', (json) => responses.push(json));

      const fullJson = '{"status":"ok","data":{"networks":[]}}';
      // Split into two chunks.
      const chunk1 = fullJson.slice(0, 15);
      const chunk2 = fullJson.slice(15);

      notifyCb(null, new Characteristic(RESPONSE_CHAR_UUID, stringToBase64(chunk1)));
      expect(responses).toHaveLength(0); // Not complete yet.

      notifyCb(null, new Characteristic(RESPONSE_CHAR_UUID, stringToBase64(chunk2)));
      expect(responses).toHaveLength(1);
      expect(responses[0]).toBe(fullJson);
    });

    it('multiple responses in sequence are dispatched separately', async () => {
      const notifyCb = await connectAndGetResponseCallback();
      const responses: string[] = [];
      transport.on('response', (json) => responses.push(json));

      const json1 = '{"status":"ok","data":{"a":1}}';
      const json2 = '{"status":"ok","data":{"b":2}}';

      notifyCb(null, new Characteristic(RESPONSE_CHAR_UUID, stringToBase64(json1)));
      notifyCb(null, new Characteristic(RESPONSE_CHAR_UUID, stringToBase64(json2)));

      expect(responses).toHaveLength(2);
      expect(responses[0]).toBe(json1);
      expect(responses[1]).toBe(json2);
    });

    it('status notifications are also reassembled correctly', async () => {
      transport = createTransport();
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      // Find the status notification callback.
      const monitorCalls = (mockDevice.monitorCharacteristicForService as jest.Mock).mock.calls;
      const statusCall = monitorCalls.find(
        (call: unknown[]) => call[1] === STATUS_CHAR_UUID,
      );
      const statusCb = statusCall[2];

      const statuses: string[] = [];
      transport.on('status', (json) => statuses.push(json));

      const statusJson = '{"state":"connected","ssid":"MyWifi"}';
      statusCb(null, new Characteristic(STATUS_CHAR_UUID, stringToBase64(statusJson)));

      expect(statuses).toHaveLength(1);
      expect(statuses[0]).toBe(statusJson);
    });

    it('notification error emits error event without crashing', async () => {
      const notifyCb = await connectAndGetResponseCallback();
      const errors: Error[] = [];
      transport.on('error', (err) => errors.push(err));

      notifyCb({ message: 'Notify failed' }, null);

      expect(errors).toHaveLength(1);
      expect(errors[0]!.message).toContain('Notify failed');
    });
  });

  // --------------------------------------------------------------------------
  // writeCommand
  // --------------------------------------------------------------------------

  describe('writeCommand', () => {
    it('encodes string to base64 and writes via characteristic', async () => {
      transport = createTransport();
      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      const jsonCmd = '{"cmd":"get_status"}';
      await transport.writeCommand(jsonCmd);

      expect(mockDevice.writeCharacteristicWithResponseForService).toHaveBeenCalledWith(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        stringToBase64(jsonCmd),
      );
    });

    it('throws when not connected', async () => {
      transport = createTransport();

      await expect(transport.writeCommand('{"cmd":"get_status"}')).rejects.toThrow(
        'Cannot write command: not connected',
      );
    });

    it('respects GATT settle delay between writes', async () => {
      jest.useRealTimers();

      transport = new BleTransport({
        scanTimeoutMs: 5000,
        gattSettleMs: 100,
        connectionTimeoutMs: 5000,
      });

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      // First write — no delay needed.
      const start = Date.now();
      await transport.writeCommand('{"cmd":"first"}');
      // Second write — should wait for GATT settle.
      await transport.writeCommand('{"cmd":"second"}');
      const elapsed = Date.now() - start;

      // The second write should have been delayed by approximately 100ms.
      // Allow some tolerance for test runner overhead.
      expect(elapsed).toBeGreaterThanOrEqual(80);

      expect(
        mockDevice.writeCharacteristicWithResponseForService,
      ).toHaveBeenCalledTimes(2);
    });

    it('emits error and rethrows when write fails', async () => {
      transport = createTransport();
      const errors: Error[] = [];
      transport.on('error', (err) => errors.push(err));

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      (mockDevice.writeCharacteristicWithResponseForService as jest.Mock).mockRejectedValueOnce(
        new Error('GATT write failed'),
      );

      await expect(transport.writeCommand('{"cmd":"fail"}')).rejects.toThrow(
        'GATT write failed',
      );
      expect(errors).toHaveLength(1);
    });
  });

  // --------------------------------------------------------------------------
  // destroy
  // --------------------------------------------------------------------------

  describe('destroy', () => {
    it('disconnects, removes BLE state subscription, and destroys BleManager', async () => {
      transport = createTransport();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');

      await transport.destroy();

      expect(transport.connectionState).toBe('disconnected');
      expect(transport.connectedDevice).toBeNull();
      expect(manager.cancelDeviceConnection).toHaveBeenCalled();
      expect(manager.destroy).toHaveBeenCalled();
    });

    it('can be called when not connected without error', async () => {
      transport = createTransport();
      await expect(transport.destroy()).resolves.toBeUndefined();
    });
  });

  // --------------------------------------------------------------------------
  // Unexpected disconnection
  // --------------------------------------------------------------------------

  describe('unexpected disconnection', () => {
    it('resets state when device disconnects unexpectedly', async () => {
      transport = createTransport();
      const states: string[] = [];
      transport.on('connectionStateChanged', (state) => states.push(state));

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');
      states.length = 0;

      // Simulate unexpected disconnection by triggering the onDeviceDisconnected callback.
      const disconnectCb = (manager.onDeviceDisconnected as jest.Mock).mock.calls[0][1];
      disconnectCb(null);

      expect(transport.connectionState).toBe('disconnected');
      expect(transport.connectedDevice).toBeNull();
      expect(states).toContain('disconnected');
    });

    it('resets state when Bluetooth adapter powers off', async () => {
      transport = createTransport();

      const manager = (transport as unknown as { bleManager: BleManager }).bleManager;
      const mockDevice = new Device('dev-1', 'ESP32-WiFi-ABC', -50, 517);
      setupDeviceWithCharacteristics(mockDevice);
      (manager.connectToDevice as jest.Mock).mockResolvedValue(mockDevice);

      await transport.connect('dev-1');
      expect(transport.isConnected).toBe(true);

      // Trigger the BLE adapter state change callback with PoweredOff.
      const stateChangeCb = (manager.onStateChange as jest.Mock).mock.calls[0][0];
      stateChangeCb(State.PoweredOff);

      expect(transport.connectionState).toBe('disconnected');
      expect(transport.connectedDevice).toBeNull();
    });
  });
});
