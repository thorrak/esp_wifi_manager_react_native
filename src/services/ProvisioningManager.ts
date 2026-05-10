/**
 * ProvisioningManager — Layer 3 of the ESP WiFi Config library.
 *
 * Owns the wizard step machine and coordinates BleTransport + DeviceProtocol.
 * Emits typed events so consumers (the Zustand store, tests, headless
 * callers) can react without coupling to lower layers.
 *
 * Compared to v1 there is no separate ConnectionPoller — the SDK's
 * `provision()` is atomic (sends credentials AND waits for STA-connect
 * success/failure), so the joiningWifi step resolves directly off the
 * promise.
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
  ProvisionResult,
  ScannedNetwork,
} from '../types';

import { DISCONNECT_SETTLE_MS } from '../constants/provisioning';
import { DEFAULT_PROVISION_TIMEOUT_MS } from '../constants/protocol';

import { TypedEventEmitter, createLogger } from '../utils';

import { BleLibraryError } from '../types/ble';
import type { BleTransport } from './BleTransport';
import type { DeviceProtocol } from './DeviceProtocol';

const log = createLogger('ProvisioningManager');

// ---------------------------------------------------------------------------
// Resolved config
// ---------------------------------------------------------------------------

interface ResolvedFlowConfig {
  onConnected: OnConnectedCallback | null;
  autoConnectOpenNetworks: boolean;
  provisionTimeoutMs: number;
}

interface ResolvedProvisioningConfig {
  flow: ResolvedFlowConfig;
}

function resolveConfig(
  config?: ProvisioningConfig,
): ResolvedProvisioningConfig {
  return {
    flow: {
      onConnected: config?.flow?.onConnected ?? null,
      autoConnectOpenNetworks: config?.flow?.autoConnectOpenNetworks ?? true,
      provisionTimeoutMs:
        config?.flow?.provisionTimeoutMs ?? DEFAULT_PROVISION_TIMEOUT_MS,
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
  'connectingBle',
  'success',
  'manage',
]);

// ---------------------------------------------------------------------------
// ProvisioningManager
// ---------------------------------------------------------------------------

export class ProvisioningManager extends TypedEventEmitter<ProvisioningManagerEvents> {
  private readonly transport: BleTransport;
  private readonly protocol: DeviceProtocol;
  private readonly config: ResolvedProvisioningConfig;

  private _step: ProvisioningStep = 'welcome';
  private _selectedNetwork: ScannedNetwork | null = null;
  private _scannedNetworks: ScannedNetwork[] = [];
  private _device: DeviceConnection = null;
  private _error: ProvisioningError | null = null;

  private unsubscribeFns: Array<() => void> = [];

  constructor(
    transport: BleTransport,
    protocol: DeviceProtocol,
    config?: ProvisioningConfig,
  ) {
    super();
    this.transport = transport;
    this.protocol = protocol;
    this.config = resolveConfig(config);

    this.subscribeToServices();
    log.info('ProvisioningManager created');
  }

  // -----------------------------------------------------------------------
  // Public getters
  // -----------------------------------------------------------------------

  get currentStep(): ProvisioningStep {
    return this._step;
  }
  get selectedNetwork(): ScannedNetwork | null {
    return this._selectedNetwork;
  }
  get scannedNetworks(): ScannedNetwork[] {
    return this._scannedNetworks;
  }
  get device(): DeviceConnection {
    return this._device;
  }
  get error(): ProvisioningError | null {
    return this._error;
  }

  // -----------------------------------------------------------------------
  // Public actions
  // -----------------------------------------------------------------------

  async start(): Promise<void> {
    log.info('start');
    await this.goToScanning();
  }

  async chooseDevice(target: DiscoveredDevice): Promise<void> {
    log.info('chooseDevice:', target.name, target.id);
    this.clearError();

    this._device = {
      status: 'connecting',
      id: target.id,
      name: target.name,
      rssi: target.rssi,
    };
    this.emit('deviceConnectionChanged', this._device);
    this.setStep('connectingBle');

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
        return;
      }
    }

    await this.proceedFromConfigure();
  }

  async proceedFromConfigure(): Promise<void> {
    if (this._step !== 'configuring') {
      log.warn('proceedFromConfigure called outside configuring step:', this._step);
      return;
    }
    this.clearError();
    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  async rescanWifi(): Promise<void> {
    if (this._step !== 'chooseNetwork' && this._step !== 'scanningWifi') {
      log.warn('rescanWifi called from unsupported step:', this._step);
      return;
    }
    this.clearError();
    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  chooseNetwork(network: ScannedNetwork): void {
    log.info('chooseNetwork:', network.ssid);
    this._selectedNetwork = network;
    this.emit('selectedNetworkChanged', network);
    this.setStep('enterCredentials');
  }

  backToNetworks(): void {
    log.info('backToNetworks');
    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);
    this.setStep('chooseNetwork');
  }

  /**
   * Submit the WiFi password and run the SDK's atomic provision() call.
   * Resolves to `success` on success or sets a `provision`-source error
   * on failure (recoverable so the user can retry / pick a different
   * network).
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
    this.setStep('joiningWifi');

    let result: ProvisionResult;
    try {
      result = await this.protocol.provision(
        ssid,
        password,
        this.config.flow.provisionTimeoutMs,
      );
    } catch (err) {
      this.setError({
        source: 'provision',
        code: 'provision_failed',
        message: toErrorMessage(err),
        recoverable: true,
      });
      return;
    }

    this.emit('provisionResult', result);
    this.setStep('success');
    const provisionResult: ProvisioningResult = {
      success: true,
      ssid: result.ssid,
      provisionStatus: result.status,
      deviceName: this.transport.connectedDevice?.name,
      deviceId: this.transport.connectedDevice?.id,
    };
    this.emit('provisioningComplete', provisionResult);
  }

  /**
   * Retry the SDK provision() call with the same network. Use when the
   * previous attempt produced a `provision`-source error.
   */
  async retryJoin(password?: string): Promise<void> {
    log.info('retryJoin for:', this._selectedNetwork?.ssid);
    if (!this._selectedNetwork) {
      this.setError({
        source: 'flow',
        code: 'no_network',
        message: 'No network selected',
        recoverable: false,
      });
      return;
    }
    if (password === undefined) {
      // No stored password (we don't keep it in memory); ask for it again.
      this.clearError();
      this.setStep('enterCredentials');
      return;
    }
    await this.submitPassword(password);
  }

  /**
   * Clear the failed selection and return to the network list. The SDK
   * doesn't keep credentials between provision() calls, so there's
   * nothing to undo on the device side — this is purely a UI reset.
   */
  async pickDifferentNetwork(): Promise<void> {
    log.info('pickDifferentNetwork');
    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);
    this.setStep('scanningWifi');
    await this.runWifiScan();
  }

  async pickDifferentDevice(): Promise<void> {
    log.info('pickDifferentDevice');
    await this.goToScanning();
  }

  async cancel(): Promise<void> {
    log.info('cancel');

    this._step = 'welcome';
    this._selectedNetwork = null;
    this._scannedNetworks = [];
    this._device = null;
    this._error = null;

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

  goToManage(): void {
    log.info('goToManage');
    this.setStep('manage');
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async destroy(): Promise<void> {
    log.info('destroy');
    await this.cancel();
    this.unsubscribeFromServices();
    this.removeAllListeners();
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private async goToScanning(): Promise<void> {
    this.clearError();
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
      const networks = (await this.protocol.scanWifi()).sort(
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

  private subscribeToServices(): void {
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
  }

  private unsubscribeFromServices(): void {
    for (const unsub of this.unsubscribeFns) unsub();
    this.unsubscribeFns = [];
  }
}
