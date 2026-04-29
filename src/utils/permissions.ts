/**
 * Runtime permission helper for BLE scanning + connection.
 *
 * On iOS, BLE permission is granted at first use via the Info.plist
 * description string — no runtime prompt API exists, so this helper
 * always reports `granted: true` and the OS handles the dialog when
 * `BleManager.startDeviceScan()` first runs.
 *
 * On Android 12+ (API 31+) it requests `BLUETOOTH_SCAN` and
 * `BLUETOOTH_CONNECT`; on older Android it requests
 * `ACCESS_FINE_LOCATION` (required for BLE scans pre-Android 12).
 */

import { PermissionsAndroid, Platform, type Permission } from 'react-native';

/** Result envelope returned by `requestBluetoothPermissions`. */
export type BlePermissionResult =
  | { granted: true }
  | { granted: false; reason: 'denied' | 'never_ask_again' };

/**
 * Request the runtime permissions needed for BLE scanning and connection.
 * Safe to call before {@link BleTransport.startScan} on every platform.
 *
 * @example
 * const result = await requestBluetoothPermissions();
 * if (!result.granted) {
 *   if (result.reason === 'never_ask_again') Linking.openSettings();
 *   return;
 * }
 * await store.start();
 */
export async function requestBluetoothPermissions(): Promise<BlePermissionResult> {
  if (Platform.OS !== 'android') {
    // iOS: handled by Info.plist + OS dialog at first use.
    return { granted: true };
  }

  const apiLevel =
    typeof Platform.Version === 'number'
      ? Platform.Version
      : parseInt(String(Platform.Version), 10);

  const required: Permission[] =
    apiLevel >= 31
      ? [
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN,
          PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT,
        ]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];

  const results = await PermissionsAndroid.requestMultiple(required);

  let neverAskAgain = false;
  for (const perm of required) {
    const status = results[perm as keyof typeof results];
    if (status !== PermissionsAndroid.RESULTS.GRANTED) {
      if (status === PermissionsAndroid.RESULTS.NEVER_ASK_AGAIN) {
        neverAskAgain = true;
      }
      return {
        granted: false,
        reason: neverAskAgain ? 'never_ask_again' : 'denied',
      };
    }
  }
  return { granted: true };
}
