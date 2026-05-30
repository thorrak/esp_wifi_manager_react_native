/**
 * Focused tests for BleTransport's scan.
 *
 * The transport runs a SINGLE match-all BLE scan and filters results by the
 * configured prefixes in JS, rather than one scan per prefix. This pins that
 * behaviour and guards the bug it replaced: scanning per-prefix ran a full
 * ~5s BLE scan for each prefix, so a multi-prefix config (e.g.
 * `['BrewPiESP-', 'TiltBridge-']`) took ~10s and the hard-cap timeout
 * force-stopped a later prefix's scan into a false "no devices found".
 */

import { mockHooks } from '../__mocks__/esp-idf-provisioning';
import {
  ESPDevice,
  ESPProvisionManager,
  ESPSecurity,
  ESPTransport,
} from '../__mocks__/esp-idf-provisioning';
import { BleTransport } from '../services/BleTransport';
import type {
  BleLibraryError,
  DiscoveredDevice,
  ScanCompletedInfo,
} from '../types/ble';

const device = (name: string) =>
  new ESPDevice({ name, transport: ESPTransport.ble, security: ESPSecurity.secure });

/** Run a scan and collect every event the transport emits. */
async function runScan(transport: BleTransport): Promise<{
  discovered: DiscoveredDevice[];
  errors: BleLibraryError[];
  completed: ScanCompletedInfo | null;
}> {
  const discovered: DiscoveredDevice[] = [];
  const errors: BleLibraryError[] = [];
  let completed: ScanCompletedInfo | null = null;

  transport.on('deviceDiscovered', (d) => discovered.push(d));
  transport.on('error', (e) => errors.push(e as BleLibraryError));
  transport.on('scanCompleted', (info) => {
    completed = info;
  });

  await transport.startScan();
  return { discovered, errors, completed };
}

describe('BleTransport scan', () => {
  beforeEach(() => {
    mockHooks.search = undefined;
    jest.restoreAllMocks();
  });

  it('scans the air exactly once regardless of prefix count', async () => {
    const spy = jest.spyOn(ESPProvisionManager, 'searchESPDevices');
    mockHooks.search = () => [device('TiltBridge-E3F6B0')];

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-', 'PROV_'],
      scanTimeoutMs: 1000,
    });
    await runScan(transport);

    // One match-all scan (empty prefix), not one per configured prefix.
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][0]).toBe('');
  });

  it('surfaces a device that matches any configured prefix', async () => {
    // Only a TiltBridge is present, but BrewPiESP- is also configured. The
    // TiltBridge must still appear (the original multi-prefix failure).
    mockHooks.search = () => [device('TiltBridge-E3F6B0')];

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, errors, completed } = await runScan(transport);

    expect(discovered.map((d) => d.name)).toEqual(['TiltBridge-E3F6B0']);
    expect(errors).toHaveLength(0);
    expect(completed?.matched).toBe(1);
  });

  it('filters out devices that match no configured prefix', async () => {
    mockHooks.search = () => [
      device('SomeHeadphones'),
      device('TiltBridge-E3F6B0'),
      device('BrewPiESP-AB12CD'),
    ];

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered } = await runScan(transport);

    expect(discovered.map((d) => d.name).sort()).toEqual([
      'BrewPiESP-AB12CD',
      'TiltBridge-E3F6B0',
    ]);
  });

  it('matches prefixes case-insensitively (mirrors the native SDK)', async () => {
    mockHooks.search = () => [device('tiltbridge-e3f6b0')];

    const transport = new BleTransport({
      deviceNamePrefix: ['TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered } = await runScan(transport);

    expect(discovered.map((d) => d.name)).toEqual(['tiltbridge-e3f6b0']);
  });

  it('reports "no devices" via scanCompleted (not error) when the scan finds nothing', async () => {
    // The SDK rejects a scan that finds no named device at all.
    mockHooks.search = () => {
      throw new Error('No bluetooth device found with given prefix.');
    };

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, errors, completed } = await runScan(transport);

    expect(discovered).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(completed?.matched).toBe(0);
  });

  it('reports "no devices" when named devices exist but none match a prefix', async () => {
    mockHooks.search = () => [device('SomeHeadphones'), device('A-TV')];

    const transport = new BleTransport({
      deviceNamePrefix: ['TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, errors, completed } = await runScan(transport);

    expect(discovered).toHaveLength(0);
    expect(errors).toHaveLength(0);
    expect(completed?.matched).toBe(0);
  });

  it('surfaces an actionable failure (powered off) when the scan fails hard', async () => {
    mockHooks.search = () => {
      throw new Error('Bluetooth is powered off');
    };

    const transport = new BleTransport({
      deviceNamePrefix: ['TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { errors } = await runScan(transport);

    expect(errors).toHaveLength(1);
    expect(errors[0].code).toBe('powered_off');
  });

  it('de-duplicates a device returned more than once', async () => {
    mockHooks.search = () => [
      device('TiltBridge-E3F6B0'),
      device('TiltBridge-E3F6B0'),
    ];

    const transport = new BleTransport({
      deviceNamePrefix: ['TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, completed } = await runScan(transport);

    expect(discovered).toHaveLength(1);
    expect(completed?.matched).toBe(1);
  });
});
