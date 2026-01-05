// Thumbnail generation web worker
import { expose } from 'comlink';

interface ThumbnailRequest {
  imagePath: string;
  size: number;
}

interface ThumbnailResult {
  imagePath: string;
  thumbnail?: string;
  error?: string;
}

class ThumbnailGenerator {
  private canvas: OffscreenCanvas | null = null;
  private ctx: OffscreenCanvasRenderingContext2D | null = null;

  constructor() {
    // Initialize offscreen canvas for image processing
    if (typeof OffscreenCanvas !== 'undefined') {
      this.canvas = new OffscreenCanvas(1, 1);
      this.ctx = this.canvas.getContext('2d');
    }
  }

  async generateThumbnails(requests: ThumbnailRequest[]): Promise<ThumbnailResult[]> {
    const results: ThumbnailResult[] = [];

    // Process thumbnails in batches to avoid overwhelming the worker
    const batchSize = 3;
    for (let i = 0; i < requests.length; i += batchSize) {
      const batch = requests.slice(i, i + batchSize);
      const batchResults = await Promise.all(
        batch.map(request => this.generateThumbnail(request))
      );
      results.push(...batchResults);

      // Yield control to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    return results;
  }

  private async generateThumbnail(request: ThumbnailRequest): Promise<ThumbnailResult> {
    try {
      // Use Tauri invoke to generate thumbnail on backend
      const { invoke } = await import('@tauri-apps/api/core');

      const thumbnail: string = await invoke("generate_thumbnail", {
        imagePath: request.imagePath,
        size: request.size,
      });

      return {
        imagePath: request.imagePath,
        thumbnail,
      };
    } catch (error) {
      return {
        imagePath: request.imagePath,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  // Alternative client-side thumbnail generation using canvas
  async generateThumbnailCanvas(imagePath: string, size: number): Promise<string> {
    return new Promise((resolve, reject) => {
      if (!this.canvas || !this.ctx) {
        reject(new Error('OffscreenCanvas not supported'));
        return;
      }

      const img = new Image();
      img.crossOrigin = 'anonymous';

      img.onload = () => {
        // Calculate dimensions maintaining aspect ratio
        const aspectRatio = img.width / img.height;
        let { width, height } = { width: size, height: size };

        if (aspectRatio > 1) {
          height = width / aspectRatio;
        } else {
          width = height * aspectRatio;
        }

        this.canvas!.width = size;
        this.canvas!.height = size;

        // Clear canvas
        this.ctx!.clearRect(0, 0, size, size);

        // Center the image
        const x = (size - width) / 2;
        const y = (size - height) / 2;

        this.ctx!.drawImage(img, x, y, width, height);

        // Convert to base64
        this.canvas!.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
          .then(blob => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = () => reject(new Error('Failed to read canvas blob'));
            reader.readAsDataURL(blob);
          })
          .catch(reject);
      };

      img.onerror = () => reject(new Error('Failed to load image'));
      img.src = `asset://${imagePath}`;
    });
  }
}

expose(ThumbnailGenerator);