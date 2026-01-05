import { DeviceCapabilities } from './deviceCapabilities';

interface ThumbnailGenerationOptions {
  quality: 'low' | 'medium' | 'high'; // 200px, 300px, 400px
  format: 'jpeg' | 'webp';
  maxConcurrent: number;
  deviceAdaptive: boolean;
}

interface ThumbnailGenerationResult {
  imagePath: string;
  success: boolean;
  thumbnailUrl?: string;
  error?: string;
}

class ThumbnailGenerationService {
  private abortController: AbortController | null = null;
  private isGenerating = false;

  async generateThumbnailsForImages(
    imagePaths: string[],
    options: ThumbnailGenerationOptions,
    onProgress?: (completed: number, total: number, currentFile?: string) => void
  ): Promise<ThumbnailGenerationResult[]> {
    if (this.isGenerating) {
      throw new Error('Thumbnail generation already in progress');
    }

    this.isGenerating = true;
    this.abortController = new AbortController();

    try {
      // Get device-adaptive settings if requested
      let effectiveOptions = options;
      if (options.deviceAdaptive) {
        const deviceProfile = DeviceCapabilities.detect();
        effectiveOptions = {
          ...options,
          maxConcurrent: deviceProfile.recommendedSettings.batchSize,
          quality: deviceProfile.recommendedSettings.quality
        };
      }

      // Determine thumbnail dimensions based on quality
      const dimensions = this.getDimensionsForQuality(effectiveOptions.quality);

      const results: ThumbnailGenerationResult[] = [];
      const batchSize = effectiveOptions.maxConcurrent;

      for (let i = 0; i < imagePaths.length; i += batchSize) {
        // Check if operation was cancelled
        if (this.abortController.signal.aborted) {
          break;
        }

        const batch = imagePaths.slice(i, Math.min(i + batchSize, imagePaths.length));
        const batchPromises = batch.map(async (imagePath) => {
          try {
            onProgress?.(i + batch.indexOf(imagePath), imagePaths.length, imagePath);

            const thumbnailUrl = await this.generateSingleThumbnail(imagePath, {
              maxWidth: dimensions,
              maxHeight: dimensions,
              quality: this.getQualityValue(effectiveOptions.quality),
              format: effectiveOptions.format
            });

            return {
              imagePath,
              success: true,
              thumbnailUrl
            } as ThumbnailGenerationResult;
          } catch (error) {
            console.warn(`Failed to generate thumbnail for ${imagePath}:`, error);
            return {
              imagePath,
              success: false,
              error: error instanceof Error ? error.message : 'Unknown error'
            } as ThumbnailGenerationResult;
          }
        });

        const batchResults = await Promise.all(batchPromises);
        results.push(...batchResults);

        // Yield control between batches to prevent UI blocking
        if (i + batchSize < imagePaths.length) {
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      }

      return results;
    } finally {
      this.isGenerating = false;
      this.abortController = null;
    }
  }

  private async generateSingleThumbnail(
    imagePath: string,
    options: { maxWidth: number; maxHeight: number; quality: number; format: 'jpeg' | 'webp' }
  ): Promise<string> {
    // Use existing PreviewGenerator logic but adapted for thumbnails
    const { invoke } = await import('@tauri-apps/api/core');

    // Read file as binary data
    const fileData: number[] = await invoke('read_binary_file', { path: imagePath });
    const uint8Array = new Uint8Array(fileData);
    const blob = new Blob([uint8Array]);

    return this.createThumbnailBlob(blob, options);
  }

  private async createThumbnailBlob(
    imageBlob: Blob,
    options: { maxWidth: number; maxHeight: number; quality: number; format: 'jpeg' | 'webp' }
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const img = new Image();

      img.onload = () => {
        try {
          // Calculate dimensions maintaining aspect ratio
          const aspectRatio = img.width / img.height;
          let { width, height } = { width: options.maxWidth, height: options.maxHeight };

          if (aspectRatio > 1) {
            // Landscape
            height = width / aspectRatio;
          } else {
            // Portrait
            width = height * aspectRatio;
          }

          // Create canvas
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;

          const ctx = canvas.getContext('2d');
          if (!ctx) {
            reject(new Error('Canvas context not available'));
            return;
          }

          // Enable image smoothing for better quality
          ctx.imageSmoothingEnabled = true;
          ctx.imageSmoothingQuality = 'high';

          // Draw resized image
          ctx.drawImage(img, 0, 0, width, height);

          // Convert to blob
          const mimeType = `image/${options.format}`;
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const url = URL.createObjectURL(blob);
                resolve(url);
              } else {
                reject(new Error('Failed to create thumbnail blob'));
              }
            },
            mimeType,
            options.quality
          );
        } catch (error) {
          reject(error);
        }
      };

      img.onerror = () => {
        reject(new Error('Failed to load image for thumbnail generation'));
      };

      // Create object URL for the image blob
      const imageUrl = URL.createObjectURL(imageBlob);
      img.src = imageUrl;

      // Clean up URL after loading
      const originalOnload = img.onload;
      img.onload = function(ev) {
        URL.revokeObjectURL(imageUrl);
        if (originalOnload) {
          originalOnload.call(this, ev);
        }
      };
    });
  }

  private getDimensionsForQuality(quality: 'low' | 'medium' | 'high'): number {
    switch (quality) {
      case 'low': return 200;
      case 'medium': return 300;
      case 'high': return 400;
      default: return 300;
    }
  }

  private getQualityValue(quality: 'low' | 'medium' | 'high'): number {
    switch (quality) {
      case 'low': return 0.6;
      case 'medium': return 0.75;
      case 'high': return 0.85;
      default: return 0.75;
    }
  }

  cancel(): void {
    this.abortController?.abort();
    this.isGenerating = false;
  }

  getStatus() {
    return { isGenerating: this.isGenerating };
  }
}

// Singleton instance
export const thumbnailGenerationService = new ThumbnailGenerationService();
export type { ThumbnailGenerationOptions, ThumbnailGenerationResult };