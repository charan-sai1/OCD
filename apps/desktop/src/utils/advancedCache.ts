interface CacheEntry {
  imagePath: string;
  blob: Blob;
  thumbnailUrl?: string;
  created: number;
  lastAccessed: number;
  size: number;
  quality: 'low' | 'medium' | 'high';
}

interface CacheStats {
  count: number;
  totalSize: number;
  oldestEntry: number;
  newestEntry: number;
  hitRate: number;
}

class AdvancedImageCache {
  private db: IDBDatabase | null = null;
  private memoryCache = new Map<string, string>();
  private readonly MAX_MEMORY_CACHE = 50;
  private readonly MAX_DISK_CACHE = 200 * 1024 * 1024; // 200MB default, can be configured
  private accessCount = 0;
  private hitCount = 0;

  constructor(private maxDiskCacheSize: number = 200 * 1024 * 1024) {}

  async init(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('AdvancedImageCache', 2);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // Create thumbnails store if it doesn't exist
        if (!db.objectStoreNames.contains('thumbnails')) {
          const store = db.createObjectStore('thumbnails', { keyPath: 'imagePath' });
          store.createIndex('lastAccessed', 'lastAccessed', { unique: false });
          store.createIndex('created', 'created', { unique: false });
          store.createIndex('quality', 'quality', { unique: false });
        }

        // Create metadata store for stats
        if (!db.objectStoreNames.contains('metadata')) {
          db.createObjectStore('metadata', { keyPath: 'key' });
        }
      };
    });
  }

  async get(imagePath: string, quality?: 'low' | 'medium' | 'high'): Promise<string | null> {
    if (!this.db) await this.init();

    this.accessCount++;

    // Check memory cache first
    const memoryKey = quality ? `${imagePath}_${quality}` : imagePath;
    const memoryResult = this.memoryCache.get(memoryKey);
    if (memoryResult) {
      this.hitCount++;
      return memoryResult;
    }

    // Check disk cache
    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readonly');
      const store = transaction.objectStore('thumbnails');

      let request: IDBRequest;
      if (quality) {
        // Look for specific quality
        const index = store.index('quality');
        request = index.get([imagePath, quality]);
      } else {
        // Look for any quality
        request = store.get(imagePath);
      }

      request.onsuccess = () => {
        const cached = request.result as CacheEntry | undefined;
        if (cached) {
          this.hitCount++;

          // Update last accessed time
          cached.lastAccessed = Date.now();
          this.updateLastAccessed(cached);

          // Create object URL and store in memory cache
          const url = URL.createObjectURL(cached.blob);
          cached.thumbnailUrl = url;

          // Add to memory cache
          this.memoryCache.set(memoryKey, url);

          // Maintain memory cache size
          if (this.memoryCache.size > this.MAX_MEMORY_CACHE) {
            const firstKey = this.memoryCache.keys().next().value;
            this.memoryCache.delete(firstKey);
          }

          resolve(url);
        } else {
          resolve(null);
        }
      };

      request.onerror = () => resolve(null);
    });
  }

  async set(imagePath: string, blob: Blob, quality: 'low' | 'medium' | 'high'): Promise<void> {
    if (!this.db) await this.init();

    // Clean up old entries if needed
    await this.cleanupIfNeeded(blob.size);

    const cached: CacheEntry = {
      imagePath,
      blob,
      created: Date.now(),
      lastAccessed: Date.now(),
      size: blob.size,
      quality
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const request = store.put(cached);

      request.onsuccess = () => {
        // Add to memory cache
        const url = URL.createObjectURL(blob);
        const memoryKey = `${imagePath}_${quality}`;
        this.memoryCache.set(memoryKey, url);

        resolve();
      };

      request.onerror = () => reject(request.error);
    });
  }

  async cleanup(): Promise<void> {
    if (!this.db) await this.init();

    // Smart eviction based on LRU and size limits
    const stats = await this.getStats();

    if (stats.totalSize <= this.maxDiskCacheSize) {
      return; // No cleanup needed
    }

    const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
    const store = transaction.objectStore('thumbnails');
    const index = store.index('lastAccessed');

    const request = index.openCursor();
    let deletedSize = 0;
    const targetSize = this.maxDiskCacheSize * 0.8; // Target 80% of max size

    request.onsuccess = () => {
      const cursor = request.result;
      if (cursor && stats.totalSize - deletedSize > targetSize) {
        const cached = cursor.value as CacheEntry;
        deletedSize += cached.size;

        // Clean up object URL if it exists
        if (cached.thumbnailUrl) {
          URL.revokeObjectURL(cached.thumbnailUrl);
        }

        // Remove from memory cache
        const memoryKey = `${cached.imagePath}_${cached.quality}`;
        this.memoryCache.delete(memoryKey);

        cursor.delete();
        cursor.continue();
      }
    };
  }

  async getStats(): Promise<CacheStats> {
    if (!this.db) await this.init();

    return new Promise((resolve) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readonly');
      const store = transaction.objectStore('thumbnails');
      const request = store.getAll();

      request.onsuccess = () => {
        const entries = request.result as CacheEntry[];
        const stats = {
          count: entries.length,
          totalSize: entries.reduce((sum, entry) => sum + entry.size, 0),
          oldestEntry: entries.length > 0 ? Math.min(...entries.map(e => e.created)) : 0,
          newestEntry: entries.length > 0 ? Math.max(...entries.map(e => e.created)) : 0,
          hitRate: this.accessCount > 0 ? this.hitCount / this.accessCount : 0
        };
        resolve(stats);
      };

      request.onerror = () => resolve({
        count: 0,
        totalSize: 0,
        oldestEntry: 0,
        newestEntry: 0,
        hitRate: 0
      });
    });
  }

  async clear(): Promise<void> {
    if (!this.db) await this.init();

    // Clean up memory cache URLs
    for (const url of this.memoryCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.memoryCache.clear();

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
      const store = transaction.objectStore('thumbnails');
      const request = store.clear();

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  setMaxCacheSize(sizeMB: number): void {
    this.maxDiskCacheSize = sizeMB * 1024 * 1024;
  }

  private async updateLastAccessed(cached: CacheEntry): Promise<void> {
    const transaction = this.db!.transaction(['thumbnails'], 'readwrite');
    const store = transaction.objectStore('thumbnails');
    store.put(cached);
  }

  private async cleanupIfNeeded(newEntrySize: number): Promise<void> {
    const stats = await this.getStats();

    if (stats.totalSize + newEntrySize <= this.maxDiskCacheSize) {
      return; // No cleanup needed
    }

    await this.cleanup();
  }
}

// Singleton instance
export const advancedImageCache = new AdvancedImageCache();
export type { CacheEntry, CacheStats };