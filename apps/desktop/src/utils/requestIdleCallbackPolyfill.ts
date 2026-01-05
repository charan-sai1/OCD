// requestIdleCallback polyfill for browsers that don't support it
if (typeof window !== 'undefined' && !window.requestIdleCallback) {
  window.requestIdleCallback = function(callback: IdleRequestCallback, options?: IdleRequestOptions): number {
    const start = Date.now();
    return window.setTimeout(() => {
      try {
        callback({
          didTimeout: false,
          timeRemaining: () => Math.max(0, 50 - (Date.now() - start))
        });
      } catch (error) {
        console.error('requestIdleCallback callback error:', error);
      }
    }, options?.timeout || 1);
  };

  window.cancelIdleCallback = function(id: number) {
    clearTimeout(id);
  };
}

// Async scheduler utility for non-blocking operations
export const asyncScheduler = {
  schedule: (callback: () => void | Promise<void>, options?: { timeout?: number }) => {
    const { timeout = 1 } = options || {};

    // Always use setTimeout for reliability
    return setTimeout(async () => {
      try {
        await callback();
      } catch (error) {
        console.error('Async scheduler error:', error);
      }
    }, timeout);

    try {
      if (typeof window !== 'undefined' && window.requestIdleCallback) {
        const id = window.requestIdleCallback(async () => {
          try {
            await callback();
          } catch (error) {
            console.error('Async scheduler callback error:', error);
          }
        }, { timeout });

        // Fallback timeout in case requestIdleCallback never fires
        setTimeout(async () => {
          try {
            await callback();
          } catch (error) {
            console.error('Async scheduler fallback error:', error);
          }
        }, Math.max(timeout, 100));

        return id;
      } else {
        // Fallback to setTimeout for broader compatibility
        return setTimeout(async () => {
          try {
            await callback();
          } catch (error) {
            console.error('Async scheduler setTimeout error:', error);
          }
        }, timeout);
      }
    } catch (error) {
      console.error('Async scheduler setup error:', error);
      // Final fallback - execute immediately
      setTimeout(async () => {
        try {
          await callback();
        } catch (error) {
          console.error('Async scheduler immediate fallback error:', error);
        }
      }, 0);
      return 0;
    }
  },

  // Immediate execution for critical operations
  immediate: async (callback: () => void | Promise<void>) => {
    try {
      await callback();
    } catch (error) {
      console.error('Immediate async execution error:', error);
    }
  }
};