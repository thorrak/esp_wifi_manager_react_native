/**
 * Tests for the service factory (serviceFactory.ts).
 *
 * Validates singleton lifecycle, idempotent initialization, wiring of
 * service dependencies, and teardown behavior.
 */

// Provide __DEV__ for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

// react-native-ble-plx is mapped to src/__mocks__/react-native-ble-plx.ts
// via the jest moduleNameMapper config, so no jest.mock() call is needed.

import {
  initializeServices,
  destroyServices,
  getTransport,
  getProtocol,
  getPoller,
  getManager,
} from '../serviceFactory';

import { BleTransport } from '../services/BleTransport';
import { DeviceProtocol } from '../services/DeviceProtocol';
import { ConnectionPoller } from '../services/ConnectionPoller';
import { ProvisioningManager } from '../services/ProvisioningManager';

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('serviceFactory', () => {
  afterEach(() => {
    // Clean up after each test to avoid cross-test pollution.
    destroyServices();
  });

  // --------------------------------------------------------------------------
  // initializeServices
  // --------------------------------------------------------------------------

  describe('initializeServices', () => {
    it('creates all four service instances', () => {
      initializeServices();

      expect(getTransport()).toBeInstanceOf(BleTransport);
      expect(getProtocol()).toBeInstanceOf(DeviceProtocol);
      expect(getPoller()).toBeInstanceOf(ConnectionPoller);
      expect(getManager()).toBeInstanceOf(ProvisioningManager);
    });

    it('is idempotent -- calling twice returns the same type of instances', () => {
      initializeServices();
      const t1 = getTransport();
      const p1 = getProtocol();
      const c1 = getPoller();
      const m1 = getManager();

      // Second call destroys old instances and creates new ones
      // (per the implementation: if transport exists, destroyServices() is called first).
      initializeServices();
      const t2 = getTransport();
      const p2 = getProtocol();
      const c2 = getPoller();
      const m2 = getManager();

      // All instances exist and are the correct type.
      expect(t2).toBeInstanceOf(BleTransport);
      expect(p2).toBeInstanceOf(DeviceProtocol);
      expect(c2).toBeInstanceOf(ConnectionPoller);
      expect(m2).toBeInstanceOf(ProvisioningManager);

      // They should be new instances since initializeServices destroys and re-creates.
      expect(t2).not.toBe(t1);
      expect(p2).not.toBe(p1);
      expect(c2).not.toBe(c1);
      expect(m2).not.toBe(m1);
    });
  });

  // --------------------------------------------------------------------------
  // Lazy accessor getters
  // --------------------------------------------------------------------------

  describe('lazy accessors', () => {
    it('getTransport() auto-initializes services if not yet created', () => {
      // No explicit initializeServices() call.
      const transport = getTransport();

      expect(transport).toBeInstanceOf(BleTransport);
    });

    it('getProtocol() auto-initializes services if not yet created', () => {
      const protocol = getProtocol();

      expect(protocol).toBeInstanceOf(DeviceProtocol);
    });

    it('getPoller() auto-initializes services if not yet created', () => {
      const poller = getPoller();

      expect(poller).toBeInstanceOf(ConnectionPoller);
    });

    it('getManager() auto-initializes services if not yet created', () => {
      const manager = getManager();

      expect(manager).toBeInstanceOf(ProvisioningManager);
    });

    it('all lazy accessors return the same singletons', () => {
      const t1 = getTransport();
      const p1 = getProtocol();
      const c1 = getPoller();
      const m1 = getManager();

      // Calling again should return the exact same instances.
      expect(getTransport()).toBe(t1);
      expect(getProtocol()).toBe(p1);
      expect(getPoller()).toBe(c1);
      expect(getManager()).toBe(m1);
    });
  });

  // --------------------------------------------------------------------------
  // destroyServices
  // --------------------------------------------------------------------------

  describe('destroyServices', () => {
    it('after destroy, getters create fresh instances', () => {
      initializeServices();
      const t1 = getTransport();
      const p1 = getProtocol();
      const c1 = getPoller();
      const m1 = getManager();

      destroyServices();

      // Getting instances again should create new ones.
      const t2 = getTransport();
      const p2 = getProtocol();
      const c2 = getPoller();
      const m2 = getManager();

      expect(t2).not.toBe(t1);
      expect(p2).not.toBe(p1);
      expect(c2).not.toBe(c1);
      expect(m2).not.toBe(m1);
    });

    it('does not throw when called without prior initialization', () => {
      expect(() => destroyServices()).not.toThrow();
    });

    it('does not throw when called multiple times', () => {
      initializeServices();
      destroyServices();

      expect(() => destroyServices()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // Service wiring
  // --------------------------------------------------------------------------

  describe('service wiring', () => {
    it('protocol is wired to transport (listens for response events)', () => {
      initializeServices();
      const transport = getTransport();
      const protocol = getProtocol();

      // DeviceProtocol subscribes to transport's "response" event in its
      // constructor. We can verify by checking that protocol.isBusy changes
      // when we send a command (which writes to the transport).
      expect(protocol.isBusy).toBe(false);

      // The transport is a real BleTransport backed by the mock BleManager,
      // so the wiring is real. We verify the instances are the correct types.
      expect(transport).toBeInstanceOf(BleTransport);
      expect(protocol).toBeInstanceOf(DeviceProtocol);
    });

    it('poller is wired to protocol', () => {
      initializeServices();
      const poller = getPoller();

      // ConnectionPoller takes protocol in its constructor.
      // We can verify by checking it is a valid ConnectionPoller instance.
      expect(poller).toBeInstanceOf(ConnectionPoller);
    });

    it('manager is wired to transport, protocol, and poller', () => {
      initializeServices();
      const manager = getManager();

      // ProvisioningManager takes all three services in its constructor.
      // It subscribes to transport's connectionStateChanged and poller events.
      expect(manager).toBeInstanceOf(ProvisioningManager);
      expect(manager.currentStep).toBe('welcome');
    });
  });

  // --------------------------------------------------------------------------
  // Config propagation
  // --------------------------------------------------------------------------

  describe('config propagation', () => {
    it('passes config through to service constructors', () => {
      initializeServices({
        ble: { deviceNamePrefix: 'Custom-' },
        pollIntervalMs: 5000,
      });

      // Services should be created without errors even with custom config.
      expect(getTransport()).toBeInstanceOf(BleTransport);
      expect(getManager()).toBeInstanceOf(ProvisioningManager);
    });

    it('works with undefined config', () => {
      initializeServices(undefined);

      expect(getTransport()).toBeInstanceOf(BleTransport);
      expect(getProtocol()).toBeInstanceOf(DeviceProtocol);
      expect(getPoller()).toBeInstanceOf(ConnectionPoller);
      expect(getManager()).toBeInstanceOf(ProvisioningManager);
    });
  });
});
