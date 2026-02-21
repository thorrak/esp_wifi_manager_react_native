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
 * Idempotent: if services already exist this is a no-op.  Call
 * `destroyServices()` first to force re-creation.
 *
 * Synchronous — all four constructors are sync.  This avoids the race
 * condition where callers that don't `await` would see null references.
 */
function initializeServices(config?: ProvisioningConfig): void {
  if (transport) return; // already initialized

  if (config !== undefined) {
    storedConfig = config;
  }

  transport = new BleTransport(storedConfig?.ble);
  protocol = new DeviceProtocol(transport, storedConfig?.protocol);
  poller = new ConnectionPoller(protocol);
  manager = new ProvisioningManager(transport, protocol, poller, storedConfig);
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
 * Destroy all services in reverse dependency order.
 *
 * References are nulled synchronously so that `initializeServices` can
 * create fresh instances immediately, even while the async BLE teardown
 * (BleManager.destroy()) is still settling in the background.
 */
export async function destroyServices(): Promise<void> {
  const prevManager = manager;
  const prevPoller = poller;
  const prevProtocol = protocol;
  const prevTransport = transport;

  // Null out immediately — unblocks re-initialization
  manager = null;
  poller = null;
  protocol = null;
  transport = null;

  // Async teardown in reverse dependency order
  if (prevManager) await prevManager.destroy();
  if (prevPoller) prevPoller.destroy();
  if (prevProtocol) prevProtocol.destroy();
  if (prevTransport) await prevTransport.destroy();
}

export { initializeServices };
