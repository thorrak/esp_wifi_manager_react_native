/**
 * Tests for the ConnectionPoller service.
 *
 * Uses Jest fake timers and a mocked DeviceProtocol to simulate polling
 * for WiFi connection state changes.
 */

// Provide __DEV__ for the logger module.
(globalThis as Record<string, unknown>).__DEV__ = false;

import { ConnectionPoller } from '../services/ConnectionPoller';
import type { WifiStatus } from '../types/wifi';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStatus(
  overrides: Partial<WifiStatus> = {},
): WifiStatus {
  return {
    state: 'disconnected',
    ssid: '',
    rssi: 0,
    quality: 0,
    ip: '',
    channel: 0,
    netmask: '',
    gateway: '',
    dns: '',
    mac: '',
    hostname: '',
    uptime_ms: 0,
    ap_active: false,
    ...overrides,
  };
}

function createMockProtocol() {
  return {
    getStatus: jest.fn<Promise<WifiStatus>, []>().mockResolvedValue(
      makeStatus(),
    ),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ConnectionPoller', () => {
  let mockProtocol: ReturnType<typeof createMockProtocol>;
  let poller: ConnectionPoller;

  beforeEach(() => {
    jest.useFakeTimers();
    mockProtocol = createMockProtocol();
    poller = new ConnectionPoller(mockProtocol as never);
  });

  afterEach(() => {
    poller.destroy();
    jest.useRealTimers();
  });

  // --------------------------------------------------------------------------
  // startPolling basics
  // --------------------------------------------------------------------------

  describe('startPolling', () => {
    it('calls getStatus immediately', async () => {
      poller.startPolling(30000, 2000);

      // Flush the immediate microtask from doPoll().
      await jest.advanceTimersByTimeAsync(0);

      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(1);
    });

    it('calls getStatus on each interval tick', async () => {
      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0); // immediate poll

      await jest.advanceTimersByTimeAsync(1000); // tick 1
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(2);

      await jest.advanceTimersByTimeAsync(1000); // tick 2
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(3);

      await jest.advanceTimersByTimeAsync(1000); // tick 3
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(4);
    });

    it('is a no-op when already polling', async () => {
      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      poller.startPolling(30000, 1000); // should be ignored
      await jest.advanceTimersByTimeAsync(0);

      // Should still only have been called once (from first startPolling).
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(1);
    });
  });

  // --------------------------------------------------------------------------
  // Event: wifiStateChanged
  // --------------------------------------------------------------------------

  describe('wifiStateChanged event', () => {
    it('emits wifiStateChanged on each successful poll', async () => {
      const handler = jest.fn();
      poller.on('wifiStateChanged', handler);

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(expect.objectContaining({ state: 'disconnected' }));

      await jest.advanceTimersByTimeAsync(1000);
      expect(handler).toHaveBeenCalledTimes(2);
    });
  });

  // --------------------------------------------------------------------------
  // Event: connectionSucceeded
  // --------------------------------------------------------------------------

  describe('connectionSucceeded event', () => {
    it('emits connectionSucceeded when state changes to connected', async () => {
      const handler = jest.fn();
      poller.on('connectionSucceeded', handler);

      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'connected', ssid: 'MyWifi', ip: '192.168.1.50' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          state: 'connected',
          ssid: 'MyWifi',
          ip: '192.168.1.50',
        }),
      );
    });

    it('stops polling after connectionSucceeded', async () => {
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'connected' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(poller.isPolling).toBe(false);

      // Further ticks should not trigger more calls.
      const callCount = mockProtocol.getStatus.mock.calls.length;
      await jest.advanceTimersByTimeAsync(3000);
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(callCount);
    });
  });

  // --------------------------------------------------------------------------
  // Event: connectionFailed
  // --------------------------------------------------------------------------

  describe('connectionFailed event', () => {
    it('emits connectionFailed when connecting -> disconnected', async () => {
      const handler = jest.fn();
      poller.on('connectionFailed', handler);

      // First poll: connecting
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'connecting' }),
      );
      // Second poll: disconnected (failure)
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'disconnected' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0); // poll 1: connecting

      expect(handler).not.toHaveBeenCalled();

      await jest.advanceTimersByTimeAsync(1000); // poll 2: disconnected

      expect(handler).toHaveBeenCalledTimes(1);
      expect(poller.hasConnectionFailed).toBe(true);
    });

    it('stops polling after connectionFailed', async () => {
      mockProtocol.getStatus
        .mockResolvedValueOnce(makeStatus({ state: 'connecting' }))
        .mockResolvedValueOnce(makeStatus({ state: 'disconnected' }));

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0); // connecting
      await jest.advanceTimersByTimeAsync(1000); // disconnected -> fail

      expect(poller.isPolling).toBe(false);
    });

    it('does not emit connectionFailed if never saw connecting', async () => {
      const handler = jest.fn();
      poller.on('connectionFailed', handler);

      // Both polls return disconnected, but we never saw connecting.
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'disconnected' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);
      await jest.advanceTimersByTimeAsync(1000);

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // Event: connectionTimedOut
  // --------------------------------------------------------------------------

  describe('connectionTimedOut event', () => {
    it('emits connectionTimedOut when timeout fires', async () => {
      const handler = jest.fn();
      poller.on('connectionTimedOut', handler);

      // Device stays in connecting state forever.
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'connecting' }),
      );

      poller.startPolling(5000, 1000);
      await jest.advanceTimersByTimeAsync(0); // immediate poll

      // Advance past the timeout.
      await jest.advanceTimersByTimeAsync(5000);

      expect(handler).toHaveBeenCalledTimes(1);
      expect(poller.isPolling).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // Poll errors
  // --------------------------------------------------------------------------

  describe('poll error handling', () => {
    it('emits pollError but does not stop polling', async () => {
      const errorHandler = jest.fn();
      const stateHandler = jest.fn();
      poller.on('pollError', errorHandler);
      poller.on('wifiStateChanged', stateHandler);

      // First poll: error.
      mockProtocol.getStatus.mockRejectedValueOnce(new Error('BLE timeout'));
      // Second poll: success.
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'disconnected' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0); // poll 1: error

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(errorHandler).toHaveBeenCalledWith(expect.any(Error));
      expect(poller.pollError).toBe('BLE timeout');
      expect(poller.isPolling).toBe(true); // still polling

      await jest.advanceTimersByTimeAsync(1000); // poll 2: success
      expect(stateHandler).toHaveBeenCalledTimes(1);
    });

    it('handles non-Error rejections gracefully', async () => {
      const errorHandler = jest.fn();
      poller.on('pollError', errorHandler);

      mockProtocol.getStatus.mockRejectedValueOnce('string error');
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'disconnected' }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(errorHandler).toHaveBeenCalledTimes(1);
      expect(poller.isPolling).toBe(true);
    });
  });

  // --------------------------------------------------------------------------
  // stopPolling
  // --------------------------------------------------------------------------

  describe('stopPolling', () => {
    it('clears timers and sets isPolling to false', async () => {
      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(poller.isPolling).toBe(true);

      poller.stopPolling();

      expect(poller.isPolling).toBe(false);

      // No more polls after stopping.
      const callCount = mockProtocol.getStatus.mock.calls.length;
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(callCount);
    });
  });

  // --------------------------------------------------------------------------
  // pollOnce
  // --------------------------------------------------------------------------

  describe('pollOnce', () => {
    it('makes a single getStatus call', async () => {
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'connected', ssid: 'TestNet', ip: '10.0.0.1' }),
      );

      const result = await poller.pollOnce();

      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(1);
      expect(result.state).toBe('connected');
      expect(result.ssid).toBe('TestNet');
    });

    it('emits wifiStateChanged', async () => {
      const handler = jest.fn();
      poller.on('wifiStateChanged', handler);

      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({ state: 'disconnected' }),
      );

      await poller.pollOnce();

      expect(handler).toHaveBeenCalledTimes(1);
    });

    it('does not start interval polling', async () => {
      mockProtocol.getStatus.mockResolvedValue(makeStatus());

      await poller.pollOnce();

      expect(poller.isPolling).toBe(false);

      // No further calls after time passes.
      await jest.advanceTimersByTimeAsync(5000);
      expect(mockProtocol.getStatus).toHaveBeenCalledTimes(1);
    });

    it('updates internal state', async () => {
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({
          state: 'connected',
          ssid: 'HomeNet',
          ip: '192.168.0.10',
          rssi: -35,
          quality: 85,
        }),
      );

      await poller.pollOnce();

      expect(poller.wifiState).toBe('connected');
      expect(poller.wifiSsid).toBe('HomeNet');
      expect(poller.wifiIp).toBe('192.168.0.10');
      expect(poller.wifiRssi).toBe(-35);
      expect(poller.wifiQuality).toBe(85);
    });
  });

  // --------------------------------------------------------------------------
  // reset
  // --------------------------------------------------------------------------

  describe('reset', () => {
    it('stops polling and resets all state', async () => {
      mockProtocol.getStatus.mockResolvedValue(
        makeStatus({
          state: 'connecting',
          ssid: 'TestNet',
          ip: '10.0.0.1',
          rssi: -50,
          quality: 60,
        }),
      );

      poller.startPolling(30000, 1000);
      await jest.advanceTimersByTimeAsync(0);

      expect(poller.wifiState).toBe('connecting');
      expect(poller.isPolling).toBe(true);

      poller.reset();

      expect(poller.isPolling).toBe(false);
      expect(poller.wifiState).toBe('disconnected');
      expect(poller.wifiSsid).toBe('');
      expect(poller.wifiIp).toBe('');
      expect(poller.wifiRssi).toBe(0);
      expect(poller.wifiQuality).toBe(0);
      expect(poller.hasConnectionFailed).toBe(false);
      expect(poller.pollError).toBeNull();
    });

    it('can be called when not polling without error', () => {
      expect(() => poller.reset()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // State tracking across polls
  // --------------------------------------------------------------------------

  describe('state tracking', () => {
    it('tracks the full connecting -> connected lifecycle', async () => {
      const stateHandler = jest.fn();
      const successHandler = jest.fn();
      poller.on('wifiStateChanged', stateHandler);
      poller.on('connectionSucceeded', successHandler);

      // Poll 1: disconnected
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'disconnected' }),
      );
      // Poll 2: connecting
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({ state: 'connecting', ssid: 'MyWifi' }),
      );
      // Poll 3: connected
      mockProtocol.getStatus.mockResolvedValueOnce(
        makeStatus({
          state: 'connected',
          ssid: 'MyWifi',
          ip: '192.168.1.100',
        }),
      );

      poller.startPolling(30000, 1000);

      await jest.advanceTimersByTimeAsync(0);    // poll 1
      await jest.advanceTimersByTimeAsync(1000);  // poll 2
      await jest.advanceTimersByTimeAsync(1000);  // poll 3

      expect(stateHandler).toHaveBeenCalledTimes(3);
      expect(successHandler).toHaveBeenCalledTimes(1);
      expect(poller.wifiState).toBe('connected');
      expect(poller.wifiSsid).toBe('MyWifi');
      expect(poller.wifiIp).toBe('192.168.1.100');
    });
  });
});
