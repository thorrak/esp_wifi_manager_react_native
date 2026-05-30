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
  DeviceAuthCredentials,
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

/**
 * Steps where an unexpected BLE disconnect should NOT raise an error.
 *
 * `joiningWifi` IS included. The `esp_wifi_config` firmware reboots on
 * successful provisioning (default on) and tears down BLE — and it does
 * so *as soon as the client disconnects after seeing "connected"*, which
 * can race the resolution of the SDK's atomic `provision()`. If the BLE
 * drop is observed while we're still on `joiningWifi`, treating it as a
 * fatal `connection_lost` would clobber a provision that actually
 * succeeded (the device is on WiFi and rebooting). Per the protocol spec
 * (§18.2), a BLE disconnect shortly after apply must be treated as
 * success, not failure — so `joiningWifi` is disconnect-safe and the
 * real outcome is taken from the `provision()` promise (success → the
 * `success` step; rejection → a `provision`-source error).
 */
const DISCONNECT_SAFE_STEPS: ReadonlySet<ProvisioningStep> = new Set<ProvisioningStep>([
  'welcome',
  'scanBle',
  'enterDeviceAuth',
  'connectingBle',
  'joiningWifi',
  'success',
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

  // Held across the chooseDevice → enterDeviceAuth → connectingBle path so
  // the auth-screen submission and unauthorized-retry bounce don't have to
  // re-discover the target.
  private _pendingDevice: DiscoveredDevice | null = null;
  // Per-flow auth overrides captured from `enterDeviceAuth` and re-passed
  // on retry so the screen can pre-fill the last entered values.
  private _pendingAuth: DeviceAuthCredentials | null = null;
  // Sticky once a connect attempt has been rejected as unauthorized — forces
  // the auth screen to render on the next chooseDevice even if the config
  // would normally skip it. Cleared on successful connect or cancel.
  private _forceAuthPrompt = false;

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
    this._pendingDevice = target;

    this.transport.stopScan();
    await delay(DISCONNECT_SETTLE_MS);

    if (this.shouldPromptForAuth()) {
      // Park on enterDeviceAuth and wait for submitDeviceAuth() to drive
      // the actual connect. Don't reset _pendingAuth — if we're here as
      // an unauthorized retry, the screen will pre-fill the last values.
      this.setStep('enterDeviceAuth');
      return;
    }

    // Skipping the auth screen — fall through with no per-flow overrides
    // so the transport uses its configured defaults.
    this._pendingAuth = null;
    await this._connectAfterAuth();
  }

  /**
   * Submit per-flow device auth credentials captured from the
   * `enterDeviceAuth` screen. Stores them as overrides for the upcoming
   * connect attempt and advances to `connectingBle`.
   *
   * Required fields vary by security version:
   *   - sec1: `pop`
   *   - sec2: `pop` (SRP password) + `username`
   *
   * If `username` is omitted for sec2, falls back to the configured default.
   */
  async submitDeviceAuth(creds: DeviceAuthCredentials): Promise<void> {
    if (this._step !== 'enterDeviceAuth') {
      log.warn('submitDeviceAuth called outside enterDeviceAuth step:', this._step);
      return;
    }
    if (!this._pendingDevice) {
      this.setError({
        source: 'flow',
        code: 'no_device',
        message: 'No device selected',
        recoverable: false,
      });
      return;
    }

    const security = this.transport.resolvedConfig.security;
    if (security === 1) {
      if (!creds.pop) {
        this.setError({
          source: 'flow',
          code: 'missing_pop',
          message: 'Proof of Possession is required',
          recoverable: true,
        });
        return;
      }
      this._pendingAuth = { pop: creds.pop };
    } else if (security === 2) {
      if (!creds.pop) {
        this.setError({
          source: 'flow',
          code: 'missing_pop',
          message: 'Password is required',
          recoverable: true,
        });
        return;
      }
      this._pendingAuth = {
        pop: creds.pop,
        // Fall back to the configured default username if the screen
        // didn't override it.
        username: creds.username ?? this.transport.resolvedConfig.username,
      };
    } else {
      // sec0 shouldn't have reached this screen, but accept the no-op.
      this._pendingAuth = null;
    }

    this.clearError();
    await this._connectAfterAuth();
  }

  /**
   * Perform the BLE connect with whatever auth overrides are currently
   * pending and continue into `configuring` / `scanningWifi` on success.
   * On unauthorized failure, bounce back to `enterDeviceAuth` so the
   * user can correct the credentials without re-scanning.
   */
  private async _connectAfterAuth(): Promise<void> {
    const target = this._pendingDevice;
    if (!target) {
      log.error('_connectAfterAuth with no pending device');
      this.setStep('scanBle');
      return;
    }
    this.setStep('connectingBle');

    let info: ConnectedDeviceInfo;
    try {
      info = await this.transport.connect(
        target.id,
        this._pendingAuth ?? undefined,
      );
    } catch (err) {
      const code = err instanceof BleLibraryError ? err.code : undefined;

      if (code === 'unauthorized') {
        // Stay locked into the auth screen on subsequent chooseDevice
        // calls until the user successfully connects.
        this._forceAuthPrompt = true;
        this._device = null;
        this.emit('deviceConnectionChanged', null);
        this.setError({
          source: 'ble',
          code,
          message: toErrorMessage(err),
          recoverable: true,
        });
        this.setStep('enterDeviceAuth');
        return;
      }

      this._pendingDevice = null;
      this._pendingAuth = null;
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

    // Successful connect — clear the auth-retry latch and pending state.
    this._forceAuthPrompt = false;
    this._pendingDevice = null;

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

  /**
   * Returns true when the wizard should park on `enterDeviceAuth` before
   * calling connect(). Driven by config + previous-unauthorized state.
   */
  private shouldPromptForAuth(): boolean {
    const { security, proofOfPossession, username, promptForAuth } =
      this.transport.resolvedConfig;
    if (security === 0) return false;
    if (this._forceAuthPrompt) return true;
    if (promptForAuth) return true;
    if (security === 1) {
      return !proofOfPossession;
    }
    // sec2: needs pop (SRP password) + username
    return !proofOfPossession || !username;
  }

  /** Currently-pending auth values (for screens that want to pre-fill). */
  get pendingAuth(): DeviceAuthCredentials | null {
    return this._pendingAuth;
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
    this._pendingDevice = null;
    this._pendingAuth = null;
    this._forceAuthPrompt = false;

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
