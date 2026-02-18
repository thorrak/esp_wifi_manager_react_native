import { TypedEventEmitter } from '../utils/EventEmitter';

/**
 * Concrete test emitter with typed events.
 * We extend TypedEventEmitter so we can call the protected emit() method
 * directly in tests.
 */
interface TestEvents {
  data: (value: string) => void;
  count: (n: number) => void;
  empty: () => void;
}

class TestEmitter extends TypedEventEmitter<TestEvents> {
  /** Expose protected emit for testing. */
  public testEmit<K extends keyof TestEvents>(
    event: K,
    ...args: Parameters<TestEvents[K]>
  ): void {
    this.emit(event, ...args);
  }
}

describe('TypedEventEmitter', () => {
  let emitter: TestEmitter;

  beforeEach(() => {
    emitter = new TestEmitter();
  });

  // --------------------------------------------------------------------------
  // on() and emit()
  // --------------------------------------------------------------------------

  describe('on() and emit()', () => {
    it('fires listener when event is emitted', () => {
      const listener = jest.fn();
      emitter.on('data', listener);

      emitter.testEmit('data', 'hello');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith('hello');
    });

    it('passes correct arguments for numeric event', () => {
      const listener = jest.fn();
      emitter.on('count', listener);

      emitter.testEmit('count', 42);

      expect(listener).toHaveBeenCalledWith(42);
    });

    it('fires listener for zero-argument event', () => {
      const listener = jest.fn();
      emitter.on('empty', listener);

      emitter.testEmit('empty');

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener).toHaveBeenCalledWith();
    });

    it('fires listener multiple times on multiple emits', () => {
      const listener = jest.fn();
      emitter.on('data', listener);

      emitter.testEmit('data', 'a');
      emitter.testEmit('data', 'b');
      emitter.testEmit('data', 'c');

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener).toHaveBeenNthCalledWith(1, 'a');
      expect(listener).toHaveBeenNthCalledWith(2, 'b');
      expect(listener).toHaveBeenNthCalledWith(3, 'c');
    });
  });

  // --------------------------------------------------------------------------
  // Unsubscribe (return value of on())
  // --------------------------------------------------------------------------

  describe('unsubscribe function from on()', () => {
    it('returns a function', () => {
      const unsub = emitter.on('data', jest.fn());
      expect(typeof unsub).toBe('function');
    });

    it('removes the listener when called', () => {
      const listener = jest.fn();
      const unsub = emitter.on('data', listener);

      emitter.testEmit('data', 'before');
      expect(listener).toHaveBeenCalledTimes(1);

      unsub();

      emitter.testEmit('data', 'after');
      expect(listener).toHaveBeenCalledTimes(1); // not called again
    });

    it('calling unsubscribe twice does not throw', () => {
      const unsub = emitter.on('data', jest.fn());
      unsub();
      expect(() => unsub()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // off()
  // --------------------------------------------------------------------------

  describe('off()', () => {
    it('removes a specific listener', () => {
      const listener = jest.fn();
      emitter.on('data', listener);

      emitter.off('data', listener);

      emitter.testEmit('data', 'ignored');
      expect(listener).not.toHaveBeenCalled();
    });

    it('does not throw when removing a listener that was never added', () => {
      const listener = jest.fn();
      expect(() => emitter.off('data', listener)).not.toThrow();
    });

    it('only removes the specified listener, not others on the same event', () => {
      const listenerA = jest.fn();
      const listenerB = jest.fn();
      emitter.on('data', listenerA);
      emitter.on('data', listenerB);

      emitter.off('data', listenerA);

      emitter.testEmit('data', 'test');
      expect(listenerA).not.toHaveBeenCalled();
      expect(listenerB).toHaveBeenCalledWith('test');
    });
  });

  // --------------------------------------------------------------------------
  // Multiple listeners on same event
  // --------------------------------------------------------------------------

  describe('multiple listeners on same event', () => {
    it('fires all listeners in registration order', () => {
      const order: string[] = [];
      emitter.on('data', () => order.push('first'));
      emitter.on('data', () => order.push('second'));
      emitter.on('data', () => order.push('third'));

      emitter.testEmit('data', 'test');

      expect(order).toEqual(['first', 'second', 'third']);
    });

    it('each listener receives the same arguments', () => {
      const listenerA = jest.fn();
      const listenerB = jest.fn();
      emitter.on('count', listenerA);
      emitter.on('count', listenerB);

      emitter.testEmit('count', 99);

      expect(listenerA).toHaveBeenCalledWith(99);
      expect(listenerB).toHaveBeenCalledWith(99);
    });
  });

  // --------------------------------------------------------------------------
  // Cross-event isolation
  // --------------------------------------------------------------------------

  describe('cross-event isolation', () => {
    it('listeners on different events do not cross-fire', () => {
      const dataListener = jest.fn();
      const countListener = jest.fn();
      emitter.on('data', dataListener);
      emitter.on('count', countListener);

      emitter.testEmit('data', 'hello');

      expect(dataListener).toHaveBeenCalledTimes(1);
      expect(countListener).not.toHaveBeenCalled();
    });

    it('emitting one event does not affect listeners of another', () => {
      const dataListener = jest.fn();
      const emptyListener = jest.fn();
      emitter.on('data', dataListener);
      emitter.on('empty', emptyListener);

      emitter.testEmit('empty');

      expect(emptyListener).toHaveBeenCalledTimes(1);
      expect(dataListener).not.toHaveBeenCalled();
    });
  });

  // --------------------------------------------------------------------------
  // removeAllListeners()
  // --------------------------------------------------------------------------

  describe('removeAllListeners()', () => {
    it('clears listeners for a specific event', () => {
      const dataListener = jest.fn();
      const countListener = jest.fn();
      emitter.on('data', dataListener);
      emitter.on('count', countListener);

      emitter.removeAllListeners('data');

      emitter.testEmit('data', 'gone');
      emitter.testEmit('count', 5);

      expect(dataListener).not.toHaveBeenCalled();
      expect(countListener).toHaveBeenCalledWith(5);
    });

    it('clears all listeners when called with no argument', () => {
      const dataListener = jest.fn();
      const countListener = jest.fn();
      const emptyListener = jest.fn();
      emitter.on('data', dataListener);
      emitter.on('count', countListener);
      emitter.on('empty', emptyListener);

      emitter.removeAllListeners();

      emitter.testEmit('data', 'nope');
      emitter.testEmit('count', 0);
      emitter.testEmit('empty');

      expect(dataListener).not.toHaveBeenCalled();
      expect(countListener).not.toHaveBeenCalled();
      expect(emptyListener).not.toHaveBeenCalled();
    });

    it('does not throw when called on an event with no listeners', () => {
      expect(() => emitter.removeAllListeners('data')).not.toThrow();
    });

    it('does not throw when called with no argument and no listeners exist', () => {
      expect(() => emitter.removeAllListeners()).not.toThrow();
    });
  });

  // --------------------------------------------------------------------------
  // emit() with no listeners
  // --------------------------------------------------------------------------

  describe('emit() with no listeners', () => {
    it('does not throw when emitting an event with no listeners', () => {
      expect(() => emitter.testEmit('data', 'orphan')).not.toThrow();
    });

    it('does not throw for zero-arg event with no listeners', () => {
      expect(() => emitter.testEmit('empty')).not.toThrow();
    });
  });
});
