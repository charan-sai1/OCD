// Image preloading utility for better performance
class ImagePreloader {
  private preloadQueue: string[] = [];
  private loadingImages = new Set<string>();
  private loadedImages = new Map<string, number>(); // LRU cache: url -> last accessed timestamp
  private maxConcurrent = 50; // Increased for smoother scrolling performance
  private maxCacheSize = 200; // Maximum number of images to keep in memory
  private callbacks = new Map<string, ((success: boolean) => void)[]>();
  private intersectionObserver: IntersectionObserver | null = null;
  private observedElements = new Map<string, HTMLElement>();

  constructor() {
    // Initialize intersection observer for lazy loading
    if (typeof window !== 'undefined' && 'IntersectionObserver' in window) {
      this.intersectionObserver = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              const imgSrc = entry.target.getAttribute('data-src');
              if (imgSrc) {
                this.loadImageForElement(imgSrc, entry.target as HTMLElement);
              }
            }
          });
        },
        {
          rootMargin: '50px', // Start loading 50px before element enters viewport
          threshold: 0.1,
        }
      );
    }
  }

  preload(images: string[], onProgress?: (loaded: number, total: number) => void) {
    this.preloadWithPriority(images, 'normal', onProgress);
  }

  preloadWithPriority(images: string[], priority: 'high' | 'normal' = 'normal', onProgress?: (loaded: number, total: number) => void) {
    // Filter out already loaded images
    const newImages = images.filter(img => !this.loadedImages.has(img) && !this.loadingImages.has(img));

    if (newImages.length === 0) {
      onProgress?.(images.length, images.length);
      return;
    }

    // Add high-priority items to the front of the queue, normal to the back
    if (priority === 'high') {
      this.preloadQueue.unshift(...newImages);
    } else {
      this.preloadQueue.push(...newImages);
    }

    this.processQueue(onProgress);
  }

  // Check if image is cached (and update LRU timestamp)
  isLoaded(url: string): boolean {
    if (this.loadedImages.has(url)) {
      this.loadedImages.set(url, Date.now()); // Update access time
      return true;
    }
    return false;
  }

  private async processQueue(onProgress?: (loaded: number, total: number) => void) {
    const total = this.preloadQueue.length + this.loadingImages.size;

    while (this.preloadQueue.length > 0 && this.loadingImages.size < this.maxConcurrent) {
      const imageUrl = this.preloadQueue.shift()!;
      if (this.loadingImages.has(imageUrl) || this.loadedImages.has(imageUrl)) continue;

      this.loadingImages.add(imageUrl);
      this.loadImage(imageUrl).then(success => {
        this.loadingImages.delete(imageUrl);
        if (success) {
          this.addToCache(imageUrl);
        }
        onProgress?.(this.loadedImages.size, total);

        // Continue processing queue
        if (this.preloadQueue.length > 0) {
          setTimeout(() => this.processQueue(onProgress), 10);
        }

        // Notify callbacks
        const callbacks = this.callbacks.get(imageUrl);
        if (callbacks) {
          callbacks.forEach(cb => cb(success));
          this.callbacks.delete(imageUrl);
        }
      });
    }
  }

  private addToCache(url: string) {
    const now = Date.now();
    this.loadedImages.set(url, now);

    // Enforce cache size limit using LRU
    if (this.loadedImages.size > this.maxCacheSize) {
      // Find the least recently used item
      let oldestUrl = '';
      let oldestTime = now;

      for (const [cachedUrl, timestamp] of this.loadedImages) {
        if (timestamp < oldestTime) {
          oldestTime = timestamp;
          oldestUrl = cachedUrl;
        }
      }

      if (oldestUrl) {
        this.loadedImages.delete(oldestUrl);
        // Optionally revoke object URL if it was created
        if (oldestUrl.startsWith('blob:')) {
          URL.revokeObjectURL(oldestUrl);
        }
      }
    }
  }

  private loadImage(url: string): Promise<boolean> {
    return new Promise(resolve => {
      const img = new Image();
      img.onload = () => resolve(true);
      img.onerror = () => {
        console.warn(`Failed to load image: ${url}`);
        resolve(false);
      };
      img.src = url;

      // Add timeout to prevent hanging on slow/unresponsive URLs
      setTimeout(() => resolve(false), 10000); // 10 second timeout
    });
  }

  onImageLoad(url: string, callback: (success: boolean) => void) {
    if (this.isLoaded(url)) {
      callback(true);
      return;
    }

    if (!this.callbacks.has(url)) {
      this.callbacks.set(url, []);
    }
    this.callbacks.get(url)!.push(callback);
  }

  // Lazy loading with intersection observer
  observeImage(element: HTMLElement, imageUrl: string) {
    if (!this.intersectionObserver) {
      // Fallback to immediate loading if intersection observer not supported
      this.loadImageForElement(imageUrl, element);
      return;
    }

    element.setAttribute('data-src', imageUrl);
    this.observedElements.set(imageUrl, element);
    this.intersectionObserver.observe(element);
  }

  unobserveImage(imageUrl: string) {
    const element = this.observedElements.get(imageUrl);
    if (element && this.intersectionObserver) {
      this.intersectionObserver.unobserve(element);
      this.observedElements.delete(imageUrl);
    }
  }

  private async loadImageForElement(imageUrl: string, element: HTMLElement) {
    if (this.isLoaded(imageUrl) || this.loadingImages.has(imageUrl)) {
      return;
    }

    this.loadingImages.add(imageUrl);

    try {
      const success = await this.loadImage(imageUrl);
      if (success) {
        this.addToCache(imageUrl);
        // Update the element's src if it's an img element
        if (element.tagName === 'IMG') {
          (element as HTMLImageElement).src = imageUrl;
        }
      }

      // Notify callbacks
      const callbacks = this.callbacks.get(imageUrl);
      if (callbacks) {
        callbacks.forEach(cb => cb(success));
        this.callbacks.delete(imageUrl);
      }
    } finally {
      this.loadingImages.delete(imageUrl);
    }
  }

  clear() {
    this.preloadQueue = [];
    this.loadingImages.clear();
    this.callbacks.clear();

    // Clean up intersection observer
    if (this.intersectionObserver) {
      this.observedElements.forEach((element) => {
        this.intersectionObserver!.unobserve(element);
      });
      this.observedElements.clear();
    }

    // Keep loadedImages for cache benefits
  }

  getStats() {
    return {
      queued: this.preloadQueue.length,
      loading: this.loadingImages.size,
      loaded: this.loadedImages.size,
      total: this.preloadQueue.length + this.loadingImages.size + this.loadedImages.size
    };
  }
}

export const imagePreloader = new ImagePreloader();