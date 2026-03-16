// Progressive Image Preloader with Multi-Tier Caching
import { asyncScheduler } from "./requestIdleCallbackPolyfill";

export enum ImageQuality {
  THUMBNAIL = 'thumbnail',
  PREVIEW = 'preview',
  FULL = 'full'
}

export enum LoadingPriority {
  IMMEDIATE = 0,    // Currently visible - load now
  HIGH = 1,         // Near viewport - load soon
  NORMAL = 2,       // Far viewport - load when idle
  LOW = 3,          // Background prefetch - load when very idle
  IDLE = 4          // Only when nothing else is loading
}

interface CacheEntry {
  data: string;
  timestamp: number;
  accessCount: number;
  size: number; // Estimated memory size in bytes
}

interface ProgressiveImageRequest {
  imagePath: string;
  qualities: {
    [ImageQuality.THUMBNAIL]?: number;
    [ImageQuality.PREVIEW]?: number;
    [ImageQuality.FULL]?: boolean;
  };
  priority: LoadingPriority;
  onProgress?: (quality: ImageQuality, data: string) => void;
  onComplete?: (results: ProgressiveImageResult) => void;
  onError?: (error: string) => void;
}

interface ProgressiveImageResult {
  imagePath: string;
  thumbnail?: string;
  preview?: string;
  full?: string;
  error?: string;
}

class LRUCache {
  private cache = new Map<string, CacheEntry>();
  private maxSize: number;
  private currentSize = 0;

  constructor(maxSize: number) {
    this.maxSize = maxSize;
  }

  get(key: string): CacheEntry | undefined {
    const entry = this.cache.get(key);
    if (entry) {
      entry.accessCount++;
      entry.timestamp = Date.now();
    }
    return entry;
  }

  set(key: string, value: CacheEntry): void {
    const existingEntry = this.cache.get(key);
    if (existingEntry) {
      this.currentSize -= existingEntry.size;
    }

    this.cache.set(key, value);
    this.currentSize += value.size;

    // Evict if over capacity
    while (this.currentSize > this.maxSize && this.cache.size > 0) {
      this.evictLRU();
    }
  }

  has(key: string): boolean {
    return this.cache.has(key);
  }

  delete(key: string): boolean {
    const entry = this.cache.get(key);
    if (entry) {
      this.currentSize -= entry.size;
      return this.cache.delete(key);
    }
    return false;
  }

  private evictLRU(): void {
    let oldestKey = '';
    let oldestTime = Date.now();

    for (const [key, entry] of this.cache) {
      if (entry.timestamp < oldestTime) {
        oldestTime = entry.timestamp;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      const entry = this.cache.get(oldestKey);
      if (entry) {
        this.currentSize -= entry.size;
      }
      this.cache.delete(oldestKey);
    }
  }

  getStats() {
    return {
      size: this.cache.size,
      memoryUsage: this.currentSize,
      maxSize: this.maxSize
    };
  }

  clear(): void {
    this.cache.clear();
    this.currentSize = 0;
  }
}

export class ProgressiveImagePreloader {
  private thumbnailCache = new LRUCache(50 * 1024 * 1024); // 50MB for thumbnails
  private previewCache = new LRUCache(200 * 1024 * 1024);  // 200MB for previews
  private fullCache = new LRUCache(500 * 1024 * 1024);     // 500MB for full-res

  private loadingQueue: ProgressiveImageRequest[] = [];
  private activeLoads = new Set<string>();
  private maxConcurrent = 3; // Reduced for better performance with large collections

  constructor() {
    // Workers will be initialized on demand
  }

  async loadProgressiveImage(request: ProgressiveImageRequest): Promise<ProgressiveImageResult> {
    const { imagePath, qualities } = request;

    // Check cache first
    const cachedResult = this.getCachedResult(imagePath, qualities);
    if (cachedResult) {
      request.onComplete?.(cachedResult);
      return cachedResult;
    }

    // Add to loading queue
    this.loadingQueue.push(request);
    this.loadingQueue.sort((a, b) => a.priority - b.priority); // Higher priority first

    // Start processing queue
    this.processQueue();

    // Return promise that resolves when loading is complete
    return new Promise((resolve, reject) => {
      request.onComplete = (result) => {
        resolve(result);
      };
      request.onError = (error) => {
        reject(new Error(error));
      };
    });
  }

  private getCachedResult(imagePath: string, qualities: ProgressiveImageRequest['qualities']): ProgressiveImageResult | null {
    const result: ProgressiveImageResult = { imagePath };

    let hasAnyCached = false;

    // Check each quality level
    if (qualities.thumbnail && this.thumbnailCache.has(`${imagePath}-thumbnail-${qualities.thumbnail}`)) {
      const entry = this.thumbnailCache.get(`${imagePath}-thumbnail-${qualities.thumbnail}`);
      if (entry) {
        result.thumbnail = entry.data;
        hasAnyCached = true;
      }
    }

    if (qualities.preview && this.previewCache.has(`${imagePath}-preview-${qualities.preview}`)) {
      const entry = this.previewCache.get(`${imagePath}-preview-${qualities.preview}`);
      if (entry) {
        result.preview = entry.data;
        hasAnyCached = true;
      }
    }

    if (qualities.full && this.fullCache.has(`${imagePath}-full`)) {
      const entry = this.fullCache.get(`${imagePath}-full`);
      if (entry) {
        result.full = entry.data;
        hasAnyCached = true;
      }
    }

    return hasAnyCached ? result : null;
  }

  private async processQueue() {
    if (this.activeLoads.size >= this.maxConcurrent || this.loadingQueue.length === 0) {
      return;
    }

    const request = this.loadingQueue.shift();
    if (!request) return;

    const requestId = `${request.imagePath}-${Date.now()}`;
    this.activeLoads.add(requestId);

    try {
      const result = await this.loadImageQualities(request);
      request.onComplete?.(result);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      request.onError?.(errorMessage);
    } finally {
      this.activeLoads.delete(requestId);
      // Continue processing queue
      asyncScheduler.schedule(() => this.processQueue());
    }
  }

  private async loadImageQualities(request: ProgressiveImageRequest): Promise<ProgressiveImageResult> {
    const { imagePath, qualities } = request;
    const result: ProgressiveImageResult = { imagePath };

    console.log('ProgressiveImagePreloader: Loading qualities for', imagePath, qualities);

    try {
      const { invoke } = await import('@tauri-apps/api/core');

      // Process thumbnail (prefer EXIF, fallback to generation)
      if (qualities.thumbnail) {
        try {
          console.log('ProgressiveImagePreloader: Extracting/generating thumbnail for', imagePath);
          const thumbnail = await invoke('extract_or_generate_thumbnail', {
            imagePath,
            size: qualities.thumbnail
          });

          this.cacheImage(`${imagePath}-thumbnail-${qualities.thumbnail}`, thumbnail as string, ImageQuality.THUMBNAIL);
          result.thumbnail = thumbnail as string;
          request.onProgress?.(ImageQuality.THUMBNAIL, thumbnail as string);
          console.log('ProgressiveImagePreloader: Thumbnail loaded successfully');
        } catch (thumbnailError) {
          console.error('ProgressiveImagePreloader: Thumbnail extraction/generation failed', thumbnailError);
          result.error = `Thumbnail: ${thumbnailError instanceof Error ? thumbnailError.message : 'Failed'}`;
        }
      }

      // Process preview (always generate for consistency)
      if (qualities.preview) {
        try {
          console.log('ProgressiveImagePreloader: Generating preview for', imagePath);
          const preview = await invoke('generate_thumbnail', {
            imagePath,
            size: qualities.preview
          });

          this.cacheImage(`${imagePath}-preview-${qualities.preview}`, preview as string, ImageQuality.PREVIEW);
          result.preview = preview as string;
          request.onProgress?.(ImageQuality.PREVIEW, preview as string);
          console.log('ProgressiveImagePreloader: Preview generated successfully');
        } catch (previewError) {
          console.error('ProgressiveImagePreloader: Preview generation failed', previewError);
          if (!result.error) {
            result.error = `Preview: ${previewError instanceof Error ? previewError.message : 'Failed'}`;
          }
        }
      }

      // Process full resolution
      if (qualities.full) {
        try {
          console.log('ProgressiveImagePreloader: Loading full resolution for', imagePath);
          // For full resolution, use the original image URL
          const { convertFileSrc } = await import('@tauri-apps/api/core');
          const fullUrl = convertFileSrc(imagePath);

          this.cacheImage(`${imagePath}-full`, fullUrl, ImageQuality.FULL);
          result.full = fullUrl;
          request.onProgress?.(ImageQuality.FULL, fullUrl);
          console.log('ProgressiveImagePreloader: Full resolution loaded successfully');
        } catch (fullError) {
          console.error('ProgressiveImagePreloader: Full resolution loading failed', fullError);
          if (!result.error) {
            result.error = `Full: ${fullError instanceof Error ? fullError.message : 'Failed'}`;
          }
        }
      }

    } catch (error) {
      console.error('ProgressiveImagePreloader: General error', error);
      result.error = error instanceof Error ? error.message : 'Failed to load image';
    }

    return result;
  }

  private cacheImage(key: string, data: string, quality: ImageQuality): void {
    // Estimate memory size (base64 is ~33% larger than binary)
    const estimatedSize = data.length * 0.75; // Rough estimate

    const entry: CacheEntry = {
      data,
      timestamp: Date.now(),
      accessCount: 1,
      size: estimatedSize
    };

    switch (quality) {
      case ImageQuality.THUMBNAIL:
        this.thumbnailCache.set(key, entry);
        break;
      case ImageQuality.PREVIEW:
        this.previewCache.set(key, entry);
        break;
      case ImageQuality.FULL:
        this.fullCache.set(key, entry);
        break;
    }
  }

  // Public methods for cache management
  preloadBatch(images: string[], qualities: ProgressiveImageRequest['qualities'], priority: LoadingPriority = LoadingPriority.NORMAL): void {
    // Process images in smaller batches to prevent overwhelming the system
    const batchSize = 20; // Process 20 images at a time

    for (let i = 0; i < images.length; i += batchSize) {
      const batch = images.slice(i, i + batchSize);
      const requests = batch.map(imagePath => ({
        imagePath,
        qualities,
        priority
      }));

      // Add delay between batches to prevent system overload
      setTimeout(() => {
        requests.forEach(request => this.loadProgressiveImage(request));
      }, (i / batchSize) * 100); // 100ms delay between batches
    }
  }

  getImage(imagePath: string, quality: ImageQuality, size?: number): string | null {
    const key = size ? `${imagePath}-${quality}-${size}` : `${imagePath}-${quality}`;
    let entry: CacheEntry | undefined;

    switch (quality) {
      case ImageQuality.THUMBNAIL:
        entry = this.thumbnailCache.get(key);
        break;
      case ImageQuality.PREVIEW:
        entry = this.previewCache.get(key);
        break;
      case ImageQuality.FULL:
        entry = this.fullCache.get(key);
        break;
    }

    return entry?.data || null;
  }

  isLoaded(imagePath: string, quality: ImageQuality, size?: number): boolean {
    const key = size ? `${imagePath}-${quality}-${size}` : `${imagePath}-${quality}`;

    switch (quality) {
      case ImageQuality.THUMBNAIL:
        return this.thumbnailCache.has(key);
      case ImageQuality.PREVIEW:
        return this.previewCache.has(key);
      case ImageQuality.FULL:
        return this.fullCache.has(key);
    }

    return false;
  }

  getStats() {
    return {
      thumbnail: this.thumbnailCache.getStats(),
      preview: this.previewCache.getStats(),
      full: this.fullCache.getStats(),
      activeLoads: this.activeLoads.size,
      queueLength: this.loadingQueue.length
    };
  }

  clearCache(quality?: ImageQuality): void {
    if (quality === ImageQuality.THUMBNAIL) {
      this.thumbnailCache.clear();
    } else if (quality === ImageQuality.PREVIEW) {
      this.previewCache.clear();
    } else if (quality === ImageQuality.FULL) {
      this.fullCache.clear();
    } else {
      this.thumbnailCache.clear();
      this.previewCache.clear();
      this.fullCache.clear();
    }
  }

  // Cleanup method
  destroy(): void {
    this.loadingQueue = [];
    this.activeLoads.clear();
    this.clearCache();
  }
}

export const progressiveImagePreloader = new ProgressiveImagePreloader();