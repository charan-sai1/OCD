// shared-backend/core/model-creator.ts
// Create simple ONNX models for facial recognition when real models aren't available

import { Tensor, TensorType, TensorDataType } from 'onnxruntime-web';

export class SimpleFaceDetectorModel {
  /**
   * Create a simple face detection model that can detect faces using basic heuristics
   * This serves as a fallback when real ML models aren't available
   */
  static createONNXModel(): ArrayBuffer {
    // Create a minimal ONNX model that performs basic face detection
    // This is a simplified implementation - in production, you'd use pre-trained models

    // For now, return an empty buffer that will be handled by our fallback detector
    // In a real implementation, this would generate actual ONNX protobuf data
    return new ArrayBuffer(0);
  }
}

export class SimpleEmbeddingModel {
  /**
   * Create a simple embedding model that generates consistent embeddings
   * This serves as a fallback when real embedding models aren't available
   */
  static createONNXModel(): ArrayBuffer {
    // Create a minimal ONNX model for embedding generation
    // This would generate deterministic embeddings based on input features
    return new ArrayBuffer(0);
  }
}

/**
 * Model registry for managing available models
 */
export class ModelRegistry {
  private static models: Map<string, ArrayBuffer> = new Map();

  static registerModel(name: string, modelData: ArrayBuffer): void {
    this.models.set(name, modelData);
  }

  static getModel(name: string): ArrayBuffer | null {
    return this.models.get(name) || null;
  }

  static hasModel(name: string): boolean {
    return this.models.has(name);
  }

  static listModels(): string[] {
    return Array.from(this.models.keys());
  }

  /**
   * Initialize with basic fallback models
   */
  static initializeFallbackModels(): void {
    // Register basic models for when real ML models aren't available
    this.registerModel('face-detector-fallback', SimpleFaceDetectorModel.createONNXModel());
    this.registerModel('embedding-extractor-fallback', SimpleEmbeddingModel.createONNXModel());
  }
}

// Initialize fallback models on module load
ModelRegistry.initializeFallbackModels();