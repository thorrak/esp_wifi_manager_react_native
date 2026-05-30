/**
 * Focused tests for BleTransport's multi-prefix scan.
 *
 * The native SDK rejects `searchESPDevices` when a prefix matches no device.
 * Because the transport scans one prefix per call, a single absent prefix
 * must not abort the whole scan or discard devices found under other
 * prefixes. These tests pin that behaviour (regression for the bug where
 * `['BrewPiESP-', 'TiltBridge-']` failed to surface a TiltBridge device
 * whenever no BrewPi-ESP was nearby).
 */

import { mockHooks } from '../__mocks__/esp-idf-provisioning';
import {
  ESPDevice,
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

describe('BleTransport multi-prefix scan', () => {
  beforeEach(() => {
    mockHooks.search = undefined;
  });

  it('surfaces devices from a later prefix when an earlier one matches nothing', async () => {
    // 'BrewPiESP-' rejects (no such device) — the SDK's real behaviour — but
    // 'TiltBridge-' has a match. The TiltBridge device must still appear.
    mockHooks.search = (prefix) => {
      if (prefix === 'BrewPiESP-') {
        throw new Error('No bluetooth device found with given prefix.');
      }
      return [device('TiltBridge-E3F6B0')];
    };

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, errors, completed } = await runScan(transport);

    expect(discovered.map((d) => d.name)).toEqual(['TiltBridge-E3F6B0']);
    expect(errors).toHaveLength(0);
    expect(completed?.matched).toBe(1);
  });

  it('reports "no devices" via scanCompleted (not error) when every prefix is absent', async () => {
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

  it('surfaces an actionable failure when nothing matched and a prefix fails hard', async () => {
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

  it('does not surface a hard error if some prefix still matched a device', async () => {
    // Even if one prefix fails hard, a device found under another prefix wins:
    // the user has something to connect to, so no error event fires.
    mockHooks.search = (prefix) => {
      if (prefix === 'BrewPiESP-') throw new Error('unauthorized');
      return [device('TiltBridge-E3F6B0')];
    };

    const transport = new BleTransport({
      deviceNamePrefix: ['BrewPiESP-', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, errors } = await runScan(transport);

    expect(discovered.map((d) => d.name)).toEqual(['TiltBridge-E3F6B0']);
    expect(errors).toHaveLength(0);
  });

  it('de-duplicates a device matched by more than one prefix', async () => {
    mockHooks.search = () => [device('TiltBridge-E3F6B0')];

    const transport = new BleTransport({
      deviceNamePrefix: ['Tilt', 'TiltBridge-'],
      scanTimeoutMs: 1000,
    });
    const { discovered, completed } = await runScan(transport);

    expect(discovered).toHaveLength(1);
    expect(completed?.matched).toBe(1);
  });
});
