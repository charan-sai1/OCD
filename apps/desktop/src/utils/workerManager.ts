// Worker manager utility for async operations
import { wrap } from 'comlink';

class WorkerManager {
  private workers: Record<string, any> = {};
  private initializedWorkers = new Set<string>();

  private async createWorker(workerPath: string): Promise<any> {
    if (this.initializedWorkers.has(workerPath)) {
      return this.workers[workerPath];
    }

    try {
      console.log(`Creating worker: ${workerPath}`);
      const worker = new Worker(new URL(workerPath, import.meta.url), {
        type: 'module'
      });

      const wrapped = wrap(worker);
      this.workers[workerPath] = wrapped;
      this.initializedWorkers.add(workerPath);

      console.log(`Worker created successfully: ${workerPath}`);
      return wrapped;
    } catch (error) {
      console.error(`Failed to create worker ${workerPath}:`, error);
      // Always return mock on failure to ensure app continues working
      console.warn(`Using mock worker for ${workerPath} due to error`);
      return this.createMockWorker(workerPath);
    }
  }

  private createMockWorker(_workerPath: string): any {
    // Return a mock that throws an error to trigger fallback logic
    return {
      scanDirectories: () => { throw new Error('Workers not available'); },
      processBatch: () => { throw new Error('Workers not available'); },
      generateThumbnails: () => { throw new Error('Workers not available'); },
    };
  }

  async getDirectoryScanner(): Promise<any> {
    if (!this.workers['directoryScanner']) {
      this.workers['directoryScanner'] = await this.createWorker(
        '../workers/directoryScanner.worker.ts'
      );
    }
    return this.workers['directoryScanner'];
  }

  async getThumbnailGenerator(): Promise<any> {
    if (!this.workers['thumbnailGenerator']) {
      this.workers['thumbnailGenerator'] = await this.createWorker(
        '../workers/thumbnailGenerator.worker.ts'
      );
    }
    return this.workers['thumbnailGenerator'];
  }

  async getAsyncProcessor(): Promise<any> {
    if (!this.workers['asyncProcessor']) {
      this.workers['asyncProcessor'] = await this.createWorker(
        '../workers/asyncProcessor.worker.ts'
      );
    }
    return this.workers['asyncProcessor'];
  }

  // Cleanup method
  async terminateAll(): Promise<void> {
    // Note: Comlink doesn't provide direct worker termination
    // Workers will terminate when the page unloads
    this.workers = {};
    this.initializedWorkers.clear();
  }

  // Health check
  async pingWorkers(): Promise<Record<string, boolean>> {
    const results: Record<string, boolean> = {};

    try {
      const scanner = await this.getDirectoryScanner();
      await scanner.scanDirectories([], {});
      results.directoryScanner = true;
    } catch {
      results.directoryScanner = false;
    }

    try {
      const generator = await this.getThumbnailGenerator();
      await generator.generateThumbnails([]);
      results.thumbnailGenerator = true;
    } catch {
      results.thumbnailGenerator = false;
    }

    try {
      const processor = await this.getAsyncProcessor();
      await processor.processStateUpdates([]);
      results.asyncProcessor = true;
    } catch {
      results.asyncProcessor = false;
    }

    return results;
  }
}

export const workerManager = new WorkerManager();