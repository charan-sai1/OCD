import { convertFileSrc } from "@tauri-apps/api/core";

export class ImageUrlCache {
  private urlCache = new Map<string, string>();

  async preloadUrls(imagePaths: string[]): Promise<void> {
    const batches = this.chunkArray(imagePaths, 100);

    for (const batch of batches) {
      const urlPromises = batch.map(async (path) => {
        const url = convertFileSrc(path);
        return { path, url };
      });

      const results = await Promise.all(urlPromises);
      results.forEach(({ path, url }) => this.urlCache.set(path, url));

      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }
  }

  getCachedUrl(imagePath: string): string {
    let url = this.urlCache.get(imagePath);
    if (!url) {
      url = convertFileSrc(imagePath);
      this.urlCache.set(imagePath, url);
    }
    return url;
  }

  hasUrl(imagePath: string): boolean {
    return this.urlCache.has(imagePath);
  }

  clear(): void {
    this.urlCache.clear();
  }

  getStats() {
    return {
      cachedUrls: this.urlCache.size,
      memoryUsage: this.urlCache.size * 200 // Rough estimate: 200 bytes per URL
    };
  }

  private chunkArray<T>(array: T[], chunkSize: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += chunkSize) {
      chunks.push(array.slice(i, i + chunkSize));
    }
    return chunks;
  }
}

export const imageUrlCache = new ImageUrlCache();