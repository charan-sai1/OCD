import { systemResourceManager } from './systemResourceManager';
import { imagePreloader } from './imagePreloader';
import { imageUrlCache } from './imageUrlCache';

interface PreloadLayer {
  immediate: number;  // Next X rows (visible buffer)
  near: number;       // Next X rows (fast scroll buffer)
  far: number;        // Next X rows (aggressive buffer)
}

export class ScrollPreloader {
  private preloadLayers: PreloadLayer = {
    immediate: 2,  // Next 2 rows (visible buffer)
    near: 5,       // Next 5 rows (fast scroll buffer)
    far: 10        // Next 10 rows (aggressive buffer)
  };

  private activePreloads = new Set<string>();
  private preloadQueue: Array<{imagePath: string, priority: 'high' | 'normal' | 'low'}> = [];

  async preloadForScroll(
    currentRow: number,
    direction: 'up' | 'down',
    velocity: number,
    images: string[]
  ): Promise<void> {
    const velocityMultiplier = Math.min(velocity / 1000, 3);

    const layers: PreloadLayer = {
      immediate: Math.ceil(this.preloadLayers.immediate * (1 + velocityMultiplier)),
      near: Math.ceil(this.preloadLayers.near * (1 + velocityMultiplier * 0.5)),
      far: Math.ceil(this.preloadLayers.far * (1 + velocityMultiplier * 0.3))
    };

    // Get system-aware loading strategy
    const strategy = systemResourceManager.getAppropriateStrategy();

    // Calculate row ranges to preload based on direction
    const preloadRanges = this.calculatePreloadRanges(currentRow, direction, layers, Math.ceil(images.length / 4)); // Assuming 4 columns

    // Preload in priority order: immediate first (blocking), others async
    await this.preloadLayer(preloadRanges.immediate, 'high', strategy);
    this.preloadLayer(preloadRanges.near, 'normal', strategy);
    this.preloadLayer(preloadRanges.far, 'low', strategy);
  }

  private calculatePreloadRanges(
    currentRow: number,
    direction: 'up' | 'down',
    layers: PreloadLayer,
    totalRows: number
  ) {
    const ranges = {
      immediate: { start: 0, end: 0 },
      near: { start: 0, end: 0 },
      far: { start: 0, end: 0 }
    };

    if (direction === 'down') {
      ranges.immediate = {
        start: currentRow + 1,
        end: Math.min(currentRow + layers.immediate + 1, totalRows)
      };
      ranges.near = {
        start: ranges.immediate.end,
        end: Math.min(ranges.immediate.end + layers.near, totalRows)
      };
      ranges.far = {
        start: ranges.near.end,
        end: Math.min(ranges.near.end + layers.far, totalRows)
      };
    } else {
      ranges.immediate = {
        start: Math.max(0, currentRow - layers.immediate),
        end: currentRow
      };
      ranges.near = {
        start: Math.max(0, ranges.immediate.start - layers.near),
        end: ranges.immediate.start
      };
      ranges.far = {
        start: Math.max(0, ranges.near.start - layers.far),
        end: ranges.near.start
      };
    }

    return ranges;
  }

  private async preloadLayer(
    range: { start: number; end: number },
    priority: 'high' | 'normal' | 'low',
    strategy: any
  ): Promise<void> {
    if (range.start >= range.end) return;

    // Convert row range to image indices
    const imageIndices: number[] = [];
    for (let row = range.start; row < range.end; row++) {
      for (let col = 0; col < 4; col++) { // Assuming 4 columns
        const index = row * 4 + col;
        imageIndices.push(index);
      }
    }

    // Filter out already preloading or loaded images
    const imagesToPreload = imageIndices
      .filter(index => !this.activePreloads.has(`image_${index}`))
      .map(index => `image_${index}`);

    if (imagesToPreload.length === 0) return;

    // Respect system resource limits
    const maxToPreload = Math.min(
      imagesToPreload.length,
      strategy.maxConcurrentLoads || 3
    );

    const batchToPreload = imagesToPreload.slice(0, maxToPreload);

    // Mark as active
    batchToPreload.forEach(imagePath => this.activePreloads.add(imagePath));

    try {
      // Preload URLs first
      await imageUrlCache.preloadUrls(batchToPreload);

      // Then preload images
      const imageUrls = batchToPreload.map(path => imageUrlCache.getCachedUrl(path));
      imagePreloader.preloadWithPriority(imageUrls, priority === 'low' ? 'normal' : priority);

    } catch (error) {
      console.warn('Preloading failed:', error);
    } finally {
      // Clean up active preloads
      batchToPreload.forEach(imagePath => this.activePreloads.delete(imagePath));
    }
  }

  cancelAllPreloads(): void {
    this.activePreloads.clear();
    this.preloadQueue = [];
  }

  getStats() {
    return {
      activePreloads: this.activePreloads.size,
      queuedPreloads: this.preloadQueue.length
    };
  }
}

export const scrollPreloader = new ScrollPreloader();