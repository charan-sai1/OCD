// Async utilities web worker for batch processing
import { expose } from 'comlink';

interface BatchUpdateRequest {
  id: string;
  data: any[];
  batchSize: number;
  delay: number;
}

interface BatchUpdateResult {
  id: string;
  processed: any[];
  completed: boolean;
}

class AsyncProcessor {
  private activeBatches = new Map<string, { data: any[], batchSize: number, delay: number, processed: any[] }>();

  async processBatch(request: BatchUpdateRequest): Promise<BatchUpdateResult> {
    const { id, data, batchSize, delay } = request;

    this.activeBatches.set(id, { data, batchSize, delay, processed: [] });

    const result = await this.processBatchInternal(id);

    this.activeBatches.delete(id);

    return result;
  }

  private async processBatchInternal(id: string): Promise<BatchUpdateResult> {
    const batch = this.activeBatches.get(id);
    if (!batch) {
      throw new Error(`Batch ${id} not found`);
    }

    const { data, batchSize, delay } = batch;
    const processed: any[] = [];

    for (let i = 0; i < data.length; i += batchSize) {
      const chunk = data.slice(i, i + batchSize);
      processed.push(...chunk);

      // Update progress
      batch.processed = [...processed];

      // Yield control with delay
      await new Promise(resolve => setTimeout(resolve, delay));
    }

    return {
      id,
      processed,
      completed: true,
    };
  }

  // Cancel a batch operation
  cancelBatch(id: string): boolean {
    return this.activeBatches.delete(id);
  }

  // Get batch progress
  getBatchProgress(id: string): { processed: number; total: number; completed: boolean } | null {
    const batch = this.activeBatches.get(id);
    if (!batch) return null;

    return {
      processed: batch.processed.length,
      total: batch.data.length,
      completed: batch.processed.length >= batch.data.length,
    };
  }

  // Debounced state update processor
  async processStateUpdates(updates: any[], debounceMs: number = 100): Promise<any[]> {
    // Group updates and apply debouncing
    const debouncedUpdates: any[] = [];

    for (const update of updates) {
      debouncedUpdates.push(update);
      await new Promise(resolve => setTimeout(resolve, debounceMs));
    }

    return debouncedUpdates;
  }
}

expose(AsyncProcessor);