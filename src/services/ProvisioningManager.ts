/**
 * ProvisioningManager — Layer 4 of the ESP WiFi Config library.
 *
 * Owns the wizard step machine and coordinates BleTransport, DeviceProtocol,
 * and ConnectionPoller. Emits typed events so consumers (the Zustand store,
 * tests, headless callers) can react without coupling to lower layers.
 *
 * The manager never touches navigation APIs directly — `stepChanged` events
 * drive any UI navigation independently.
 */

import type {
  BleConnectionState,
  ConnectedDeviceInfo,
  DeviceConnection,
  DiscoveredDevice,
  OnConnectedCallback,
  ProvisioningConfig,
  ProvisioningError,
  ProvisioningManagerEvents,
  ProvisioningResult,
  ProvisioningStep,
  ScannedNetwork,
  WifiStatus,
} from '../types';

import {
  DEFAULT_NETWORK_PRIORITY,
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  DISCONNECT_SETTLE_MS,
} from '../constants/provisioning';

import { TypedEventEmitter, createLogger } from '../utils';

import { BleLibraryError } from '../types/ble';
import type { BleTransport } from './BleTransport';
import type { ConnectionPoller } from './ConnectionPoller';
import type { DeviceProtocol } from './DeviceProtocol';

const log = createLogger('ProvisioningManager');

// ---------------------------------------------------------------------------
// Resolved config with defaults applied
// ---------------------------------------------------------------------------

interface ResolvedFlowConfig {
  onConnected: OnConnectedCallback | null;
  defaultNetworkPriority: number;
  autoConnectOpenNetworks: boolean;
}

interface ResolvedPollerConfig {
  intervalMs: number;
  timeoutMs: number;
}

interface ResolvedProvisioningConfig {
  flow: ResolvedFlowConfig;
  poller: ResolvedPollerConfig;
}

function resolveConfig(config?: ProvisioningConfig): ResolvedProvisioningConfig {
  return {
    flow: {
      onConnected: config?.flow?.onConnected ?? null,
      defaultNetworkPriority:
        config?.flow?.defaultNetworkPriority ?? DEFAULT_NETWORK_PRIORITY,
      autoConnectOpenNetworks: config?.flow?.autoConnectOpenNetworks ?? true,
    },
    poller: {
      intervalMs: config?.poller?.intervalMs ?? DEFAULT_POLL_INTERVAL_MS,
      timeoutMs: config?.poller?.timeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
    },
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toErrorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Steps where an unexpected BLE disconnect should NOT raise an error. */
const DISCONNECT_SAFE_STEPS: ReadonlySet<ProvisioningStep> = new Set<ProvisioningStep>([
  'welcome',
  'scanBle',
  'connectingBle', // chooseDevice handles its own failure path
  'success',
  'manage',
]);

// ---------------------------------------------------------------------------
// ProvisioningManager
// ---------------------------------------------------------------------------

export class ProvisioningManager extends TypedEventEmitter<ProvisioningManagerEvents> {
  // -- Service references ---------------------------------------------------
  private readonly transport: BleTransport;
  private readonly protocol: DeviceProtocol;
  private readonly poller: ConnectionPoller;
  private readonly config: ResolvedProvisioningConfig;

  // -- Internal state -------------------------------------------------------
  private _step: ProvisioningStep = 'welcome';
  private _selectedNetwork: ScannedNetwork | null = null;
  private _scannedNetworks: ScannedNetwork[] = [];
  private _device: DeviceConnection = null;
  private _error: ProvisioningError | null = null;

  // -- Event unsubscribe handles -------------------------------------------
  private unsubscribeFns: Array<() => void> = [];

  // -----------------------------------------------------------------------
  // Constructor
  // -----------------------------------------------------------------------

  constructor(
    transport: BleTransport,
    protocol: DeviceProtocol,
    poller: ConnectionPoller,
    config?: ProvisioningConfig,
  ) {
    super();
    this.transport = transport;
    this.protocol = protocol;
    this.poller = poller;
    this.config = resolveConfig(config);

    this.subscribeToServices();

    log.info('ProvisioningManager created', { config: this.config });
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  /** Current step in the wizard state machine. */
  get currentStep(): ProvisioningStep {
    return this._step;
  }

  /** Currently selected network (after `chooseNetwork`), or `null`. */
  get selectedNetwork(): ScannedNetwork | null {
    return this._selectedNetwork;
  }

  /** Most recent WiFi scan results, RSSI-sorted. */
  get scannedNetworks(): ScannedNetwork[] {
    return this._scannedNetworks;
  }

  /** Current device-connection state. */
  get device(): DeviceConnection {
    return this._device;
  }

  /** Current error envelope, or `null` if no error is active. */
  get error(): ProvisioningError | null {
    return this._error;
  }

  // -----------------------------------------------------------------------
  // Public actions — verb-named, mapped 1:1 to user intent
  // -----------------------------------------------------------------------

  /**
   * Begin the wizard: clear state, transition to `scanBle`, start a BLE scan.
   * Safe to call from any step; will disconnect first if needed.
   */
  async start(): Promise<void> {
    log.info('start');
    await this.goToScanning();
  }

  /**
   * Choose a discovered BLE device and begin the connection sequence.
   * Drives the manager through `connectingBle` → `configuring` → (auto-skip
   * if no `onConnected`) → `scanningWifi` → `chooseNetwork`.
   */
  async chooseDevice(target: DiscoveredDevice): Promise<void> {
    log.info('chooseDevice:', target.name, target.id);
    this.clearError();

    // Update device state immediately so UI can show the spinner overlay
    // even while the BLE handshake runs.
    this._device = {
      status: 'connecting',
      id: target.id,
      name: target.name,
      rssi: target.rssi,
    };
    this.emit('deviceConnectionChanged', this._device);
    this.setStep('connectingBle');

    // Stop any running scan. Let the BLE stack settle before connecting —
    // Android's connectToDevice() can fail with "Operation was cancelled"
    // if the native scan teardown hasn't completed.
    this.transport.stopScan();
    await delay(DISCONNECT_SETTLE_MS);

    let info: ConnectedDeviceInfo;
    try {
      info = await this.transport.connect(target.id);
    } catch (err) {
      const code = err instanceof BleLibraryError ? err.code : undefined;
      this._device = null;
      this.emit('deviceConnectionChanged', null);
      this.setError({
        source: 'ble',
        code,
        message: toErrorMessage(err),
        recoverable: true,
      });
      this.setStep('scanBle');
      return;
    }

    this._device = {
      status: 'connected',
      id: info.id,
      name: info.name,
      mtu: info.mtu,
    };
    this.emit('deviceConnectionChanged', this._device);

    // Always enter `configuring` — runs `onConnected` if provided, or
    // auto-advances synchronously if not. Two distinct paths so the
    // step machine stays uniform.
    this.setStep('configuring');

    if (this.config.flow.onConnected) {
      try {
        await this.config.flow.onConnected({
          protocol: this.protocol,
          transport: this.transport,
        });
      } catch (err) {
        this.setError({
          source: 'flow',
          message: toErrorMessage(err),
          recoverable: true,
        });
        // Stay parked on `configuring` so consumer UI can show the error
        // and let the user retry from there.
        return;
      }
    }

    await this.proceedFromConfigure();
  }

  /**
   * Continue past the `configuring` step. Called automatically when no
   * `onConnected` callback is configured; consumer UIs that own the
   * `configuring` screen call it manually after their custom setup.
   */
  async proceedFromConfigure(): Promise<void> {
    if (this._step !== 'configuring') {
      log.warn('proceedFromConfigure called outside configuring step:', this._step);
      return;
    }
    this.clearError();
    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  /**
   * Re-run the WiFi scan from the network-list screen. Transitions
   * `chooseNetwork` → `scanningWifi` → `chooseNetwork`.
   */
  async rescanWifi(): Promise<void> {
    if (this._step !== 'chooseNetwork' && this._step !== 'scanningWifi') {
      log.warn('rescanWifi called from unsupported step:', this._step);
      return;
    }
    this.clearError();
    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  /**
   * Pick a WiFi network from the scanned list. Transitions to
   * `enterCredentials`.
   */
  chooseNetwork(network: ScannedNetwork): void {
    log.info('chooseNetwork:', network.ssid);
    this._selectedNetwork = network;
    this.emit('selectedNetworkChanged', network);
    this.setStep('enterCredentials');
  }

  /**
   * Return from `enterCredentials` to the network list without sending
   * credentials.
   */
  backToNetworks(): void {
    log.info('backToNetworks');
    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);
    this.setStep('chooseNetwork');
  }

  /**
   * Submit a WiFi password. Transitions immediately to `joiningWifi` so
   * the UI can render the joining screen, then sends `add_network` and
   * `connect` and starts the connection poller.
   */
  async submitPassword(password: string): Promise<void> {
    log.info('submitPassword for:', this._selectedNetwork?.ssid);
    this.clearError();

    if (!this._selectedNetwork) {
      this.setError({
        source: 'flow',
        code: 'no_network',
        message: 'No network selected',
        recoverable: false,
      });
      return;
    }

    const ssid = this._selectedNetwork.ssid;

    // Transition immediately for UI feedback. Reset the poller so any prior
    // run's terminal flag (connectionFailed) is cleared.
    this.poller.reset();
    this.setStep('joiningWifi');

    try {
      await this.protocol.addNetwork({
        ssid,
        password,
        priority: this.config.flow.defaultNetworkPriority,
      });
      await this.protocol.connectWifi(ssid);
    } catch (err) {
      this.setError({
        source: 'protocol',
        message: toErrorMessage(err),
        recoverable: true,
      });
      // Stay on joiningWifi — the failure is visible there and the user can retry.
      return;
    }

    this.poller.startPolling(
      this.config.poller.timeoutMs,
      this.config.poller.intervalMs,
    );
  }

  /**
   * Re-issue the connect command for the currently selected network and
   * restart polling. Use after a `connectionFailed` or `connectionTimedOut`.
   */
  async retryJoin(): Promise<void> {
    log.info('retryJoin for:', this._selectedNetwork?.ssid);
    this.clearError();

    if (!this._selectedNetwork) {
      this.setError({
        source: 'flow',
        code: 'no_network',
        message: 'No network selected',
        recoverable: false,
      });
      return;
    }

    this.poller.reset();
    try {
      await this.protocol.connectWifi(this._selectedNetwork.ssid);
    } catch (err) {
      this.setError({
        source: 'protocol',
        message: toErrorMessage(err),
        recoverable: true,
      });
      return;
    }
    this.poller.startPolling(
      this.config.poller.timeoutMs,
      this.config.poller.intervalMs,
    );
  }

  /**
   * Delete the currently selected (failed) network and return to the
   * network list. `del_network` failures are logged but non-fatal.
   */
  async pickDifferentNetwork(): Promise<void> {
    log.info('pickDifferentNetwork');
    this.poller.reset();

    if (this._selectedNetwork) {
      try {
        await this.protocol.delNetwork(this._selectedNetwork.ssid);
      } catch (err) {
        log.warn('delNetwork failed (continuing):', toErrorMessage(err));
      }
    }

    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);

    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  /**
   * Disconnect from the current device and return to BLE scanning.
   */
  async pickDifferentDevice(): Promise<void> {
    log.info('pickDifferentDevice');
    await this.goToScanning();
  }

  /**
   * User-initiated cancel. Disconnects, clears all state, returns to
   * `welcome`. Equivalent to closing the wizard.
   */
  async cancel(): Promise<void> {
    log.info('cancel');

    // Set step to 'welcome' BEFORE disconnecting so the disconnect listener
    // sees a safe step and doesn't raise a spurious "connection lost" error.
    this._step = 'welcome';
    this._selectedNetwork = null;
    this._scannedNetworks = [];
    this._device = null;
    this._error = null;

    this.poller.reset();

    try {
      await this.transport.disconnect();
    } catch (err) {
      log.warn('Disconnect during cancel failed (ignoring):', toErrorMessage(err));
    }

    this.emit('provisioningReset');
    this.emit('stepChanged', 'welcome');
    this.emit('selectedNetworkChanged', null);
    this.emit('scannedNetworksUpdated', []);
    this.emit('deviceConnectionChanged', null);
    this.emit('errorChanged', null);
  }

  /**
   * Transition from `success` to `manage` for post-provisioning device tools.
   */
  goToManage(): void {
    log.info('goToManage');
    this.setStep('manage');
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  /** Tear down all event subscriptions and clear state. */
  async destroy(): Promise<void> {
    log.info('destroy');
    await this.cancel();
    this.unsubscribeFromServices();
    this.removeAllListeners();
    log.info('ProvisioningManager destroyed');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async goToScanning(): Promise<void> {
    this.clearError();
    this.poller.reset();
    this._selectedNetwork = null;
    this._scannedNetworks = [];
    this._device = null;
    this.emit('selectedNetworkChanged', null);
    this.emit('scannedNetworksUpdated', []);
    this.emit('deviceConnectionChanged', null);

    if (this.transport.isConnected) {
      try {
        await this.transport.disconnect();
        await delay(DISCONNECT_SETTLE_MS);
      } catch (err) {
        log.warn('Disconnect before scan failed (continuing):', toErrorMessage(err));
      }
    }

    this.setStep('scanBle');
    try {
      await this.transport.startScan();
    } catch (err) {
      this.setError({
        source: 'ble',
        message: toErrorMessage(err),
        recoverable: true,
      });
    }
  }

  private async runWifiScan(): Promise<void> {
    try {
      const result = await this.protocol.scan();
      const networks = [...(result.networks ?? [])].sort(
        (a, b) => b.rssi - a.rssi,
      );
      this._scannedNetworks = networks;
      this.emit('scannedNetworksUpdated', networks);
      this.setStep('chooseNetwork');
      log.info(`Found ${networks.length} WiFi networks`);
    } catch (err) {
      this.setError({
        source: 'protocol',
        message: toErrorMessage(err),
        recoverable: true,
      });
      // Land on chooseNetwork so the user can retry via rescanWifi().
      this.setStep('chooseNetwork');
    }
  }

  private setStep(step: ProvisioningStep): void {
    if (this._step === step) return;
    const previous = this._step;
    this._step = step;
    log.info(`Step: ${previous} -> ${step}`);
    this.emit('stepChanged', step);
  }

  private setError(error: ProvisioningError): void {
    log.warn('Error:', error.source, error.message);
    this._error = error;
    this.emit('errorChanged', error);
  }

  private clearError(): void {
    if (this._error === null) return;
    this._error = null;
    this.emit('errorChanged', null);
  }

  // -----------------------------------------------------------------------
  // Service event subscriptions
  // -----------------------------------------------------------------------

  private subscribeToServices(): void {
    // Transport: react to unexpected disconnects mid-flow.
    this.unsubscribeFns.push(
      this.transport.on('connectionStateChanged', (state: BleConnectionState) => {
        if (state === 'disconnected' && !DISCONNECT_SAFE_STEPS.has(this._step)) {
          log.warn('Bluetooth connection lost during step:', this._step);
          this._device = null;
          this.emit('deviceConnectionChanged', null);
          this.setError({
            source: 'ble',
            code: 'connection_lost',
            message: 'Bluetooth connection lost',
            recoverable: false,
          });
          void this.cancel();
        }
      }),
    );

    // Transport: surface BLE-level errors (adapter off, unauthorized) when
    // the user is in the early scanning stage. These typically cancel the
    // current scan.
    this.unsubscribeFns.push(
      this.transport.on('error', (err: Error) => {
        if (
          err instanceof BleLibraryError &&
          (this._step === 'scanBle' || this._step === 'welcome')
        ) {
          this.setError({
            source: 'ble',
            code: err.code,
            message: err.message,
            recoverable: false,
          });
        }
      }),
    );

    // Poller: WiFi connection succeeded.
    this.unsubscribeFns.push(
      this.poller.on('connectionSucceeded', (status: WifiStatus) => {
        log.info('Connection succeeded:', status.ssid, status.ip);
        this.setStep('success');
        const result: ProvisioningResult = {
          success: true,
          ssid: status.ssid,
          ip: status.ip,
          deviceName: this.transport.connectedDevice?.name,
          deviceId: this.transport.connectedDevice?.id,
        };
        this.emit('provisioningComplete', result);
      }),
    );

    // Poller: WiFi connection failed (saw connecting -> disconnected).
    this.unsubscribeFns.push(
      this.poller.on('connectionFailed', () => {
        this.setError({
          source: 'poller',
          code: 'connection_failed',
          message: 'WiFi connection failed. You can retry or pick a different network.',
          recoverable: true,
        });
      }),
    );

    // Poller: WiFi connection timed out.
    this.unsubscribeFns.push(
      this.poller.on('connectionTimedOut', () => {
        this.setError({
          source: 'poller',
          code: 'connection_timeout',
          message: 'WiFi connection timed out. You can retry or pick a different network.',
          recoverable: true,
        });
      }),
    );

    // Poller: forward WiFi state changes for UI rendering.
    this.unsubscribeFns.push(
      this.poller.on('wifiStateChanged', (status: WifiStatus) => {
        this.emit('wifiStatusUpdated', status);
      }),
    );
  }

  private unsubscribeFromServices(): void {
    for (const unsub of this.unsubscribeFns) unsub();
    this.unsubscribeFns = [];
  }
}
