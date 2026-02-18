/**
 * ProvisioningManager — Layer 4 of the ESP WiFi Manager library.
 *
 * Orchestrates BleTransport, DeviceProtocol, and ConnectionPoller to implement
 * the full WiFi provisioning wizard as a plain TypeScript class. It does NOT
 * call any navigation APIs — it emits `stepChanged` events so the UI layer
 * can drive navigation independently.
 */

import type {
  ProvisioningStep,
  ProvisioningConfig,
  ProvisioningResult,
  ProvisioningManagerEvents,
  ScannedNetwork,
  WifiStatus,
  BleConnectionState,
} from '../types';

import {
  DEFAULT_POLL_INTERVAL_MS,
  DEFAULT_POLL_TIMEOUT_MS,
  DEFAULT_NETWORK_PRIORITY,
  DISCONNECT_SETTLE_MS,
} from '../constants/provisioning';

import { TypedEventEmitter, createLogger } from '../utils';

import type { BleTransport } from './BleTransport';
import type { DeviceProtocol } from './DeviceProtocol';
import type { ConnectionPoller } from './ConnectionPoller';

const log = createLogger('ProvisioningManager');

// ---------------------------------------------------------------------------
// Resolved config with defaults applied
// ---------------------------------------------------------------------------

interface ResolvedProvisioningConfig {
  pollIntervalMs: number;
  pollTimeoutMs: number;
  defaultNetworkPriority: number;
}

function resolveConfig(config?: ProvisioningConfig): ResolvedProvisioningConfig {
  return {
    pollIntervalMs: config?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS,
    pollTimeoutMs: config?.pollTimeoutMs ?? DEFAULT_POLL_TIMEOUT_MS,
    defaultNetworkPriority: config?.defaultNetworkPriority ?? DEFAULT_NETWORK_PRIORITY,
  };
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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

  // -- Event unsubscribe handles --------------------------------------------
  private unsubscribeTransport: (() => void) | null = null;
  private unsubscribePollerSucceeded: (() => void) | null = null;
  private unsubscribePollerFailed: (() => void) | null = null;
  private unsubscribePollerTimedOut: (() => void) | null = null;
  private unsubscribePollerWifiState: (() => void) | null = null;

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

  get currentStep(): ProvisioningStep {
    return this._step;
  }

  get selectedNetwork(): ScannedNetwork | null {
    return this._selectedNetwork;
  }

  get scannedNetworks(): ScannedNetwork[] {
    return this._scannedNetworks;
  }

  // -----------------------------------------------------------------------
  // Step 1 — scanForDevices
  // -----------------------------------------------------------------------

  async scanForDevices(): Promise<void> {
    log.info('scanForDevices');
    this.clearError();

    try {
      // If currently connected, disconnect first and let BLE settle.
      if (this.transport.isConnected) {
        log.debug('Disconnecting before scan');
        await this.transport.disconnect();
        await delay(DISCONNECT_SETTLE_MS);
      }

      this.transport.startScan();
      this.setStep('welcome');
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('scanForDevices failed:', error.message);
      this.setError(error.message);
    }
  }

  // -----------------------------------------------------------------------
  // Step 2 — connectToDevice
  // -----------------------------------------------------------------------

  async connectToDevice(deviceId: string): Promise<void> {
    log.info('connectToDevice:', deviceId);
    this.clearError();

    try {
      this.transport.stopScan();
      this.setStep('connect');

      await this.transport.connect(deviceId);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('connectToDevice failed:', error.message);
      this.setError(error.message);
      this.setStep('welcome');
      return;
    }

    // Connection succeeded — trigger WiFi scan automatically.
    try {
      await this.scanWifiNetworks();
    } catch (err: unknown) {
      // scanWifiNetworks handles its own error emission, but we catch here
      // to prevent unhandled promise rejection. Stay on 'networks' step.
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Post-connect WiFi scan failed:', error.message);
    }
  }

  // -----------------------------------------------------------------------
  // WiFi network scanning
  // -----------------------------------------------------------------------

  async scanWifiNetworks(): Promise<void> {
    log.info('scanWifiNetworks');
    this.clearError();

    try {
      const result = await this.protocol.scan();
      const networks = [...(result.networks ?? [])].sort(
        (a, b) => b.rssi - a.rssi,
      );

      this._scannedNetworks = networks;
      this.emit('scannedNetworksUpdated', networks);
      this.setStep('networks');

      log.info(`Found ${networks.length} WiFi networks`);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('scanWifiNetworks failed:', error.message);
      this.setError(error.message);
      // Stay on 'networks' step so user can retry.
      this.setStep('networks');
      throw error;
    }
  }

  // -----------------------------------------------------------------------
  // Step 3 — selectNetwork
  // -----------------------------------------------------------------------

  selectNetwork(network: ScannedNetwork): void {
    log.info('selectNetwork:', network.ssid);
    this._selectedNetwork = network;
    this.emit('selectedNetworkChanged', network);
    this.setStep('credentials');
  }

  // -----------------------------------------------------------------------
  // Step 4 — submitCredentials
  // -----------------------------------------------------------------------

  async submitCredentials(password: string): Promise<void> {
    log.info('submitCredentials for:', this._selectedNetwork?.ssid);
    this.clearError();

    if (!this._selectedNetwork) {
      this.setError('No network selected');
      return;
    }

    try {
      await this.protocol.addNetwork({
        ssid: this._selectedNetwork.ssid,
        password,
        priority: this.config.defaultNetworkPriority,
      });

      await this.protocol.connectWifi(this._selectedNetwork.ssid);

      this.setStep('connecting');
      this.poller.startPolling(this.config.pollTimeoutMs, this.config.pollIntervalMs);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('submitCredentials failed:', error.message);
      this.setError(error.message);
    }
  }

  // -----------------------------------------------------------------------
  // Retry from 'connecting' step
  // -----------------------------------------------------------------------

  async retryConnection(): Promise<void> {
    log.info('retryConnection for:', this._selectedNetwork?.ssid);
    this.clearError();

    if (!this._selectedNetwork) {
      this.setError('No network selected');
      return;
    }

    try {
      this.poller.reset();
      await this.protocol.connectWifi(this._selectedNetwork.ssid);
      this.poller.startPolling(this.config.pollTimeoutMs, this.config.pollIntervalMs);
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('retryConnection failed:', error.message);
      this.setError(error.message);
    }
  }

  // -----------------------------------------------------------------------
  // Delete network and go back to scan results
  // -----------------------------------------------------------------------

  async deleteNetworkAndReturn(): Promise<void> {
    log.info('deleteNetworkAndReturn');

    this.poller.reset();

    try {
      if (this._selectedNetwork) {
        await this.protocol.delNetwork(this._selectedNetwork.ssid);
      }
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn('delNetwork failed (continuing anyway):', error.message);
      // Non-fatal — continue to scan.
    }

    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);

    try {
      await this.scanWifiNetworks();
    } catch (err: unknown) {
      // scanWifiNetworks handles its own errors.
      const error = err instanceof Error ? err : new Error(String(err));
      log.error('Post-delete WiFi scan failed:', error.message);
    }
  }

  // -----------------------------------------------------------------------
  // Navigate back to network selection
  // -----------------------------------------------------------------------

  goToNetworks(): void {
    log.info('goToNetworks');
    this._selectedNetwork = null;
    this.emit('selectedNetworkChanged', null);
    this.setStep('networks');
  }

  // -----------------------------------------------------------------------
  // Navigate to manage screen
  // -----------------------------------------------------------------------

  goToManage(): void {
    log.info('goToManage');
    this.setStep('manage');
  }

  // -----------------------------------------------------------------------
  // Full reset
  // -----------------------------------------------------------------------

  async reset(): Promise<void> {
    log.info('reset');

    // Set step to 'welcome' BEFORE disconnecting so the transport's
    // connectionStateChanged listener won't trigger a spurious
    // "Bluetooth connection lost" error and re-entrant reset().
    this._step = 'welcome';
    this._selectedNetwork = null;
    this._scannedNetworks = [];

    this.poller.reset();

    try {
      await this.transport.disconnect();
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      log.warn('Disconnect during reset failed (ignoring):', error.message);
    }

    this.emit('provisioningReset');
    this.emit('stepChanged', 'welcome');
    this.emit('selectedNetworkChanged', null);
    this.emit('scannedNetworksUpdated', []);
  }

  // -----------------------------------------------------------------------
  // Destroy — full cleanup and event unsubscription
  // -----------------------------------------------------------------------

  async destroy(): Promise<void> {
    log.info('destroy');

    await this.reset();
    this.unsubscribeFromServices();
    this.removeAllListeners();

    log.info('ProvisioningManager destroyed');
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private setStep(step: ProvisioningStep): void {
    if (this._step === step) {
      return;
    }
    const previous = this._step;
    this._step = step;
    log.info(`Step: ${previous} -> ${step}`);
    this.emit('stepChanged', step);
  }

  private setError(message: string): void {
    log.error('Error:', message);
    this.emit('provisioningError', message);
  }

  private clearError(): void {
    this.emit('provisioningError', null);
  }

  // -----------------------------------------------------------------------
  // Service event subscriptions
  // -----------------------------------------------------------------------

  private subscribeToServices(): void {
    // Transport: watch for unexpected BLE disconnection mid-flow.
    this.unsubscribeTransport = this.transport.on(
      'connectionStateChanged',
      (state: BleConnectionState) => {
        if (state === 'disconnected' && this._step !== 'welcome' && this._step !== 'connect') {
          log.warn('Bluetooth connection lost during provisioning (step:', this._step, ')');
          this.setError('Bluetooth connection lost');
          void this.reset();
        }
      },
    );

    // Poller: WiFi connection succeeded.
    this.unsubscribePollerSucceeded = this.poller.on(
      'connectionSucceeded',
      (status: WifiStatus) => {
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
      },
    );

    // Poller: WiFi connection failed (saw connecting -> disconnected).
    this.unsubscribePollerFailed = this.poller.on('connectionFailed', () => {
      log.warn('WiFi connection failed');
      // Stay on 'connecting' step so user can retry.
      this.setError('WiFi connection failed. You can retry or go back.');
    });

    // Poller: WiFi connection timed out.
    this.unsubscribePollerTimedOut = this.poller.on('connectionTimedOut', () => {
      log.warn('WiFi connection timed out');
      // Stay on 'connecting' step so user can retry.
      this.setError('WiFi connection timed out. You can retry or go back.');
    });

    // Poller: forward WiFi state changes.
    this.unsubscribePollerWifiState = this.poller.on(
      'wifiStateChanged',
      (status: WifiStatus) => {
        this.emit('wifiStatusUpdated', status);
      },
    );
  }

  private unsubscribeFromServices(): void {
    this.unsubscribeTransport?.();
    this.unsubscribeTransport = null;

    this.unsubscribePollerSucceeded?.();
    this.unsubscribePollerSucceeded = null;

    this.unsubscribePollerFailed?.();
    this.unsubscribePollerFailed = null;

    this.unsubscribePollerTimedOut?.();
    this.unsubscribePollerTimedOut = null;

    this.unsubscribePollerWifiState?.();
    this.unsubscribePollerWifiState = null;
  }
}
