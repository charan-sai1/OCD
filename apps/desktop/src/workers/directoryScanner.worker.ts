// Directory scanning web worker
import { expose } from 'comlink';

interface ScanResult {
  path: string;
  images: string[];
  error?: string;
}

class DirectoryScanner {
  async scanDirectories(paths: string[], cache: Record<string, { images: string[], timestamp: number }>): Promise<ScanResult[]> {
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

    // Process directories in parallel
    const scanResults = await Promise.all(paths.map(async (path) => {
      try {
        // Import the invoke function dynamically to avoid main thread dependencies
        const { invoke } = await import('@tauri-apps/api/core');

        const cached = cache[path];
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          return {
            path,
            images: cached.images,
          };
        }

        // Scan directory for fresh data
        const images: string[] = await invoke("list_files", {
          path: path,
          fileType: "images",
        });

        return {
          path,
          images,
        };
      } catch (error) {
        return {
          path,
          images: [],
          error: error instanceof Error ? error.message : 'Unknown error',
        };
      }
    }));

    return scanResults;
  }
}

expose(DirectoryScanner);