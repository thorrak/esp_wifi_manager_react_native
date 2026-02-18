/**
 * Service Factory — creates and wires singleton service instances.
 *
 * Lazy initialization: services are created on first access.
 * All four services are wired in dependency order:
 *   BleTransport -> DeviceProtocol -> ConnectionPoller -> ProvisioningManager
 */

import { BleTransport } from './services/BleTransport';
import { DeviceProtocol } from './services/DeviceProtocol';
import { ConnectionPoller } from './services/ConnectionPoller';
import { ProvisioningManager } from './services/ProvisioningManager';
import type { ProvisioningConfig } from './types';

// ── Module-level singletons (initially null) ──────────────────────────────

let transport: BleTransport | null = null;
let protocol: DeviceProtocol | null = null;
let poller: ConnectionPoller | null = null;
let manager: ProvisioningManager | null = null;

let storedConfig: ProvisioningConfig | undefined;

// ── Initialization ────────────────────────────────────────────────────────

/**
 * Create all four services in dependency order and wire them together.
 *
 * Idempotent: if services already exist they are destroyed first, then
 * re-created with the (optionally updated) config.
 */
function initializeServices(config?: ProvisioningConfig): void {
  if (transport) {
    destroyServices();
  }

  storedConfig = config;

  transport = new BleTransport(config?.ble);
  protocol = new DeviceProtocol(transport, config?.protocol);
  poller = new ConnectionPoller(protocol);
  manager = new ProvisioningManager(transport, protocol, poller, config);
}

// ── Lazy accessors ────────────────────────────────────────────────────────

/** Return the BleTransport singleton, creating all services if needed. */
export function getTransport(): BleTransport {
  if (!transport) {
    initializeServices(storedConfig);
  }
  return transport!;
}

/** Return the DeviceProtocol singleton, creating all services if needed. */
export function getProtocol(): DeviceProtocol {
  if (!protocol) {
    initializeServices(storedConfig);
  }
  return protocol!;
}

/** Return the ConnectionPoller singleton, creating all services if needed. */
export function getPoller(): ConnectionPoller {
  if (!poller) {
    initializeServices(storedConfig);
  }
  return poller!;
}

/** Return the ProvisioningManager singleton, creating all services if needed. */
export function getManager(): ProvisioningManager {
  if (!manager) {
    initializeServices(storedConfig);
  }
  return manager!;
}

// ── Teardown ──────────────────────────────────────────────────────────────

/**
 * Destroy all services in reverse dependency order and null out references.
 */
export function destroyServices(): void {
  if (manager) {
    manager.destroy();
    manager = null;
  }
  if (poller) {
    poller.destroy();
    poller = null;
  }
  if (protocol) {
    protocol.destroy();
    protocol = null;
  }
  if (transport) {
    void transport.destroy();
    transport = null;
  }
}

export { initializeServices };
