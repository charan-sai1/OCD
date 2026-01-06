// Client-side preview generation using Canvas API
// Much faster than backend processing, better memory efficiency

export interface PreviewOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'webp';
}

export class PreviewGenerator {
  private static readonly DEFAULT_OPTIONS: Required<PreviewOptions> = {
    maxWidth: 300,
    maxHeight: 300,
    quality: 0.7,
    format: 'jpeg'
  };

  /**
   * Generate a preview image from a file path
   * Uses createImageBitmap for hardware-accelerated resizing
   */
  static async generatePreview(
    imagePath: string,
    options: PreviewOptions = {}
  ): Promise<string> {
    const opts: Required<PreviewOptions> = {
      maxWidth: options.maxWidth ?? this.DEFAULT_OPTIONS.maxWidth,
      maxHeight: options.maxHeight ?? this.DEFAULT_OPTIONS.maxHeight,
      quality: options.quality ?? this.DEFAULT_OPTIONS.quality,
      format: options.format ?? this.DEFAULT_OPTIONS.format,
    };

    try {
      // Read the file directly using Tauri's filesystem API
      const { invoke } = await import('@tauri-apps/api/core');

      console.log(`PreviewGenerator: Reading file directly: ${imagePath}`);

      // Use Tauri's readBinaryFile command to read the file as bytes
      const fileData: number[] = await invoke('read_binary_file', { path: imagePath });
      const uint8Array = new Uint8Array(fileData);
      const blob = new Blob([uint8Array], { type: 'image/jpeg' }); // Assume JPEG, will be determined by browser

      console.log(`PreviewGenerator: Successfully read file of size ${blob.size} for ${imagePath}`);

      // Generate preview using Canvas API
      const previewBlob = await this.createPreviewBlob(blob, opts);

      // Create object URL (much more memory efficient than base64)
      const previewUrl = URL.createObjectURL(previewBlob);

      return previewUrl;
    } catch (error) {
      console.error('Preview generation failed:', error);
      throw error;
    }
  }

  /**
   * Create a resized preview blob using Canvas API
   */
  private static async createPreviewBlob(
    imageBlob: Blob,
    options: Required<PreviewOptions>
  ): Promise<Blob> {
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
                resolve(blob);
              } else {
                reject(new Error('Failed to create blob'));
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
        reject(new Error('Failed to load image for preview generation'));
      };

      // Create object URL for the image blob
      const imageUrl = URL.createObjectURL(imageBlob);
      img.src = imageUrl;

      // Store original onload and clean up URL when image loads
      const originalOnload = img.onload;
      img.onload = function(ev) {
        URL.revokeObjectURL(imageUrl);
        if (originalOnload) {
          originalOnload.call(this, ev);
        }
      };
    });
  }

  /**
   * Generate previews for multiple images in batches
   * Prevents UI blocking and manages memory usage
   */
  static async generatePreviewsBatch(
    imagePaths: string[],
    options: PreviewOptions = {},
    onProgress?: (completed: number, total: number) => void
  ): Promise<Map<string, string>> {
    const results = new Map<string, string>();
    const batchSize = 3; // Process 3 images at a time to prevent blocking

    for (let i = 0; i < imagePaths.length; i += batchSize) {
      const batch = imagePaths.slice(i, i + batchSize);

      const batchPromises = batch.map(async (imagePath) => {
        try {
          const previewUrl = await this.generatePreview(imagePath, options);
          return { imagePath, previewUrl, success: true };
        } catch (error) {
          console.warn(`Failed to generate preview for ${imagePath}:`, error);
          return { imagePath, previewUrl: null, success: false };
        }
      });

      const batchResults = await Promise.all(batchPromises);

      batchResults.forEach(({ imagePath, previewUrl, success }) => {
        if (success && previewUrl) {
          results.set(imagePath, previewUrl);
        }
      });

      onProgress?.(Math.min(i + batchSize, imagePaths.length), imagePaths.length);

      // Yield control to prevent blocking the main thread
      if (i + batchSize < imagePaths.length) {
        await new Promise(resolve => setTimeout(resolve, 10));
      }
    }

    return results;
  }

  /**
   * Utility function to clean up object URLs
   */
  static cleanupPreviewUrl(url: string): void {
    if (url && url.startsWith('blob:')) {
      URL.revokeObjectURL(url);
    }
  }
}

// Convenience function for single preview generation
export const generateImagePreview = PreviewGenerator.generatePreview.bind(PreviewGenerator);
export const generateImagePreviewsBatch = PreviewGenerator.generatePreviewsBatch.bind(PreviewGenerator);
export const cleanupPreviewUrl = PreviewGenerator.cleanupPreviewUrl.bind(PreviewGenerator);