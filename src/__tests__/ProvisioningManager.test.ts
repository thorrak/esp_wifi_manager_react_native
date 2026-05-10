/**
 * High-level smoke tests for the v2 ProvisioningManager step machine.
 *
 * These don't exhaustively cover every edge case — the previous v1 test
 * suite was wholly invalid against the new SDK-backed protocol, so this
 * file replaces it with a minimum bar: scan → connect → wifi-scan →
 * choose → submitPassword → success transitions cleanly.
 */

import { mockHooks } from '../__mocks__/esp-idf-provisioning';
import { BleTransport } from '../services/BleTransport';
import { DeviceProtocol } from '../services/DeviceProtocol';
import { ProvisioningManager } from '../services/ProvisioningManager';
import {
  ESPDevice,
  ESPSecurity,
  ESPTransport,
  ESPWifiAuthMode,
} from '../__mocks__/esp-idf-provisioning';
import { Buffer } from 'buffer';

describe('ProvisioningManager (v2 SDK-backed)', () => {
  beforeEach(() => {
    // Reset hook overrides between tests
    mockHooks.search = undefined;
    mockHooks.connect = undefined;
    mockHooks.scanWifi = undefined;
    mockHooks.provision = undefined;
    mockHooks.sendData = undefined;
  });

  it('walks happy-path: start → device → wifi → submit → success', async () => {
    mockHooks.search = (prefix) => [
      new ESPDevice({ name: prefix + 'AB12CD', transport: ESPTransport.ble, security: ESPSecurity.secure }),
    ];
    mockHooks.scanWifi = () => [
      { ssid: 'Home', rssi: -45, auth: ESPWifiAuthMode.wpa2Psk },
    ];
    mockHooks.provision = async () => ({ status: 'success' });

    const transport = new BleTransport({ deviceNamePrefix: 'PROV_' });
    const protocol = new DeviceProtocol(transport);
    const manager = new ProvisioningManager(transport, protocol);

    const steps: string[] = [];
    manager.on('stepChanged', (s) => steps.push(s));

    await manager.start();
    // After scan completes the manager remains on `scanBle`; tests pick
    // a device explicitly.
    const devices = transport.connectionState; // 'disconnected' once scan resolved
    expect(devices).toBe('disconnected');

    await manager.chooseDevice({
      id: 'PROV_AB12CD',
      name: 'PROV_AB12CD',
      rssi: null,
    });

    expect(steps).toContain('connectingBle');
    expect(steps).toContain('configuring');
    expect(steps).toContain('scanningWifi');
    expect(steps).toContain('chooseNetwork');

    manager.chooseNetwork({ ssid: 'Home', rssi: -45, auth: 'WPA2' });
    expect(manager.currentStep).toBe('enterCredentials');

    await manager.submitPassword('hunter2');
    expect(manager.currentStep).toBe('success');
  });

  it('lands on chooseNetwork with a protocol error if scanWifi rejects', async () => {
    mockHooks.search = (prefix) => [
      new ESPDevice({ name: prefix + 'AB12CD', transport: ESPTransport.ble, security: ESPSecurity.secure }),
    ];
    mockHooks.scanWifi = () => {
      throw new Error('scan failed');
    };

    const transport = new BleTransport({ deviceNamePrefix: 'PROV_' });
    const protocol = new DeviceProtocol(transport);
    const manager = new ProvisioningManager(transport, protocol);

    await manager.start();
    await manager.chooseDevice({
      id: 'PROV_AB12CD',
      name: 'PROV_AB12CD',
      rssi: null,
    });

    expect(manager.currentStep).toBe('chooseNetwork');
    expect(manager.error?.source).toBe('protocol');
  });

  it('parks on joiningWifi with provision-source error on provision failure', async () => {
    mockHooks.search = (prefix) => [
      new ESPDevice({ name: prefix + 'AB12CD', transport: ESPTransport.ble, security: ESPSecurity.secure }),
    ];
    mockHooks.scanWifi = () => [
      { ssid: 'Home', rssi: -45, auth: ESPWifiAuthMode.wpa2Psk },
    ];
    mockHooks.provision = async () => {
      throw new Error('STA connect failed');
    };

    const transport = new BleTransport({ deviceNamePrefix: 'PROV_' });
    const protocol = new DeviceProtocol(transport);
    const manager = new ProvisioningManager(transport, protocol);

    await manager.start();
    await manager.chooseDevice({
      id: 'PROV_AB12CD',
      name: 'PROV_AB12CD',
      rssi: null,
    });
    manager.chooseNetwork({ ssid: 'Home', rssi: -45, auth: 'WPA2' });
    await manager.submitPassword('hunter2');

    expect(manager.currentStep).toBe('joiningWifi');
    expect(manager.error?.source).toBe('provision');
    expect(manager.error?.recoverable).toBe(true);
  });

  it('encodes vars endpoint as JSON-over-base64', async () => {
    let captured: { path: string; data: string } | null = null;
    mockHooks.search = (prefix) => [
      new ESPDevice({ name: prefix + 'X', transport: ESPTransport.ble, security: ESPSecurity.secure }),
    ];
    mockHooks.sendData = async (path, data) => {
      captured = { path, data };
      const okBody = JSON.stringify({ ok: true });
      return Buffer.from(okBody, 'utf-8').toString('base64');
    };

    const transport = new BleTransport({ deviceNamePrefix: 'PROV_' });
    const protocol = new DeviceProtocol(transport);
    await transport.startScan();
    await transport.connect('PROV_X');

    await protocol.setVar('mdns_name', 'demo');

    expect(captured).not.toBeNull();
    expect(captured!.path).toBe('esp-wifi-config-vars');
    const decoded = Buffer.from(captured!.data, 'base64').toString('utf-8');
    expect(JSON.parse(decoded)).toEqual({
      op: 'set',
      key: 'mdns_name',
      value: 'demo',
    });
  });
});
