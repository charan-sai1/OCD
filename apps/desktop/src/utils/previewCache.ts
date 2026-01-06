// IndexedDB-based cache for image previews
// Stores blob data persistently across sessions

interface CachedPreview {
  imagePath: string;
  blob: Blob;
  url?: string; // Temporary URL for current session
  created: number;
  lastAccessed: number;
  size: number;
}

export class PreviewCache {
  private static readonly DB_NAME = 'ImagePreviews';
  private static readonly STORE_NAME = 'previews';
  private static readonly MAX_CACHE_SIZE = 100 * 1024 * 1024; // 100MB limit

  private db: IDBDatabase | null = null;

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(PreviewCache.DB_NAME, 1);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(PreviewCache.STORE_NAME)) {
          const store = db.createObjectStore(PreviewCache.STORE_NAME, { keyPath: 'imagePath' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('created', 'created', { unique: false });
        }
      };
    });
  }

  async get(imagePath: string): Promise<string | null> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readonly');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.get(imagePath);

      request.onsuccess = () => {
        const cached = request.result as CachedPreview | undefined;
        if (cached) {
          // Update last accessed time
          cached.lastAccessed = Date.now();
          this.updateLastAccessed(cached);

          // Create object URL for the blob
          const url = URL.createObjectURL(cached.blob);
          cached.url = url; // Store for cleanup

          resolve(url);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  async set(imagePath: string, blob: Blob): Promise<string> {
    if (!this.db) await this.init();

    // Clean up old entries if needed
    await this.cleanupIfNeeded(blob.size);

    const cached: CachedPreview = {
      imagePath,
      blob,
      created: Date.now(),
      lastAccessed: Date.now(),
      size: blob.size
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.put(cached);

      request.onsuccess = () => {
        const url = URL.createObjectURL(blob);
        resolve(url);
      };

      request.onerror = () => reject(request.error);
    });
  }

  async has(imagePath: string): Promise<boolean> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readonly');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.getKey(imagePath);

      request.onsuccess = () => resolve(!!request.result);
      request.onerror = () => resolve(false);
    });
  }

  async delete(imagePath: string): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.delete(imagePath);

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readwrite');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  async getStats(): Promise<{
    count: number;
    totalSize: number;
    oldestEntry: number;
    newestEntry: number;
  }> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readonly');
      const store = transaction.objectStore(PreviewCache.STORE_NAME);
      const request = store.getAll();

      request.onsuccess = () => {
        const entries = request.result as CachedPreview[];
        const stats = {
          count: entries.length,
          totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
          oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.created)) : 0,
          newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.created)) : 0
        };
        resolve(stats);
      };

      request.onerror = () => resolve({ count: 0, totalSize: 0, oldestEntry: 0, newestEntry: 0 });
    });
  }

  private async updateLastAccessed(cached: CachedPreview): Promise<void> {
    const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PreviewCache.STORE_NAME);
    store.put(cached);
  }

  private async cleanupIfNeeded(newEntrySize: number): Promise<void> {
    const stats = await this.getStats();

    if (stats.totalSize + newEntrySize <= PreviewCache.MAX_CACHE_SIZE) {
      return; // No cleanup needed
    }

    // Clean up old entries (LRU - Least Recently Used)
    const transaction = this.db!.transaction([PreviewCache.STORE_NAME], 'readwrite');
    const store = transaction.objectStore(PreviewCache.STORE_NAME);
    const index = store.index('lastAccessed');

    const request = index.openCursor();
    let deletedSize = 0;
    const targetSize = PreviewCache.MAX_CACHE_SIZE - newEntrySize;

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && stats.totalSize - deletedSize > targetSize) {
        const cached = cursor.value as CachedPreview;
        deletedSize += cached.size;

        // Clean up object URL if it exists
        if (cached.url) {
          URL.revokeObjectURL(cached.url);
        }

        cursor.delete();
        cursor.continue();
      }
    };
  }
}

// Singleton instance
export const previewCache = new PreviewCache();