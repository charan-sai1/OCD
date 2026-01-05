// shared-backend/core/onnx-inference.ts
// ONNX Runtime inference utilities for cross-platform ML

import { InferenceSession, Tensor } from 'onnxruntime-web';

export interface ModelConfig {
  modelPath: string;
  inputShape: number[];
  outputNames: string[];
  inputName: string;
}

/**
 * ONNX model wrapper with cross-platform support
 */
export class ONNXModel {
  private session: InferenceSession | null = null;
  private config: ModelConfig;

  constructor(config: ModelConfig) {
    this.config = config;
  }

  /**
   * Load the ONNX model
   */
  async load(): Promise<void> {
    if (this.session) return;

    try {
      // Load model from the specified path
      const modelPath = this.config.modelPath;
      let modelBuffer: ArrayBuffer;

      // In a real implementation, this would load from the file system
      // For now, we'll try to fetch but handle failures gracefully
      if (typeof fetch !== 'undefined') {
        // Web environment
        const response = await fetch(modelPath);

        if (!response.ok) {
          throw new Error(`Model not found at ${modelPath} (${response.status})`);
        }

        const contentLength = response.headers.get('content-length');
        if (contentLength && parseInt(contentLength) === 0) {
          throw new Error(`Model file is empty at ${modelPath}`);
        }

        modelBuffer = await response.arrayBuffer();

        if (modelBuffer.byteLength === 0) {
          throw new Error(`Failed to load model data from ${modelPath}`);
        }
      } else {
        // Node.js environment (would need fs access)
        throw new Error('Model loading requires web environment with fetch API');
      }

      this.session = await InferenceSession.create(modelBuffer);
    } catch (error) {
      console.error(`Failed to load ONNX model from ${this.config.modelPath}:`, error);
      throw new Error(`Model loading failed: ${error}`);
    }

  }

      this.session = await InferenceSession.create(modelBuffer);
    } catch (error) {
      console.error('Failed to load ONNX model:', error);
      throw error;
    }
  }

  /**
   * Run inference on input data
   */
  async run(inputData: number[] | Float32Array): Promise<Map<string, Tensor>> {
    if (!this.session) {
      throw new Error('Model not loaded. Call load() first.');
    }

    try {
      // Create input tensor
      const inputTensor = new Tensor('float32', inputData, this.config.inputShape);

      // Prepare inputs
      const feeds: Record<string, Tensor> = {};
      feeds[this.config.inputName] = inputTensor;

      // Run inference
      const results = await this.session.run(feeds);

      return results;
    } catch (error) {
      console.error('Inference failed:', error);
      throw error;
    }
  }

  /**
   * Unload the model to free memory
   */
  async unload(): Promise<void> {
    if (this.session) {
      // ONNX Runtime Web doesn't have explicit unload, but we can clear reference
      this.session = null;
    }
  }

  /**
   * Check if model is loaded
   */
  isLoaded(): boolean {
    return this.session !== null;
  }
}

/**
 * Image preprocessing utilities for face detection
 */
export class ImagePreprocessor {
  /**
   * Convert ImageData to tensor format expected by models
   */
  static preprocessImage(
    imageData: ImageData,
    targetSize: [number, number],
    normalize: boolean = true
  ): Float32Array {
    const { width, height, data } = imageData;
    const [targetWidth, targetHeight] = targetSize;

    // Simple resize (in production, use proper bilinear interpolation)
    const resizedData = this.resizeImage(data, width, height, targetWidth, targetHeight);

    // Convert to RGB and normalize
    const tensorData = new Float32Array(targetWidth * targetHeight * 3);

    for (let i = 0; i < resizedData.length; i += 4) {
      const pixelIndex = i / 4;
      const tensorIndex = pixelIndex * 3;

      // RGBA to RGB
      tensorData[tensorIndex] = resizedData[i] / 255.0;         // R
      tensorData[tensorIndex + 1] = resizedData[i + 1] / 255.0; // G
      tensorData[tensorIndex + 2] = resizedData[i + 2] / 255.0; // B
    }

    // Normalize to [-1, 1] if requested
    if (normalize) {
      for (let i = 0; i < tensorData.length; i++) {
        tensorData[i] = (tensorData[i] - 0.5) * 2.0;
      }
    }

    return tensorData;
  }

  /**
   * Simple image resizing (bilinear interpolation)
   */
  private static resizeImage(
    data: Uint8ClampedArray,
    srcWidth: number,
    srcHeight: number,
    dstWidth: number,
    dstHeight: number
  ): Uint8ClampedArray {
    const resized = new Uint8ClampedArray(dstWidth * dstHeight * 4);

    for (let y = 0; y < dstHeight; y++) {
      for (let x = 0; x < dstWidth; x++) {
        // Bilinear interpolation
        const srcX = (x / dstWidth) * srcWidth;
        const srcY = (y / dstHeight) * srcHeight;

        const x1 = Math.floor(srcX);
        const y1 = Math.floor(srcY);
        const x2 = Math.min(x1 + 1, srcWidth - 1);
        const y2 = Math.min(y1 + 1, srcHeight - 1);

        const wx = srcX - x1;
        const wy = srcY - y1;

        const idx11 = (y1 * srcWidth + x1) * 4;
        const idx12 = (y1 * srcWidth + x2) * 4;
        const idx21 = (y2 * srcWidth + x1) * 4;
        const idx22 = (y2 * srcWidth + x2) * 4;

        const dstIdx = (y * dstWidth + x) * 4;

        for (let c = 0; c < 4; c++) {
          const val11 = data[idx11 + c];
          const val12 = data[idx12 + c];
          const val21 = data[idx21 + c];
          const val22 = data[idx22 + c];

          const val = val11 * (1 - wx) * (1 - wy) +
                     val12 * wx * (1 - wy) +
                     val21 * (1 - wx) * wy +
                     val22 * wx * wy;

          resized[dstIdx + c] = Math.round(val);
        }
      }
    }

    return resized;
  }

  /**
   * Extract face crops from image using bounding boxes
   */
  static extractFaceCrops(
    imageData: ImageData,
    boundingBoxes: Array<{ x: number; y: number; width: number; height: number }>,
    cropSize: [number, number] = [112, 112]
  ): ImageData[] {
    const crops: ImageData[] = [];

    for (const box of boundingBoxes) {
      const crop = this.extractCrop(imageData, box, cropSize);
      crops.push(crop);
    }

    return crops;
  }

  private static extractCrop(
    imageData: ImageData,
    box: { x: number; y: number; width: number; height: number },
    cropSize: [number, number]
  ): ImageData {
    const canvas = new OffscreenCanvas(cropSize[0], cropSize[1]);
    const ctx = canvas.getContext('2d')!;

    // Draw the crop region
    ctx.drawImage(
      imageData as any,
      box.x, box.y, box.width, box.height,
      0, 0, cropSize[0], cropSize[1]
    );

    return ctx.getImageData(0, 0, cropSize[0], cropSize[1]);
  }
}