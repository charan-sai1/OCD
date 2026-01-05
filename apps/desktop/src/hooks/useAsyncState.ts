// Async state update hook using web worker
import { useState, useCallback, useRef } from 'react';

export function useAsyncState<T>(initialState: T) {
  const [state, setState] = useState<T>(initialState);
  const pendingUpdates = useRef<any[]>([]);
  const isProcessing = useRef(false);

  const asyncSetState = useCallback(async (updater: T | ((prevState: T) => T)) => {
    const newState = typeof updater === 'function'
      ? (updater as (prevState: T) => T)(state)
      : updater;

    pendingUpdates.current.push(newState);

    if (isProcessing.current) return;

    isProcessing.current = true;

    try {
      // Import workerManager dynamically to avoid circular dependencies
      const { workerManager } = await import('../utils/workerManager');
      const asyncProcessor = await workerManager.getAsyncProcessor();
      const processedUpdates = await asyncProcessor.processStateUpdates(pendingUpdates.current, 50);

      // Apply the latest update
      const latestUpdate = processedUpdates[processedUpdates.length - 1];
      setState(latestUpdate);

      pendingUpdates.current = [];
    } catch (error) {
      console.error('Error in async state update:', error);
      // Fallback to synchronous update
      setState(newState);
      pendingUpdates.current = [];
    } finally {
      isProcessing.current = false;
    }
  }, [state]);

  return [state, asyncSetState] as const;
}