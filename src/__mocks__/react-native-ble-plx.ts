/**
 * Mock for react-native-ble-plx used in Jest tests.
 *
 * Every method is a jest.fn() so tests can inspect calls, configure return
 * values, and assert invocations.
 */

/* ------------------------------------------------------------------ */
/* Subscription                                                        */
/* ------------------------------------------------------------------ */

export class Subscription {
  remove = jest.fn();
}

/* ------------------------------------------------------------------ */
/* Device                                                              */
/* ------------------------------------------------------------------ */

export class Device {
  id: string;
  name: string | null;
  localName: string | null;
  rssi: number | null;
  mtu: number;

  constructor(
    id: string = 'mock-device-id',
    name: string | null = 'MockDevice',
    rssi: number | null = -50,
    mtu: number = 517,
  ) {
    this.id = id;
    this.name = name;
    this.localName = name;
    this.rssi = rssi;
    this.mtu = mtu;
  }

  discoverAllServicesAndCharacteristics = jest
    .fn()
    .mockResolvedValue(this);

  characteristicsForService = jest
    .fn()
    .mockResolvedValue([]);

  monitorCharacteristicForService = jest
    .fn()
    .mockReturnValue(new Subscription());

  writeCharacteristicWithResponseForService = jest
    .fn()
    .mockResolvedValue(null);
}

/* ------------------------------------------------------------------ */
/* State enum                                                          */
/* ------------------------------------------------------------------ */

export const State = {
  PoweredOn: 'PoweredOn' as const,
  PoweredOff: 'PoweredOff' as const,
  Resetting: 'Resetting' as const,
  Unauthorized: 'Unauthorized' as const,
  Unsupported: 'Unsupported' as const,
  Unknown: 'Unknown' as const,
};

/* ------------------------------------------------------------------ */
/* BleError                                                            */
/* ------------------------------------------------------------------ */

export class BleError extends Error {
  errorCode: number;

  constructor(message: string, errorCode: number = 0) {
    super(message);
    this.name = 'BleError';
    this.errorCode = errorCode;
  }
}

/* ------------------------------------------------------------------ */
/* Characteristic                                                      */
/* ------------------------------------------------------------------ */

export class Characteristic {
  uuid: string;
  value: string | null;

  constructor(uuid: string = '', value: string | null = null) {
    this.uuid = uuid;
    this.value = value;
  }
}

/* ------------------------------------------------------------------ */
/* BleManager                                                          */
/* ------------------------------------------------------------------ */

export class BleManager {
  startDeviceScan = jest.fn();

  stopDeviceScan = jest.fn();

  connectToDevice = jest.fn().mockImplementation(
    (id: string) => Promise.resolve(new Device(id, 'MockDevice', -50, 517)),
  );

  cancelDeviceConnection = jest.fn().mockResolvedValue(undefined);

  onDeviceDisconnected = jest.fn().mockReturnValue(new Subscription());

  onStateChange = jest.fn().mockReturnValue(new Subscription());

  destroy = jest.fn();

  state = jest.fn().mockResolvedValue('PoweredOn');
}
