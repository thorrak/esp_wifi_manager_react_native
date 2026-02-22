export type BleErrorCode =
  | 'unauthorized'
  | 'powered_off'
  | 'unsupported'
  | 'scan_error'
  | 'adapter_timeout'
  | 'unknown';

export class BleLibraryError extends Error {
  readonly code: BleErrorCode;

  constructor(code: BleErrorCode, message: string) {
    super(message);
    this.name = 'BleLibraryError';
    this.code = code;
  }
}

export type BleConnectionState =
  | 'disconnected'
  | 'scanning'
  | 'connecting'
  | 'connected';

export interface DiscoveredDevice {
  /** Platform device ID (UUID on iOS, MAC on Android) */
  id: string;
  /** Advertised device name, e.g. "ESP32-WiFi-A1B2C3" */
  name: string;
  /** RSSI at discovery time */
  rssi: number;
}

export interface ConnectedDeviceInfo {
  id: string;
  name: string;
  /** Negotiated MTU (null if not yet negotiated) */
  mtu: number | null;
}

export interface BleTransportEvents {
  response: (json: string) => void;
  status: (json: string) => void;
  connectionStateChanged: (state: BleConnectionState) => void;
  deviceDiscovered: (device: DiscoveredDevice) => void;
  scanStopped: () => void;
  error: (error: Error) => void;
}

export interface BleTransportConfig {
  /** Device name prefix(es) to filter during scanning. Default: "ESP32-WiFi-" */
  deviceNamePrefix?: string | string[];
  /** Scan timeout in ms. Default: 10000 */
  scanTimeoutMs?: number;
  /** Minimum delay between GATT writes in ms. Default: 120 */
  gattSettleMs?: number;
  /** Connection timeout in ms. Default: 10000 */
  connectionTimeoutMs?: number;
  /** MTU to request. Default: 517 */
  requestedMtu?: number;
}
