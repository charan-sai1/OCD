// shared-backend/core/api.ts
// Main API interface for facial recognition functionality

import {
  Face,
  FaceDetectionResult,
  EmbeddingResult,
  PersonGroup,
  ProcessingStatus,
  DeviceCapabilities,
  ProcessingMode,
  ProcessingQueueItem,
  FaceRecognitionConfig
} from './types.js';
import { HardwareDetector } from './hardware-detection.js';
import { FaceDetectionPipeline } from './face-detection.js';
import { FaceEmbeddingPipeline } from './face-embedding.js';
import { FaceClusteringPipeline } from './face-clustering.js';
import { FaceDatabase } from '../database/schema.js';

/**
 * Main facial recognition API
 */
export class FaceRecognitionAPI {
  private hardwareDetector: HardwareDetector;
  private detectionPipeline: FaceDetectionPipeline;
  private embeddingPipeline: FaceEmbeddingPipeline;
  private clusteringPipeline: FaceClusteringPipeline;
  private database: FaceDatabase;
  private config: FaceRecognitionConfig;

  constructor(
    hardwareDetector: HardwareDetector,
    detectionPipeline: FaceDetectionPipeline,
    embeddingPipeline: FaceEmbeddingPipeline,
    clusteringPipeline: FaceClusteringPipeline,
    database: FaceDatabase,
    config: Partial<FaceRecognitionConfig> = {}
  ) {
    this.hardwareDetector = hardwareDetector;
    this.detectionPipeline = detectionPipeline;
    this.embeddingPipeline = embeddingPipeline;
    this.clusteringPipeline = clusteringPipeline;
    this.database = database;

    this.config = {
      mode: ProcessingMode.Balanced,
      similarityThreshold: 0.6,
      minFaceSize: 40,
      maxFacesPerImage: 10,
      enableEmbeddingCompression: true,
      enableQualityFiltering: true,
      ...config
    };
  }

  /**
   * Initialize the API and all components
   */
  async initialize(): Promise<void> {
    await this.database.initialize();

    // Set optimal processing mode based on hardware
    const capabilities = await this.hardwareDetector.detectCapabilities();
    this.config.mode = HardwareDetector.selectProcessingMode(capabilities);
  }

  /**
   * Detect faces in an image
   */
  async detectFaces(
    imagePath: string,
    imageData?: ImageData
  ): Promise<FaceDetectionResult> {
    try {
      console.log(`Starting face detection for: ${imagePath}`);

      // Load image data if not provided
      const data = imageData || await this.loadImageData(imagePath);
      console.log(`Image loaded: ${data.width}x${data.height}`);

      // Detect faces
      const result = await this.detectionPipeline.detectFaces(
        data,
        this.config.mode,
        {
          minFaceSize: this.config.minFaceSize,
          maxFaces: this.config.maxFacesPerImage,
          confidenceThreshold: 0.5,
          enableLandmarks: true,
          enableQualityAssessment: this.config.enableQualityFiltering
        }
      );

      console.log(`Detected ${result.faces.length} faces in ${result.processingTime}ms`);

      // Store faces in database if any were found
      if (result.faces.length > 0) {
        await this.storeFaces(result.faces, imagePath);
        console.log(`Stored ${result.faces.length} faces in database`);
      }

      return result;
    } catch (error) {
      console.error(`Face detection failed for ${imagePath}:`, error);
      throw new Error(`Face detection failed: ${error}`);
    }
  }

  /**
   * Extract embeddings for faces
   */
  async extractEmbeddings(faceIds: string[]): Promise<EmbeddingResult> {
    // Load faces from database
    const faces = await this.loadFaces(faceIds);

    // Extract embeddings
    const result = await this.embeddingPipeline.extractEmbeddings(
      faces,
      this.config.mode,
      {
        enableCompression: this.config.enableEmbeddingCompression
      }
    );

    // Update faces in database
    await this.updateFaceEmbeddings(result.faces);

    return result;
  }

  /**
   * Find similar faces to a query face
   */
  async findSimilarFaces(
    queryFaceId: string,
    threshold: number = this.config.similarityThreshold,
    maxResults: number = 20
  ): Promise<Array<{ face: Face; similarity: number; imagePath: string }>> {
    // Load query face
    const queryFace = await this.database.getFace(queryFaceId);
    if (!queryFace || !queryFace.embedding) {
      throw new Error('Query face not found or has no embedding');
    }

    // Load all faces with embeddings
    const allFaces = await this.database.getFacesWithoutEmbeddings();
    const facesWithEmbeddings = allFaces.filter(face => face.embedding);

    // Convert to Face objects
    const candidateFaces = facesWithEmbeddings.map(dbFace => ({
      id: dbFace.id,
      bounds: JSON.parse(dbFace.bounds),
      confidence: dbFace.confidence,
      embedding: Array.from(dbFace.embedding) // Convert Uint8Array back to number[]
    }));

    // Find similar faces
    const similarFaces = this.embeddingPipeline.findSimilarFaces(
      { id: queryFace.id, bounds: queryFace.bounds, confidence: queryFace.confidence, embedding: Array.from(queryFace.embedding) },
      candidateFaces,
      threshold,
      maxResults
    );

    // Add image path information
    const results = await Promise.all(
      similarFaces.map(async ({ face, similarity }) => {
        const dbFace = facesWithEmbeddings.find(f => f.id === face.id)!;
        return {
          face,
          similarity,
          imagePath: dbFace.imagePath
        };
      })
    );

    return results;
  }

  /**
   * Cluster faces into people groups
   */
  async clusterFaces(algorithm: string = 'dbscan'): Promise<PersonGroup[]> {
    // Load all faces with embeddings
    const allFaces = await this.database.getFacesWithoutEmbeddings();
    const facesWithEmbeddings = allFaces.filter(face => face.embedding);

    const faces = facesWithEmbeddings.map(dbFace => ({
      id: dbFace.id,
      bounds: JSON.parse(dbFace.bounds),
      confidence: dbFace.confidence,
      embedding: Array.from(dbFace.embedding)
    }));

    // Perform clustering
    const personGroups = await this.clusteringPipeline.clusterFaces(
      faces,
      algorithm,
      {
        similarityThreshold: this.config.similarityThreshold,
        minClusterSize: 2
      }
    );

    // Store person groups in database
    await this.storePersonGroups(personGroups);

    return personGroups;
  }

  /**
   * Get all people groups
   */
  async getPeople(): Promise<PersonGroup[]> {
    const dbPeople = await this.database.getAllPeople();

    return dbPeople.map(dbPerson => ({
      id: dbPerson.id,
      name: dbPerson.name || undefined,
      faceIds: [], // Would need to query face_person_relations
      representativeFaceId: dbPerson.representativeFaceId,
      confidence: 0, // Would need to calculate
      createdAt: dbPerson.createdAt
    }));
  }

  /**
   * Update person information
   */
  async updatePerson(personId: string, name: string): Promise<void> {
    const person = await this.database.getPerson(personId);
    if (!person) {
      throw new Error('Person not found');
    }

    person.name = name;
    await this.database.updatePerson(person);
  }

  /**
   * Get processing status
   */
  async getProcessingStatus(): Promise<ProcessingStatus> {
    const pendingItems = await this.database.getPendingImages();
    const currentItem = pendingItems.find(item => item.status === 'processing');

    return {
      isProcessing: currentItem !== undefined,
      queueLength: pendingItems.length,
      currentImage: currentItem?.imagePath,
      progress: 0, // Would need to track this separately
      estimatedTimeRemaining: undefined
    };
  }

  /**
   * Get device capabilities
   */
  async getCapabilities(): Promise<DeviceCapabilities> {
    return await this.hardwareDetector.detectCapabilities();
  }

  /**
   * Set processing mode
   */
  async setProcessingMode(mode: ProcessingMode): Promise<void> {
    const capabilities = await this.getCapabilities();

    if (!HardwareDetector.shouldProcess(capabilities, mode)) {
      throw new Error(`Processing mode ${mode} not suitable for current hardware`);
    }

    this.config.mode = mode;
  }

  /**
   * Queue images for processing
   */
  async queueImagesForProcessing(imagePaths: string[]): Promise<void> {
    for (const imagePath of imagePaths) {
      await this.database.enqueueImage(imagePath);
    }
  }

  /**
   * Process next image in queue
   */
  async processNextImage(): Promise<boolean> {
    const nextItem = await this.database.dequeueNextImage();
    if (!nextItem) return false;

    try {
      await this.database.updateProcessingStatus(nextItem.imagePath, 'processing');

      // Detect faces
      const detectionResult = await this.detectFaces(nextItem.imagePath);

      // Extract embeddings if faces were found
      if (detectionResult.faces.length > 0) {
        const faceIds = detectionResult.faces.map(face => face.id);
        await this.extractEmbeddings(faceIds);
      }

      await this.database.updateProcessingStatus(nextItem.imagePath, 'completed');
      return true;
    } catch (error) {
      await this.database.updateProcessingStatus(
        nextItem.imagePath,
        'failed',
        error instanceof Error ? error.message : 'Unknown error'
      );
      return false;
    }
  }

  /**
   * Cleanup resources
   */
  async dispose(): Promise<void> {
    await this.detectionPipeline.dispose();
    await this.embeddingPipeline.dispose();
    await this.database.close();
  }

  // Private helper methods
  private async loadImageData(imagePath: string): Promise<ImageData> {
    // Platform-specific image loading implementation
    throw new Error('Image loading must be implemented by platform-specific code');
  }

  private async storeFaces(faces: Face[], imagePath: string): Promise<void> {
    const dbFaces = faces.map(face => ({
      id: face.id,
      imagePath,
      bounds: JSON.stringify(face.bounds),
      embedding: face.embedding ? new Uint8Array(face.embedding.length * 4) : new Uint8Array(0),
      embedding_min: face.embedding ? Math.min(...face.embedding) : 0,
      embedding_max: face.embedding ? Math.max(...face.embedding) : 0,
      confidence: face.confidence,
      qualityScore: face.quality ? this.calculateQualityScore(face.quality) : 0,
      landmarks: face.landmarks ? JSON.stringify(face.landmarks) : null,
      createdAt: new Date()
    }));

    await this.database.bulkInsertFaces(dbFaces);
  }

  private async loadFaces(faceIds: string[]): Promise<Face[]> {
    const dbFaces = await Promise.all(
      faceIds.map(id => this.database.getFace(id))
    );

    return dbFaces
      .filter(face => face !== null)
      .map(dbFace => ({
        id: dbFace!.id,
        bounds: JSON.parse(dbFace!.bounds),
        confidence: dbFace!.confidence,
        landmarks: dbFace!.landmarks ? JSON.parse(dbFace!.landmarks) : undefined
      }));
  }

  private async updateFaceEmbeddings(faces: Face[]): Promise<void> {
    for (const face of faces) {
      if (face.embedding) {
        const dbFace = {
          id: face.id,
          imagePath: '', // Will be updated by the database
          bounds: JSON.stringify(face.bounds),
          embedding: new Uint8Array(face.embedding.length * 4), // Placeholder
          embedding_min: Math.min(...face.embedding),
          embedding_max: Math.max(...face.embedding),
          confidence: face.confidence,
          qualityScore: face.quality ? this.calculateQualityScore(face.quality) : 0,
          landmarks: face.landmarks ? JSON.stringify(face.landmarks) : null,
          createdAt: new Date()
        };

        // Update existing face with embedding
        await this.database.insertFace(dbFace);
      }
    }
  }

  private async storePersonGroups(groups: PersonGroup[]): Promise<void> {
    for (const group of groups) {
      const dbPerson = {
        id: group.id,
        name: group.name,
        faceCount: group.faceIds.length,
        representativeFaceId: group.representativeFaceId,
        createdAt: group.createdAt
      };

      await this.database.insertPerson(dbPerson);

      // Update face assignments
      const updates = group.faceIds.map(faceId => ({
        faceId,
        personId: group.id
      }));

      await this.database.bulkUpdatePersonAssignments(updates);
    }
  }

  private calculateQualityScore(quality: any): number {
    const blurScore = Math.max(0, 1 - quality.blur);
    const brightnessScore = quality.brightness > 0.2 && quality.brightness < 0.8 ? 1 : 0.5;
    const angleScore = Math.max(0, 1 - (quality.angle / 45));
    const sizeScore = Math.min(1, quality.size * 50);

    return (blurScore + brightnessScore + angleScore + sizeScore) / 4;
  }
}