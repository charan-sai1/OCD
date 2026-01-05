// shared-backend/core/face-detection.ts
// Core face detection pipeline with hardware-aware model selection

import {
  Face,
  FaceBounds,
  FaceDetectionResult,
  ProcessingMode,
  DeviceCapabilities,
  FaceQuality
} from './types.js';

/**
 * Abstract face detector interface
 */
export abstract class FaceDetector {
  abstract detectFaces(
    imageData: ImageData | string,
    config: FaceDetectionConfig
  ): Promise<FaceDetectionResult>;

  abstract isModelLoaded(): boolean;

  abstract loadModel(): Promise<void>;

  abstract unloadModel(): Promise<void>;

  abstract getModelInfo(): { name: string; size: number; accuracy: number };
}

/**
 * Configuration for face detection
 */
export interface FaceDetectionConfig {
  minFaceSize: number;
  maxFaces: number;
  confidenceThreshold: number;
  enableLandmarks: boolean;
  enableQualityAssessment: boolean;
}

/**
 * Quality assessment utilities
 */
export class FaceQualityAssessor {
  /**
   * Assess face quality for recognition
   */
  static assessQuality(face: Face, imageData: ImageData): FaceQuality {
    const bounds = face.bounds;
    const faceImage = this.extractFaceImage(imageData, bounds);

    return {
      blur: this.calculateBlur(faceImage),
      brightness: this.calculateBrightness(faceImage),
      angle: this.estimatePoseAngle(face.landmarks),
      size: this.calculateRelativeSize(bounds, imageData)
    };
  }

  private static extractFaceImage(imageData: ImageData, bounds: FaceBounds): ImageData {
    // Extract face region from image data
    const { x, y, width, height } = bounds;

    // Ensure bounds are within image dimensions
    const clampedX = Math.max(0, Math.min(x, imageData.width - 1));
    const clampedY = Math.max(0, Math.min(y, imageData.height - 1));
    const clampedWidth = Math.min(width, imageData.width - clampedX);
    const clampedHeight = Math.min(height, imageData.height - clampedY);

    // Create canvas and extract region
    const faceCanvas = new OffscreenCanvas(clampedWidth, clampedHeight);
    const ctx = faceCanvas.getContext('2d')!;

    // Create source ImageData for the face region
    const faceImageData = new ImageData(clampedWidth, clampedHeight);
    const sourceData = imageData.data;
    const targetData = faceImageData.data;

    // Copy pixels from source to target
    for (let row = 0; row < clampedHeight; row++) {
      for (let col = 0; col < clampedWidth; col++) {
        const sourceIndex = ((clampedY + row) * imageData.width + (clampedX + col)) * 4;
        const targetIndex = (row * clampedWidth + col) * 4;

        targetData[targetIndex] = sourceData[sourceIndex];     // R
        targetData[targetIndex + 1] = sourceData[sourceIndex + 1]; // G
        targetData[targetIndex + 2] = sourceData[sourceIndex + 2]; // B
        targetData[targetIndex + 3] = sourceData[sourceIndex + 3]; // A
      }
    }

    return faceImageData;
  }

  private static calculateBlur(imageData: ImageData): number {
    // Proper Laplacian variance for blur detection
    const { width, height, data } = imageData;
    const laplacianKernel = [
      [0, 1, 0],
      [1, -4, 1],
      [0, 1, 0]
    ];

    let variance = 0;
    let count = 0;

    // Convert to grayscale and apply Laplacian filter
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let laplacianValue = 0;

        // Apply 3x3 Laplacian kernel
        for (let ky = -1; ky <= 1; ky++) {
          for (let kx = -1; kx <= 1; kx++) {
            const pixelIndex = ((y + ky) * width + (x + kx)) * 4;
            const gray = (data[pixelIndex] + data[pixelIndex + 1] + data[pixelIndex + 2]) / 3;
            laplacianValue += gray * laplacianKernel[ky + 1][kx + 1];
          }
        }

        variance += laplacianValue * laplacianValue;
        count++;
      }
    }

    // Normalize to 0-1 range (higher values = sharper, lower values = blurrier)
    const meanVariance = variance / count;
    return Math.max(0, Math.min(1, meanVariance / 10000)); // Scale appropriately
  }

  private static calculateBrightness(imageData: ImageData): number {
    const data = imageData.data;
    let sum = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const brightness = (r + g + b) / 3;
      sum += brightness;
    }

    return (sum / (data.length / 4)) / 255; // Normalize to 0-1
  }

  private static estimatePoseAngle(landmarks?: any): number {
    if (!landmarks) return 0;

    // Estimate pose from eye positions
    const leftEye = landmarks.leftEye;
    const rightEye = landmarks.rightEye;

    if (!leftEye || !rightEye) return 0;

    const angle = Math.atan2(rightEye.y - leftEye.y, rightEye.x - leftEye.x);
    return Math.abs(angle * 180 / Math.PI); // Convert to degrees
  }

  private static calculateRelativeSize(bounds: FaceBounds, imageData: ImageData): number {
    const faceArea = bounds.width * bounds.height;
    const imageArea = imageData.width * imageData.height;
    return faceArea / imageArea;
  }

  /**
   * Check if face quality is sufficient for recognition
   */
  static isQualitySufficient(quality: FaceQuality, mode: ProcessingMode): boolean {
    const thresholds = {
      [ProcessingMode.Fast]: { blur: 0.7, brightness: 0.8, angle: 30, size: 0.01 },
      [ProcessingMode.Balanced]: { blur: 0.5, brightness: 0.7, angle: 20, size: 0.02 },
      [ProcessingMode.HighAccuracy]: { blur: 0.3, brightness: 0.6, angle: 15, size: 0.03 }
    };

    const threshold = thresholds[mode];
    return quality.blur <= threshold.blur &&
           quality.brightness >= 0.2 && quality.brightness <= threshold.brightness &&
           quality.angle <= threshold.angle &&
           quality.size >= threshold.size;
  }
}

/**
 * Face detection pipeline with hardware-aware model selection
 */
export class FaceDetectionPipeline {
  private detectors: Map<ProcessingMode, FaceDetector> = new Map();
  private currentDetector: FaceDetector | null = null;

  constructor(private capabilities: DeviceCapabilities) {}

  /**
   * Register a detector for a specific processing mode
   */
  registerDetector(mode: ProcessingMode, detector: FaceDetector): void {
    this.detectors.set(mode, detector);
  }

  /**
   * Detect faces in an image using the optimal detector
   */
  async detectFaces(
    imageData: ImageData | string,
    mode: ProcessingMode,
    config: Partial<FaceDetectionConfig> = {}
  ): Promise<FaceDetectionResult> {
    const startTime = Date.now();

    // Get or create detector for this mode
    const detector = this.detectors.get(mode);
    if (!detector) {
      throw new Error(`No detector registered for mode: ${mode}`);
    }

    // Ensure model is loaded
    if (!detector.isModelLoaded()) {
      await detector.loadModel();
    }

    // Switch detector if needed
    if (this.currentDetector !== detector) {
      if (this.currentDetector) {
        await this.currentDetector.unloadModel();
      }
      this.currentDetector = detector;
    }

    // Default configuration
    const defaultConfig: FaceDetectionConfig = {
      minFaceSize: 40,
      maxFaces: 10,
      confidenceThreshold: 0.5,
      enableLandmarks: mode !== ProcessingMode.Fast,
      enableQualityAssessment: true,
      ...config
    };

    // Perform detection
    const result = await detector.detectFaces(imageData, defaultConfig);
    const processingTime = Date.now() - startTime;

    return {
      ...result,
      processingTime,
      modelUsed: detector.getModelInfo().name
    };
  }

  /**
   * Get available processing modes for current hardware
   */
  getAvailableModes(): ProcessingMode[] {
    return Array.from(this.detectors.keys()).filter(mode =>
      HardwareDetector.shouldProcess(this.capabilities, mode)
    );
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    for (const detector of this.detectors.values()) {
      if (detector.isModelLoaded()) {
        await detector.unloadModel();
      }
    }
    this.detectors.clear();
    this.currentDetector = null;
  }
}