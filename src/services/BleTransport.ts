/**
 * BleTransport — Layer 1 of the ESP WiFi Manager library.
 *
 * Wraps react-native-ble-plx to provide:
 *  - BLE scanning filtered by device name prefix
 *  - Connection with MTU negotiation and characteristic discovery
 *  - Write-with-response on the Command characteristic (with GATT settle delay)
 *  - Notification monitoring on Response and Status characteristics
 *  - Chunked JSON reassembly from notification fragments
 *  - Typed event emission for all transport-level events
 */

import {
  BleManager,
  Device,
  Characteristic,
  Subscription,
  BleError,
  State,
} from 'react-native-ble-plx';

import type {
  BleConnectionState,
  DiscoveredDevice,
  ConnectedDeviceInfo,
  BleTransportEvents,
  BleTransportConfig,
} from '../types';

import {
  SERVICE_UUID,
  STATUS_CHAR_UUID,
  COMMAND_CHAR_UUID,
  RESPONSE_CHAR_UUID,
  DEVICE_NAME_PREFIX,
  GATT_SETTLE_MS,
  DEFAULT_SCAN_TIMEOUT_MS,
  DEFAULT_CONNECTION_TIMEOUT_MS,
  DEFAULT_REQUESTED_MTU,
} from '../constants/ble';

import {
  TypedEventEmitter,
  stringToBase64,
  base64ToString,
  createLogger,
} from '../utils';

const log = createLogger('BleTransport');

/** Resolved config with all defaults applied. */
interface ResolvedConfig {
  deviceNamePrefix: string;
  scanTimeoutMs: number;
  gattSettleMs: number;
  connectionTimeoutMs: number;
  requestedMtu: number;
}

function resolveConfig(config?: BleTransportConfig): ResolvedConfig {
  return {
    deviceNamePrefix: config?.deviceNamePrefix ?? DEVICE_NAME_PREFIX,
    scanTimeoutMs: config?.scanTimeoutMs ?? DEFAULT_SCAN_TIMEOUT_MS,
    gattSettleMs: config?.gattSettleMs ?? GATT_SETTLE_MS,
    connectionTimeoutMs: config?.connectionTimeoutMs ?? DEFAULT_CONNECTION_TIMEOUT_MS,
    requestedMtu: config?.requestedMtu ?? DEFAULT_REQUESTED_MTU,
  };
}

export class BleTransport extends TypedEventEmitter<BleTransportEvents> {
  // ── Core BLE references ──────────────────────────────────────────────
  private readonly bleManager: BleManager;
  private readonly config: ResolvedConfig;

  // ── Connection state ─────────────────────────────────────────────────
  private _connectionState: BleConnectionState = 'disconnected';
  private device: Device | null = null;
  private _connectedDeviceInfo: ConnectedDeviceInfo | null = null;

  // ── Subscription handles ─────────────────────────────────────────────
  private responseSubscription: Subscription | null = null;
  private statusSubscription: Subscription | null = null;
  private disconnectSubscription: Subscription | null = null;
  private bleStateSubscription: Subscription | null = null;
  private scanTimeoutId: ReturnType<typeof setTimeout> | null = null;

  // ── Write throttle ──────────────────────────────────────────────────
  private lastWriteTime = 0;

  // ── Chunked response reassembly buffers ──────────────────────────────
  private responseBuffer = '';
  private statusBuffer = '';

  // ── Deduplication for scan results ───────────────────────────────────
  private discoveredDeviceIds = new Set<string>();

  // ────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────

  constructor(config?: BleTransportConfig) {
    super();
    this.config = resolveConfig(config);
    this.bleManager = new BleManager();

    // Monitor adapter state so we can react to Bluetooth being turned off.
    this.bleStateSubscription = this.bleManager.onStateChange((state: State) => {
      log.debug('BLE adapter state changed:', state);
      if (state === State.PoweredOff && this._connectionState !== 'disconnected') {
        log.warn('Bluetooth powered off — cleaning up connection');
        this.handleUnexpectedDisconnect();
      }
    }, true);

    log.info('BleTransport created', { config: this.config });
  }

  // ────────────────────────────────────────────────────────────────────
  // Public getters
  // ────────────────────────────────────────────────────────────────────

  get isConnected(): boolean {
    return this._connectionState === 'connected';
  }

  get connectedDevice(): ConnectedDeviceInfo | null {
    return this._connectedDeviceInfo;
  }

  get connectionState(): BleConnectionState {
    return this._connectionState;
  }

  // ────────────────────────────────────────────────────────────────────
  // Scanning
  // ────────────────────────────────────────────────────────────────────

  async startScan(): Promise<void> {
    if (this._connectionState === 'scanning') {
      log.warn('Scan already in progress');
      return;
    }
    if (this._connectionState === 'connected' || this._connectionState === 'connecting') {
      log.warn('Cannot scan while connected or connecting');
      return;
    }

    // Ensure the BLE adapter is ready before starting a scan.
    const ready = await this.waitForPoweredOn();
    if (!ready) return;

    log.info('Starting BLE scan', { prefix: this.config.deviceNamePrefix });
    this.discoveredDeviceIds.clear();
    this.setConnectionState('scanning');

    this.bleManager.startDeviceScan(null, null, (error: BleError | null, device: Device | null) => {
      if (error) {
        log.error('Scan error:', error.message);
        this.emit('error', new Error(`BLE scan error: ${error.message}`));
        this.stopScanInternal();
        this.setConnectionState('disconnected');
        this.emit('scanStopped');
        return;
      }

      if (!device) {
        return;
      }

      const name = device.name ?? device.localName;
      if (!name || !name.startsWith(this.config.deviceNamePrefix)) {
        return;
      }

      // Deduplicate — only emit once per device per scan session.
      if (this.discoveredDeviceIds.has(device.id)) {
        return;
      }
      this.discoveredDeviceIds.add(device.id);

      const discovered: DiscoveredDevice = {
        id: device.id,
        name,
        rssi: device.rssi ?? 0,
      };

      log.debug('Device discovered:', discovered);
      this.emit('deviceDiscovered', discovered);
    });

    // Auto-stop after timeout.
    this.scanTimeoutId = setTimeout(() => {
      log.info('Scan timeout reached');
      this.stopScan();
    }, this.config.scanTimeoutMs);
  }

  stopScan(): void {
    if (this._connectionState !== 'scanning') {
      return;
    }

    this.stopScanInternal();
    this.setConnectionState('disconnected');
    this.emit('scanStopped');
    log.info('Scan stopped');
  }

  // ────────────────────────────────────────────────────────────────────
  // Connection
  // ────────────────────────────────────────────────────────────────────

  async connect(deviceId: string): Promise<ConnectedDeviceInfo> {
    log.info('Connecting to device:', deviceId);

    // Stop any active scan before connecting.
    if (this._connectionState === 'scanning') {
      this.stopScanInternal();
      this.emit('scanStopped');
    }

    this.setConnectionState('connecting');

    // Ensure the BLE adapter is ready before connecting.
    const ready = await this.waitForPoweredOn();
    if (!ready) {
      this.setConnectionState('disconnected');
      throw new Error('Bluetooth adapter is not ready');
    }

    try {
      // 1. Connect to the device.
      const connectedDevice = await this.bleManager.connectToDevice(deviceId, {
        requestMTU: this.config.requestedMtu,
        timeout: this.config.connectionTimeoutMs,
      });

      log.debug('Device connected, discovering services...');

      // 2. Discover all services and characteristics.
      const discoveredDevice = await connectedDevice.discoverAllServicesAndCharacteristics();
      this.device = discoveredDevice;

      // 3. Find and validate our three characteristics.
      const characteristics = await discoveredDevice.characteristicsForService(SERVICE_UUID);
      log.debug(`Found ${characteristics.length} characteristics for service ${SERVICE_UUID}`);

      const statusCharUuidLower = STATUS_CHAR_UUID.toLowerCase();
      const commandCharUuidLower = COMMAND_CHAR_UUID.toLowerCase();
      const responseCharUuidLower = RESPONSE_CHAR_UUID.toLowerCase();

      let foundStatus = false;
      let foundCommand = false;
      let foundResponse = false;

      for (const char of characteristics) {
        const uuid = char.uuid.toLowerCase();
        if (uuid === statusCharUuidLower) {
          foundStatus = true;
        } else if (uuid === commandCharUuidLower) {
          foundCommand = true;
        } else if (uuid === responseCharUuidLower) {
          foundResponse = true;
        }
      }

      if (!foundStatus || !foundCommand || !foundResponse) {
        const missing = [
          !foundStatus && 'Status',
          !foundCommand && 'Command',
          !foundResponse && 'Response',
        ].filter(Boolean);
        throw new Error(
          `Missing required characteristics: ${missing.join(', ')}. ` +
            'Ensure the ESP32 firmware exposes the WiFi Manager BLE service.',
        );
      }

      // 4. Set up notification monitoring on Response characteristic.
      this.responseBuffer = '';
      this.responseSubscription = discoveredDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        RESPONSE_CHAR_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            log.error('Response notification error:', error.message);
            this.emit('error', new Error(`Response notification error: ${error.message}`));
            return;
          }
          if (characteristic?.value) {
            this.handleNotification('response', characteristic.value);
          }
        },
      );

      // 5. Set up notification monitoring on Status characteristic.
      this.statusBuffer = '';
      this.statusSubscription = discoveredDevice.monitorCharacteristicForService(
        SERVICE_UUID,
        STATUS_CHAR_UUID,
        (error: BleError | null, characteristic: Characteristic | null) => {
          if (error) {
            log.error('Status notification error:', error.message);
            this.emit('error', new Error(`Status notification error: ${error.message}`));
            return;
          }
          if (characteristic?.value) {
            this.handleNotification('status', characteristic.value);
          }
        },
      );

      // 6. Monitor unexpected disconnection from the device side.
      this.disconnectSubscription = this.bleManager.onDeviceDisconnected(
        deviceId,
        (error: BleError | null) => {
          log.warn('Device disconnected unexpectedly', error?.message);
          this.handleUnexpectedDisconnect();
        },
      );

      // 7. Build the connected device info.
      const deviceName = discoveredDevice.name ?? discoveredDevice.localName ?? deviceId;
      this._connectedDeviceInfo = {
        id: discoveredDevice.id,
        name: deviceName,
        mtu: discoveredDevice.mtu ?? null,
      };

      this.setConnectionState('connected');
      log.info('Connected successfully', this._connectedDeviceInfo);

      return this._connectedDeviceInfo;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Connection failed:', error.message);
      this.cleanupSubscriptions();

      // Cancel the BLE-level connection to avoid a phantom radio connection
      // (e.g. when characteristic validation fails after the radio connects).
      if (this.device?.id) {
        try {
          await this.bleManager.cancelDeviceConnection(this.device.id);
        } catch {
          // Device may already be gone — ignore.
        }
      }

      this.device = null;
      this._connectedDeviceInfo = null;
      this.setConnectionState('disconnected');
      this.emit('error', error);
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Disconnection
  // ────────────────────────────────────────────────────────────────────

  async disconnect(): Promise<void> {
    log.info('Disconnect requested');
    const deviceId = this.device?.id;

    this.cleanupSubscriptions();

    if (deviceId) {
      try {
        await this.bleManager.cancelDeviceConnection(deviceId);
        log.debug('Device connection cancelled');
      } catch (err) {
        // Ignore errors during disconnect — the device may already be gone.
        log.debug('Ignoring disconnect error:', err);
      }
    }

    this.device = null;
    this._connectedDeviceInfo = null;
    this.responseBuffer = '';
    this.statusBuffer = '';
    this.lastWriteTime = 0;
    this.setConnectionState('disconnected');
  }

  // ────────────────────────────────────────────────────────────────────
  // Write
  // ────────────────────────────────────────────────────────────────────

  async writeCommand(jsonString: string): Promise<void> {
    if (!this.device || this._connectionState !== 'connected') {
      throw new Error('Cannot write command: not connected');
    }

    // Enforce GATT settle delay to avoid "GATT operation already in progress" errors.
    const elapsed = Date.now() - this.lastWriteTime;
    const delay = Math.max(0, this.config.gattSettleMs - elapsed);

    if (delay > 0) {
      log.debug(`GATT settle delay: ${delay}ms`);
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }

    const base64Value = stringToBase64(jsonString);
    log.debug('Writing command:', jsonString.length, 'chars,', base64Value.length, 'base64 bytes');

    try {
      await this.device.writeCharacteristicWithResponseForService(
        SERVICE_UUID,
        COMMAND_CHAR_UUID,
        base64Value,
      );
      this.lastWriteTime = Date.now();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Write command failed:', error.message);
      this.emit('error', error);
      throw error;
    }
  }

  // ────────────────────────────────────────────────────────────────────
  // Destroy
  // ────────────────────────────────────────────────────────────────────

  async destroy(): Promise<void> {
    log.info('Destroying BleTransport');

    await this.disconnect();

    if (this.bleStateSubscription) {
      this.bleStateSubscription.remove();
      this.bleStateSubscription = null;
    }

    this.removeAllListeners();
    this.bleManager.destroy();

    log.info('BleTransport destroyed');
  }

  // ────────────────────────────────────────────────────────────────────
  // Private helpers
  // ────────────────────────────────────────────────────────────────────

  /**
   * Handle a base64-encoded notification from Response or Status characteristic.
   * Appends decoded text to the appropriate buffer and emits when a complete
   * JSON object has been received (detected by trailing '}').
   */
  private handleNotification(type: 'response' | 'status', base64Value: string): void {
    const chunk = base64ToString(base64Value);
    log.debug(`${type} notification chunk:`, chunk.length, 'chars');

    if (type === 'response') {
      this.responseBuffer += chunk;
      if (this.responseBuffer.trimEnd().endsWith('}')) {
        const completeJson = this.responseBuffer;
        this.responseBuffer = '';
        log.debug('Complete response JSON received:', completeJson.length, 'chars');
        this.emit('response', completeJson);
      }
    } else {
      this.statusBuffer += chunk;
      if (this.statusBuffer.trimEnd().endsWith('}')) {
        const completeJson = this.statusBuffer;
        this.statusBuffer = '';
        log.debug('Complete status JSON received:', completeJson.length, 'chars');
        this.emit('status', completeJson);
      }
    }
  }

  /**
   * Wait for the BLE adapter to reach PoweredOn state.
   *
   * Uses a polling approach instead of onStateChange(_, true) because
   * react-native-ble-plx has an unhandled-rejection bug in that code path
   * when the CBCentralManager is still in Unknown state.
   *
   * Returns true if PoweredOn, false if unavailable (emits error events).
   */
  private async waitForPoweredOn(): Promise<boolean> {
    const maxWaitMs = 10_000;
    const pollMs = 200;
    const deadline = Date.now() + maxWaitMs;

    while (Date.now() < deadline) {
      let state: State;
      try {
        state = await this.bleManager.state();
      } catch {
        // state() can throw BleErrorCode 103 before CBCentralManager is ready
        state = State.Unknown;
      }

      if (state === State.PoweredOn) {
        return true;
      }

      if (state === State.PoweredOff || state === State.Unauthorized) {
        log.error('BLE adapter unavailable:', state);
        this.setConnectionState('disconnected');
        this.emit('scanStopped');
        this.emit('error', new Error(`Bluetooth is ${state}`));
        return false;
      }

      // Still Unknown or Resetting — wait and retry
      await new Promise<void>((r) => setTimeout(r, pollMs));
    }

    // Timed out waiting for BLE adapter
    log.error('Timed out waiting for BLE adapter to power on');
    this.setConnectionState('disconnected');
    this.emit('scanStopped');
    this.emit('error', new Error('Bluetooth adapter did not become ready'));
    return false;
  }

  /** Handle unexpected disconnection (device side or Bluetooth off). */
  private handleUnexpectedDisconnect(): void {
    const deviceId = this.device?.id;
    this.cleanupSubscriptions();
    this.device = null;
    this._connectedDeviceInfo = null;
    this.responseBuffer = '';
    this.statusBuffer = '';
    this.lastWriteTime = 0;
    this.setConnectionState('disconnected');

    // Close the Android GATT client to free resources. cancelDeviceConnection
    // is safe to call on an already-disconnected device.
    if (deviceId) {
      this.bleManager.cancelDeviceConnection(deviceId).catch(() => {
        // Expected to fail if the device is already fully gone — ignore.
      });
    }
  }

  /** Stop the BLE scan and clear the timeout, without emitting events. */
  private stopScanInternal(): void {
    if (this.scanTimeoutId !== null) {
      clearTimeout(this.scanTimeoutId);
      this.scanTimeoutId = null;
    }
    this.bleManager.stopDeviceScan();
  }

  /** Remove all characteristic and disconnection subscriptions. */
  private cleanupSubscriptions(): void {
    if (this.responseSubscription) {
      this.responseSubscription.remove();
      this.responseSubscription = null;
    }
    if (this.statusSubscription) {
      this.statusSubscription.remove();
      this.statusSubscription = null;
    }
    if (this.disconnectSubscription) {
      this.disconnectSubscription.remove();
      this.disconnectSubscription = null;
    }
  }

  /** Update connection state and emit the change event. */
  private setConnectionState(state: BleConnectionState): void {
    if (this._connectionState === state) {
      return;
    }
    const previous = this._connectionState;
    this._connectionState = state;
    log.info(`Connection state: ${previous} -> ${state}`);
    this.emit('connectionStateChanged', state);
  }
}
