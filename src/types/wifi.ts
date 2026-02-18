export type WifiConnectionState = 'connected' | 'connecting' | 'disconnected';

export type WifiAuthType =
  | 'OPEN'
  | 'WEP'
  | 'WPA'
  | 'WPA2'
  | 'WPA/WPA2'
  | 'WPA3'
  | 'UNKNOWN';

export interface WifiStatus {
  state: WifiConnectionState;
  ssid: string;
  rssi: number;
  quality: number;
  ip: string;
  channel: number;
  netmask: string;
  gateway: string;
  dns: string;
  mac: string;
  hostname: string;
  uptime_ms: number;
  ap_active: boolean;
}

export interface ScannedNetwork {
  ssid: string;
  rssi: number;
  auth: WifiAuthType;
}

export interface SavedNetwork {
  ssid: string;
  priority: number;
}

export interface ScanResponseData {
  networks: ScannedNetwork[];
}

export interface ListNetworksResponseData {
  networks: SavedNetwork[];
}

export interface ApStatus {
  active: boolean;
  ssid: string;
  ip: string;
  sta_count: number;
}

export interface DeviceVariable {
  key: string;
  value: string;
}
