// shared-backend/platforms/tauri/embedding-extractors.ts
// Tauri-specific embedding extractor implementations

import { EmbeddingExtractor, EmbeddingResult, EmbeddingConfig } from '../../core/face-embedding.js';
import { Face, ProcessingMode } from '../../core/types.js';
import { ONNXModel, ImagePreprocessor } from '../../core/onnx-inference.js';

/**
 * ArcFace embedding extractor for high accuracy
 */
export class ArcFaceEmbeddingExtractor extends EmbeddingExtractor {
  private model: ONNXModel | null = null;

  constructor() {
    super();
    this.model = new ONNXModel({
      modelPath: '/models/face-embedding/arcface.onnx',
      inputShape: [1, 3, 112, 112], // Standard ArcFace input
      outputNames: ['embedding'],
      inputName: 'input'
    });
  }

  async extractEmbeddings(
    faces: Face[],
    config: EmbeddingConfig
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();

    if (!this.model?.isLoaded()) {
      await this.loadModel();
    }

    // Process faces in batches
    const batchSize = config.batchSize;
    const results: Face[] = [];

    for (let i = 0; i < faces.length; i += batchSize) {
      const batch = faces.slice(i, i + batchSize);

      // Extract face crops (assuming faces have image data)
      const faceCrops = this.extractFaceCrops(batch);

      // Create batch tensor
      const batchTensor = this.createBatchTensor(faceCrops);

      // Run inference
      const inferenceResults = await this.model.run(batchTensor);

      // Extract embeddings from results
      const embeddings = this.extractEmbeddingsFromOutput(inferenceResults, batch.length);

      // Assign embeddings to faces
      for (let j = 0; j < batch.length; j++) {
        const face = batch[j];
        let embedding = embeddings[j];

        // Normalize if requested
        if (config.normalizeEmbeddings) {
          embedding = this.normalizeEmbedding(embedding);
        }

        results.push({
          ...face,
          embedding
        });
      }

      // Small delay between batches to prevent blocking
      await new Promise(resolve => setTimeout(resolve, 1));
    }

    return {
      faces: results,
      processingTime: Date.now() - startTime,
      modelUsed: 'ArcFaceEmbeddingExtractor'
    };
  }

  private extractFaceCrops(faces: Face[]): ImageData[] {
    // In a real implementation, this would extract crops from the original image
    // using the face bounding boxes. For now, create mock crops.
    return faces.map(() => {
      // Create a mock 112x112 RGB image
      const canvas = new OffscreenCanvas(112, 112);
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(112, 112);

      // Fill with random colors (simulating face image)
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = Math.random() * 255;     // R
        imageData.data[i + 1] = Math.random() * 255; // G
        imageData.data[i + 2] = Math.random() * 255; // B
        imageData.data[i + 3] = 255;                 // A
      }

      return imageData;
    });
  }

  private createBatchTensor(faceCrops: ImageData[]): Float32Array {
    const numFaces = faceCrops.length;
    const tensorData = new Float32Array(numFaces * 3 * 112 * 112);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const crop = faceCrops[faceIdx];
      const processed = ImagePreprocessor.preprocessImage(crop, [112, 112], true);

      // Copy to batch tensor
      for (let i = 0; i < processed.length; i++) {
        tensorData[faceIdx * processed.length + i] = processed[i];
      }
    }

    return tensorData;
  }

  private extractEmbeddingsFromOutput(
    results: Map<string, any>,
    batchSize: number
  ): number[][] {
    const embeddingOutput = results.get('embedding');
    if (!embeddingOutput) {
      throw new Error('No embedding output from model');
    }

    const outputData = embeddingOutput.data as Float32Array;
    const embeddingSize = 512; // ArcFace typically outputs 512D embeddings
    const embeddings: number[][] = [];

    for (let i = 0; i < batchSize; i++) {
      const startIdx = i * embeddingSize;
      const endIdx = startIdx + embeddingSize;
      embeddings.push(Array.from(outputData.slice(startIdx, endIdx)));
    }

    return embeddings;
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }

  isModelLoaded(): boolean {
    return this.model?.isLoaded() ?? false;
  }

  async loadModel(): Promise<void> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    await this.model.load();
  }

  async unloadModel(): Promise<void> {
    if (this.model) {
      await this.model.unload();
    }
  }

  getModelInfo(): { name: string; dimensions: number; accuracy: number } {
    return {
      name: 'ArcFaceEmbeddingExtractor',
      dimensions: 512,
      accuracy: 0.95
    };
  }
}

/**
 * FaceNet embedding extractor for balanced performance
 */
export class FaceNetEmbeddingExtractor extends EmbeddingExtractor {
  private model: ONNXModel | null = null;

  constructor() {
    super();
    this.model = new ONNXModel({
      modelPath: '/models/face-embedding/facenet.onnx',
      inputShape: [1, 3, 160, 160], // FaceNet input size
      outputNames: ['embeddings'],
      inputName: 'input'
    });
  }

  async extractEmbeddings(
    faces: Face[],
    config: EmbeddingConfig
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();

    if (!this.model?.isLoaded()) {
      await this.loadModel();
    }

    const batchSize = config.batchSize;
    const results: Face[] = [];

    for (let i = 0; i < faces.length; i += batchSize) {
      const batch = faces.slice(i, i + batchSize);
      const faceCrops = this.extractFaceCrops(batch);
      const batchTensor = this.createBatchTensor(faceCrops, [160, 160]);

      // Run inference
      const inferenceResults = await this.model.run(batchTensor);
      const embeddings = this.extractEmbeddingsFromOutput(inferenceResults, batch.length, 128);

      // Assign embeddings to faces
      for (let j = 0; j < batch.length; j++) {
        const face = batch[j];
        let embedding = embeddings[j];

        if (config.normalizeEmbeddings) {
          embedding = this.normalizeEmbedding(embedding);
        }

        results.push({
          ...face,
          embedding
        });
      }
    }

    return {
      faces: results,
      processingTime: Date.now() - startTime,
      modelUsed: 'FaceNetEmbeddingExtractor'
    };
  }

  private extractFaceCrops(faces: Face[]): ImageData[] {
    // Mock face crop extraction - in real implementation would use face bounds
    return faces.map(() => {
      const canvas = new OffscreenCanvas(160, 160);
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(160, 160);

      // Fill with mock face-like colors
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = 200 + Math.random() * 55;     // Skin tone R
        imageData.data[i + 1] = 150 + Math.random() * 50; // Skin tone G
        imageData.data[i + 2] = 100 + Math.random() * 50; // Skin tone B
        imageData.data[i + 3] = 255;
      }

      return imageData;
    });
  }

  private createBatchTensor(faceCrops: ImageData[], targetSize: [number, number]): Float32Array {
    const numFaces = faceCrops.length;
    const tensorData = new Float32Array(numFaces * 3 * targetSize[0] * targetSize[1]);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const crop = faceCrops[faceIdx];
      const processed = ImagePreprocessor.preprocessImage(crop, targetSize, true);

      for (let i = 0; i < processed.length; i++) {
        tensorData[faceIdx * processed.length + i] = processed[i];
      }
    }

    return tensorData;
  }

  private extractEmbeddingsFromOutput(
    results: Map<string, any>,
    batchSize: number,
    embeddingSize: number
  ): number[][] {
    const embeddingOutput = results.get('embeddings');
    if (!embeddingOutput) {
      throw new Error('No embedding output from model');
    }

    const outputData = embeddingOutput.data as Float32Array;
    const embeddings: number[][] = [];

    for (let i = 0; i < batchSize; i++) {
      const startIdx = i * embeddingSize;
      const endIdx = startIdx + embeddingSize;
      embeddings.push(Array.from(outputData.slice(startIdx, endIdx)));
    }

    return embeddings;
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }

  isModelLoaded(): boolean {
    return this.model?.isLoaded() ?? false;
  }

  async loadModel(): Promise<void> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    await this.model.load();
  }

  async unloadModel(): Promise<void> {
    if (this.model) {
      await this.model.unload();
    }
  }

  getModelInfo(): { name: string; dimensions: number; accuracy: number } {
    return {
      name: 'FaceNetEmbeddingExtractor',
      dimensions: 128,
      accuracy: 0.85
    };
  }
}

/**
 * Lightweight MobileFaceNet extractor for fast mode
 */
export class MobileFaceNetEmbeddingExtractor extends EmbeddingExtractor {
  private model: ONNXModel | null = null;

  constructor() {
    super();
    this.model = new ONNXModel({
      modelPath: '/models/face-embedding/mobilefacenet.onnx',
      inputShape: [1, 3, 112, 112],
      outputNames: ['output'],
      inputName: 'input'
    });
  }

  async extractEmbeddings(
    faces: Face[],
    config: EmbeddingConfig
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();

    if (!this.model?.isLoaded()) {
      await this.loadModel();
    }

    const batchSize = config.batchSize;
    const results: Face[] = [];

    for (let i = 0; i < faces.length; i += batchSize) {
      const batch = faces.slice(i, i + batchSize);
      const faceCrops = this.extractFaceCrops(batch);
      const batchTensor = this.createBatchTensor(faceCrops);

      const inferenceResults = await this.model.run(batchTensor);
      const embeddings = this.extractEmbeddingsFromOutput(inferenceResults, batch.length, 128);

      for (let j = 0; j < batch.length; j++) {
        const face = batch[j];
        let embedding = embeddings[j];

        if (config.normalizeEmbeddings) {
          embedding = this.normalizeEmbedding(embedding);
        }

        results.push({
          ...face,
          embedding
        });
      }
    }

    return {
      faces: results,
      processingTime: Date.now() - startTime,
      modelUsed: 'MobileFaceNetEmbeddingExtractor'
    };
  }

  private extractFaceCrops(faces: Face[]): ImageData[] {
    return faces.map(() => {
      const canvas = new OffscreenCanvas(112, 112);
      const ctx = canvas.getContext('2d')!;
      const imageData = ctx.createImageData(112, 112);

      // Mock face data
      for (let i = 0; i < imageData.data.length; i += 4) {
        imageData.data[i] = Math.random() * 255;
        imageData.data[i + 1] = Math.random() * 255;
        imageData.data[i + 2] = Math.random() * 255;
        imageData.data[i + 3] = 255;
      }

      return imageData;
    });
  }

  private createBatchTensor(faceCrops: ImageData[]): Float32Array {
    const numFaces = faceCrops.length;
    const tensorData = new Float32Array(numFaces * 3 * 112 * 112);

    for (let faceIdx = 0; faceIdx < numFaces; faceIdx++) {
      const crop = faceCrops[faceIdx];
      const processed = ImagePreprocessor.preprocessImage(crop, [112, 112], true);

      for (let i = 0; i < processed.length; i++) {
        tensorData[faceIdx * processed.length + i] = processed[i];
      }
    }

    return tensorData;
  }

  private extractEmbeddingsFromOutput(
    results: Map<string, any>,
    batchSize: number,
    embeddingSize: number
  ): number[][] {
    const embeddingOutput = results.get('output');
    if (!embeddingOutput) {
      throw new Error('No embedding output from model');
    }

    const outputData = embeddingOutput.data as Float32Array;
    const embeddings: number[][] = [];

    for (let i = 0; i < batchSize; i++) {
      const startIdx = i * embeddingSize;
      const endIdx = startIdx + embeddingSize;
      embeddings.push(Array.from(outputData.slice(startIdx, endIdx)));
    }

    return embeddings;
  }

  private normalizeEmbedding(embedding: number[]): number[] {
    const norm = Math.sqrt(embedding.reduce((sum, val) => sum + val * val, 0));
    return embedding.map(val => val / norm);
  }

  isModelLoaded(): boolean {
    return this.model?.isLoaded() ?? false;
  }

  async loadModel(): Promise<void> {
    if (!this.model) {
      throw new Error('Model not initialized');
    }
    await this.model.load();
  }

  async unloadModel(): Promise<void> {
    if (this.model) {
      await this.model.unload();
    }
  }

  getModelInfo(): { name: string; dimensions: number; accuracy: number } {
    return {
      name: 'MobileFaceNetEmbeddingExtractor',
      dimensions: 128,
      accuracy: 0.75
    };
  }
}