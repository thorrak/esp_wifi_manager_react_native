/**
 * Minimal typed event emitter for service-to-store communication.
 *
 * Type parameter T maps event names to their handler signatures.
 * Example:
 *   interface MyEvents {
 *     data: (value: string) => void;
 *     error: (err: Error) => void;
 *   }
 *   class MyService extends TypedEventEmitter<MyEvents> { ... }
 */

// Using a permissive constraint that works with both interfaces and type aliases.
// TypeScript interfaces don't satisfy `Record<string, ...>` because they lack
// implicit index signatures, so we use a minimal object constraint instead.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class TypedEventEmitter<T extends { [K in keyof T]: (...args: any[]) => void }> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private listeners = new Map<keyof T, Set<(...args: any[]) => void>>();

  on<K extends keyof T>(event: K, listener: T[K]): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.listeners.get(event)!.add(listener as (...args: any[]) => void);

    return () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      this.listeners.get(event)?.delete(listener as (...args: any[]) => void);
    };
  }

  off<K extends keyof T>(event: K, listener: T[K]): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    this.listeners.get(event)?.delete(listener as (...args: any[]) => void);
  }

  protected emit<K extends keyof T>(
    event: K,
    ...args: Parameters<T[K]>
  ): void {
    const set = this.listeners.get(event);
    if (set) {
      for (const listener of set) {
        (listener as (...a: Parameters<T[K]>) => void)(...args);
      }
    }
  }

  removeAllListeners(event?: keyof T): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
