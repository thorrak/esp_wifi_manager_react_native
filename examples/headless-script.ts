/**
 * examples/headless-script.ts — non-React provisioning (v2).
 *
 * Pure TypeScript using BleTransport + DeviceProtocol. No store, no
 * manager, no React. Useful for tests, CLI tools, and automation.
 *
 * Usage:
 *   npx ts-node examples/headless-script.ts MyWiFi MyPassword
 */

import {
  BleLibraryError,
  BleTransport,
  DeviceProtocol,
} from 'esp-wifi-config-react-native';
import type {
  DiscoveredDevice,
  ProvisionResult,
} from 'esp-wifi-config-react-native';

const DEVICE_PREFIXES = ['PROV_'];
const SCAN_TIMEOUT_MS = 10_000;
const PROVISION_TIMEOUT_MS = 60_000;

async function provisionFirstFound(ssid: string, password: string) {
  const transport = new BleTransport({
    deviceNamePrefix: DEVICE_PREFIXES,
    scanTimeoutMs: SCAN_TIMEOUT_MS,
    security: 1,
    proofOfPossession: 'abcd1234', // override per device for production
  });
  const protocol = new DeviceProtocol(transport);

  const discovered: DiscoveredDevice[] = [];
  transport.on('deviceDiscovered', (d) => {
    console.log('Discovered:', d.name);
    discovered.push(d);
  });

  console.log('Scanning…');
  await transport.startScan();
  if (discovered.length === 0) {
    throw new Error('No devices found matching prefix');
  }

  const target = discovered[0];
  console.log(`Connecting to ${target.name}…`);
  try {
    // For a per-device PoP, pass it as the second argument instead of
    // baking one into the BleTransport config:
    //   await transport.connect(target.id, { pop: discoveredPop });
    // For sec2 also supply { username } in the overrides object.
    await transport.connect(target.id);
  } catch (err) {
    if (err instanceof BleLibraryError) {
      console.error(`BLE error (${err.code}):`, err.message);
    } else {
      console.error('Connect failed:', err);
    }
    return;
  }

  console.log('Reading device version…');
  try {
    const version = await protocol.getVersion();
    console.log('  Library:', version.lib);
    console.log('  IDF:', version.idf);
    console.log('  Firmware:', version.fw_version ?? version.app);
  } catch (err) {
    console.warn('Version read failed (continuing):', err);
  }

  console.log(`Provisioning ${ssid}…`);
  let result: ProvisionResult;
  try {
    result = await protocol.provision(ssid, password, PROVISION_TIMEOUT_MS);
  } catch (err) {
    console.error('Provision failed:', err);
    await transport.disconnect();
    return;
  }
  console.log('Provision status:', result.status);

  await transport.disconnect();
  console.log('Done.');
}

const [, , ssidArg, passwordArg] = process.argv;
if (!ssidArg || !passwordArg) {
  console.error(
    'Usage: ts-node examples/headless-script.ts <ssid> <password>',
  );
  process.exit(1);
}
provisionFirstFound(ssidArg, passwordArg).catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
