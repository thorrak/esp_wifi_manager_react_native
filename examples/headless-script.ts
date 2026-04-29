/**
 * examples/headless-script.ts — non-React provisioning.
 *
 * Pure TypeScript using BleTransport + DeviceProtocol + ConnectionPoller.
 * No store, no manager, no React. Useful for tests, CLI tools, automation.
 *
 * Usage:
 *   npx ts-node examples/headless-script.ts MyWiFi MyPassword
 */

import {
  BleLibraryError,
  BleTransport,
  ConnectionPoller,
  DeviceProtocol,
} from 'esp-wifi-config-react-native';
import type {
  DiscoveredDevice,
  WifiStatus,
} from 'esp-wifi-config-react-native';

const DEVICE_PREFIXES = ['MyDevice-'];
const SCAN_TIMEOUT_MS = 10_000;
const POLL_TIMEOUT_MS = 30_000;

async function provisionFirstFound(ssid: string, password: string) {
  const transport = new BleTransport({
    deviceNamePrefix: DEVICE_PREFIXES,
    scanTimeoutMs: SCAN_TIMEOUT_MS,
  });
  const protocol = new DeviceProtocol(transport);
  const poller = new ConnectionPoller(protocol);

  try {
    // Step 1: scan for the first matching device.
    console.log('Scanning…');
    const device = await firstDeviceFound(transport);
    transport.stopScan();
    console.log(`Found: ${device.name} (${device.id}, ${device.rssi}dBm)`);

    // Step 2: connect.
    const info = await transport.connect(device.id);
    console.log(`Connected (MTU ${info.mtu}).`);

    // Step 3: provision.
    console.log(`Adding network "${ssid}"…`);
    await protocol.addNetwork({ ssid, password, priority: 10 });
    await protocol.connectWifi(ssid);

    // Step 4: poll until connected/failed/timeout.
    console.log('Waiting for join…');
    const status = await waitForJoin(poller);
    console.log(`Joined! IP=${status.ip} RSSI=${status.rssi}dBm`);
  } catch (err) {
    if (err instanceof BleLibraryError) {
      console.error(`BLE error [${err.code}]: ${err.message}`);
    } else {
      console.error('Failed:', err);
    }
    process.exit(1);
  } finally {
    await transport.disconnect().catch(() => {});
    poller.destroy();
    await transport.destroy();
  }
}

function firstDeviceFound(transport: BleTransport): Promise<DiscoveredDevice> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      offDiscovered();
      offError();
      offCompleted();
    };
    const offDiscovered = transport.on('deviceDiscovered', (d) => {
      cleanup();
      resolve(d);
    });
    const offError = transport.on('error', (err) => {
      cleanup();
      reject(err);
    });
    const offCompleted = transport.on('scanCompleted', (info) => {
      if (info.matched === 0) {
        cleanup();
        reject(
          new Error(
            `No matching devices found (saw ${info.total} total). ` +
              `Sample names: ${info.sampleNames.join(', ') || '(none)'}`,
          ),
        );
      }
    });

    transport.startScan().catch(reject);
  });
}

function waitForJoin(poller: ConnectionPoller): Promise<WifiStatus> {
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      offSucceeded();
      offFailed();
      offTimeout();
    };
    const offSucceeded = poller.on('connectionSucceeded', (status) => {
      cleanup();
      resolve(status);
    });
    const offFailed = poller.on('connectionFailed', () => {
      cleanup();
      reject(new Error('WiFi join failed (bad password or AP unreachable)'));
    });
    const offTimeout = poller.on('connectionTimedOut', () => {
      cleanup();
      reject(new Error('WiFi join timed out'));
    });
    poller.startPolling(POLL_TIMEOUT_MS, 2000);
  });
}

// ---------------------------------------------------------------------------
// CLI entry
// ---------------------------------------------------------------------------

if (require.main === module) {
  const [ssid, password] = process.argv.slice(2);
  if (!ssid || !password) {
    console.error('Usage: headless-script.ts <ssid> <password>');
    process.exit(2);
  }
  void provisionFirstFound(ssid, password);
}
