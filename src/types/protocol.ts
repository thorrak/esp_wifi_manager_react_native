export type CommandName =
  | 'get_status'
  | 'scan'
  | 'list_networks'
  | 'add_network'
  | 'del_network'
  | 'connect'
  | 'disconnect'
  | 'get_ap_status'
  | 'start_ap'
  | 'stop_ap'
  | 'get_var'
  | 'set_var'
  | 'factory_reset';

export interface AddNetworkParams {
  ssid: string;
  password?: string;
  priority?: number;
}

export interface DelNetworkParams {
  ssid: string;
}

export interface ConnectParams {
  ssid?: string;
}

export interface StartApParams {
  ssid?: string;
  password?: string;
}

export interface GetVarParams {
  key: string;
}

export interface SetVarParams {
  key: string;
  value: string;
}

export interface CommandEnvelope {
  cmd: CommandName;
  params?: Record<string, unknown>;
}

export interface ResponseEnvelopeOk<T = Record<string, unknown>> {
  status: 'ok' | 'success';
  data: T;
}

export interface ResponseEnvelopeError {
  status: 'error';
  error: string;
  message?: string;
}

export type ResponseEnvelope<T = Record<string, unknown>> =
  | ResponseEnvelopeOk<T>
  | ResponseEnvelopeError;

export interface DeviceProtocolEvents {
  busyChanged: (busy: boolean) => void;
  commandError: (error: Error, command: CommandName) => void;
}

export interface DeviceProtocolConfig {
  /** Default command timeout in ms. Default: 8000 */
  defaultTimeoutMs?: number;
  /** Per-command timeout overrides */
  commandTimeouts?: Partial<Record<CommandName, number>>;
}
