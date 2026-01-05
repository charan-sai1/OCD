// shared-backend/core/face-embedding.ts
// Face embedding extraction and similarity comparison

import { Face, EmbeddingResult, ProcessingMode } from './types.js';

/**
 * Abstract embedding extractor interface
 */
export abstract class EmbeddingExtractor {
  abstract extractEmbeddings(
    faces: Face[],
    config: EmbeddingConfig
  ): Promise<EmbeddingResult>;

  abstract isModelLoaded(): boolean;

  abstract loadModel(): Promise<void>;

  abstract unloadModel(): Promise<void>;

  abstract getModelInfo(): { name: string; dimensions: number; accuracy: number };
}

/**
 * Configuration for embedding extraction
 */
export interface EmbeddingConfig {
  batchSize: number;
  enableCompression: boolean;
  normalizeEmbeddings: boolean;
}

/**
 * Face similarity and comparison utilities
 */
export class FaceSimilarity {
  /**
   * Calculate cosine similarity between two embedding vectors
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embedding vectors must have same length');
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    normA = Math.sqrt(normA);
    normB = Math.sqrt(normB);

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (normA * normB);
  }

  /**
   * Calculate Euclidean distance between two embedding vectors
   */
  static euclideanDistance(a: number[], b: number[]): number {
    if (a.length !== b.length) {
      throw new Error('Embedding vectors must have same length');
    }

    let sum = 0;
    for (let i = 0; i < a.length; i++) {
      const diff = a[i] - b[i];
      sum += diff * diff;
    }

    return Math.sqrt(sum);
  }

  /**
   * Check if two faces match based on similarity threshold
   */
  static areSimilar(
    embedding1: number[],
    embedding2: number[],
    threshold: number = 0.6,
    useCosine: boolean = true
  ): boolean {
    const similarity = useCosine
      ? this.cosineSimilarity(embedding1, embedding2)
      : 1 / (1 + this.euclideanDistance(embedding1, embedding2));

    return similarity >= threshold;
  }

  /**
   * Find most similar faces to a query embedding
   */
  static findSimilar(
    queryEmbedding: number[],
    candidateEmbeddings: Array<{ embedding: number[]; face: Face }>,
    threshold: number = 0.6,
    maxResults: number = 10
  ): Array<{ face: Face; similarity: number }> {
    const results = candidateEmbeddings
      .map(({ embedding, face }) => ({
        face,
        similarity: this.cosineSimilarity(queryEmbedding, embedding)
      }))
      .filter(result => result.similarity >= threshold)
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, maxResults);

    return results;
  }
}

/**
 * Embedding compression for memory efficiency
 */
export class EmbeddingCompression {
  /**
   * Compress embedding using quantization
   */
  static compress(embedding: number[], bits: number = 8): Uint8Array {
    const min = Math.min(...embedding);
    const max = Math.max(...embedding);
    const range = max - min;

    if (range === 0) {
      return new Uint8Array(embedding.length).fill(128);
    }

    const scale = (Math.pow(2, bits) - 1) / range;
    const compressed = new Uint8Array(embedding.length);

    for (let i = 0; i < embedding.length; i++) {
      const normalized = (embedding[i] - min) * scale;
      compressed[i] = Math.max(0, Math.min(Math.pow(2, bits) - 1, Math.round(normalized)));
    }

    return compressed;
  }

  /**
   * Decompress embedding back to float array
   */
  static decompress(compressed: Uint8Array, min: number, max: number): number[] {
    const range = max - min;
    const scale = range / (Math.pow(2, 8) - 1); // Assuming 8-bit compression

    const embedding: number[] = [];
    for (let i = 0; i < compressed.length; i++) {
      embedding[i] = (compressed[i] * scale) + min;
    }

    return embedding;
  }

  /**
   * Calculate min/max values for decompression
   */
  static getMinMax(embedding: number[]): { min: number; max: number } {
    return {
      min: Math.min(...embedding),
      max: Math.max(...embedding)
    };
  }
}

/**
 * Face embedding pipeline with hardware-aware processing
 */
export class FaceEmbeddingPipeline {
  private extractors: Map<ProcessingMode, EmbeddingExtractor> = new Map();
  private currentExtractor: EmbeddingExtractor | null = null;

  constructor(private capabilities: any) {}

  /**
   * Register an extractor for a specific processing mode
   */
  registerExtractor(mode: ProcessingMode, extractor: EmbeddingExtractor): void {
    this.extractors.set(mode, extractor);
  }

  /**
   * Extract embeddings from faces using the optimal extractor
   */
  async extractEmbeddings(
    faces: Face[],
    mode: ProcessingMode,
    config: Partial<EmbeddingConfig> = {}
  ): Promise<EmbeddingResult> {
    const startTime = Date.now();

    // Get extractor for this mode
    const extractor = this.extractors.get(mode);
    if (!extractor) {
      throw new Error(`No extractor registered for mode: ${mode}`);
    }

    // Ensure model is loaded
    if (!extractor.isModelLoaded()) {
      await extractor.loadModel();
    }

    // Switch extractor if needed
    if (this.currentExtractor !== extractor) {
      if (this.currentExtractor) {
        await this.currentExtractor.unloadModel();
      }
      this.currentExtractor = extractor;
    }

    // Default configuration
    const defaultConfig: EmbeddingConfig = {
      batchSize: mode === ProcessingMode.Fast ? 8 : mode === ProcessingMode.Balanced ? 4 : 2,
      enableCompression: true,
      normalizeEmbeddings: true,
      ...config
    };

    // Filter faces that don't have image data for embedding
    const facesWithData = faces.filter(face => face.embedding === undefined);

    if (facesWithData.length === 0) {
      return {
        faces,
        processingTime: Date.now() - startTime,
        modelUsed: extractor.getModelInfo().name
      };
    }

    // Extract embeddings
    const result = await extractor.extractEmbeddings(facesWithData, defaultConfig);

    // Merge embeddings back into original faces array
    const facesWithEmbeddings = faces.map(face => {
      const resultFace = result.faces.find(f => f.id === face.id);
      return resultFace || face;
    });

    const processingTime = Date.now() - startTime;

    return {
      faces: facesWithEmbeddings,
      processingTime,
      modelUsed: extractor.getModelInfo().name
    };
  }

  /**
   * Compare two faces for similarity
   */
  compareFaces(
    face1: Face,
    face2: Face,
    threshold: number = 0.6
  ): { isMatch: boolean; similarity: number } {
    if (!face1.embedding || !face2.embedding) {
      throw new Error('Both faces must have embeddings for comparison');
    }

    const similarity = FaceSimilarity.cosineSimilarity(face1.embedding, face2.embedding);
    const isMatch = similarity >= threshold;

    return { isMatch, similarity };
  }

  /**
   * Find similar faces in a collection
   */
  findSimilarFaces(
    queryFace: Face,
    candidateFaces: Face[],
    threshold: number = 0.6,
    maxResults: number = 10
  ): Array<{ face: Face; similarity: number }> {
    if (!queryFace.embedding) {
      throw new Error('Query face must have embedding');
    }

    const candidates = candidateFaces
      .filter(face => face.embedding)
      .map(face => ({ embedding: face.embedding!, face }));

    return FaceSimilarity.findSimilar(
      queryFace.embedding,
      candidates,
      threshold,
      maxResults
    );
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    for (const extractor of this.extractors.values()) {
      if (extractor.isModelLoaded()) {
        await extractor.unloadModel();
      }
    }
    this.extractors.clear();
    this.currentExtractor = null;
  }
}