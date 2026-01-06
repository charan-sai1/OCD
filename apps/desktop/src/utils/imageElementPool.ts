import { DeviceCapabilities } from './deviceCapabilities';

export class ImageElementPool {
  private available: HTMLImageElement[] = [];
  private inUse = new Map<string, HTMLImageElement>();
  private maxPoolSize: number;

  constructor(deviceProfile?: any) {
    const profile = deviceProfile || DeviceCapabilities.detect();
    this.maxPoolSize = profile.memoryGB < 4 ? 50 :
                      profile.memoryGB < 8 ? 150 : 300;
  }

  getImageElement(imagePath: string): HTMLImageElement {
    let element = this.available.pop();

    if (!element) {
      element = document.createElement('img');
      element.loading = 'lazy';
      element.decoding = 'async';
      element.style.imageRendering = 'high-quality';
    }

    // Reset element state
    element.src = '';
    element.style.opacity = '0';
    element.style.transform = 'scale(1)';
    element.dataset.imagePath = imagePath;

    this.inUse.set(imagePath, element);
    return element;
  }

  releaseImageElement(imagePath: string): void {
    const element = this.inUse.get(imagePath);
    if (!element) return;

    // Clean up element
    element.src = '';
    element.style.opacity = '0';
    element.style.transform = 'scale(0.95)'; // Slight scale down for visual feedback

    // Reset event listeners
    element.onload = null;
    element.onerror = null;

    this.inUse.delete(imagePath);

    // Return to pool if not full
    if (this.available.length < this.maxPoolSize) {
      this.available.push(element);
    } else {
      // Pool is full, remove element from DOM if it's attached
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }
  }

  getElementForPath(imagePath: string): HTMLImageElement | null {
    return this.inUse.get(imagePath) || null;
  }

  preloadElement(imagePath: string, url: string): HTMLImageElement {
    const element = this.getImageElement(imagePath);
    element.src = url;
    return element;
  }

  // Emergency cleanup when memory pressure is high
  emergencyCleanup(retainCount: number = 10): void {
    // Release all elements except the most recent ones
    const pathsToKeep = Array.from(this.inUse.keys()).slice(-retainCount);

    for (const path of this.inUse.keys()) {
      if (!pathsToKeep.includes(path)) {
        this.releaseImageElement(path);
      }
    }

    // Also trim the available pool
    if (this.available.length > retainCount) {
      this.available = this.available.slice(-retainCount);
    }
  }

  getStats() {
    return {
      available: this.available.length,
      inUse: this.inUse.size,
      maxPoolSize: this.maxPoolSize,
      poolEfficiency: this.available.length / (this.available.length + this.inUse.size)
    };
  }

  destroy(): void {
    // Clean up all elements
    this.available.forEach(element => {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    });

    for (const element of this.inUse.values()) {
      if (element.parentNode) {
        element.parentNode.removeChild(element);
      }
    }

    this.available = [];
    this.inUse.clear();
  }
}

export const imageElementPool = new ImageElementPool();