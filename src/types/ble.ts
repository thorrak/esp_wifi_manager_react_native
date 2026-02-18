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
  /** Device name prefix to filter during scanning. Default: "ESP32-WiFi-" */
  deviceNamePrefix?: string;
  /** Scan timeout in ms. Default: 15000 */
  scanTimeoutMs?: number;
  /** Minimum delay between GATT writes in ms. Default: 120 */
  gattSettleMs?: number;
  /** Connection timeout in ms. Default: 10000 */
  connectionTimeoutMs?: number;
  /** MTU to request. Default: 517 */
  requestedMtu?: number;
}
