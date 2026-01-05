// shared-backend/platforms/tauri/index.ts
// Main Tauri integration for facial recognition

import { FaceRecognitionAPI } from '../../core/api.js';
import { TauriHardwareDetector } from './hardware-detector.js';
import {
  FallbackFaceDetector
} from './face-detectors.js';
import {
  MobileFaceNetEmbeddingExtractor,
  FaceNetEmbeddingExtractor,
  ArcFaceEmbeddingExtractor
} from './embedding-extractors.js';
import { TauriSQLiteDatabase } from './database.js';
import { FaceDetectionPipeline } from '../../core/face-detection.js';
import { FaceEmbeddingPipeline } from '../../core/face-embedding.js';
import { FaceClusteringPipeline } from '../../core/face-clustering.js';
import { ProcessingMode } from '../../core/types.js';

// Global instance
let faceRecognitionAPI: FaceRecognitionAPI | null = null;

/**
 * Initialize the facial recognition system
 */
export async function initializeFaceRecognition(): Promise<void> {
  if (faceRecognitionAPI) {
    return; // Already initialized
  }

  try {
    // Create components
    const hardwareDetector = new TauriHardwareDetector();
    const database = new TauriSQLiteDatabase();

    // Create pipelines
    const detectionPipeline = new FaceDetectionPipeline(await hardwareDetector.detectCapabilities());
    const embeddingPipeline = new FaceEmbeddingPipeline(await hardwareDetector.detectCapabilities());
    const clusteringPipeline = new FaceClusteringPipeline();

    // Register detectors for different modes
    // Using fallback detector until ONNX models are properly implemented
    detectionPipeline.registerDetector(ProcessingMode.Fast, new FallbackFaceDetector());
    detectionPipeline.registerDetector(ProcessingMode.Balanced, new FallbackFaceDetector());
    detectionPipeline.registerDetector(ProcessingMode.HighAccuracy, new FallbackFaceDetector());

    // Register embedding extractors
    embeddingPipeline.registerExtractor(ProcessingMode.Fast, new MobileFaceNetEmbeddingExtractor());
    embeddingPipeline.registerExtractor(ProcessingMode.Balanced, new FaceNetEmbeddingExtractor());
    embeddingPipeline.registerExtractor(ProcessingMode.HighAccuracy, new ArcFaceEmbeddingExtractor());

    // Create API instance
    faceRecognitionAPI = new FaceRecognitionAPI(
      hardwareDetector,
      detectionPipeline,
      embeddingPipeline,
      clusteringPipeline,
      database
    );

    // Initialize the system
    await faceRecognitionAPI.initialize();

    console.log('Face recognition system initialized successfully');
  } catch (error) {
    console.error('Failed to initialize face recognition:', error);
    throw error;
  }
}

/**
 * Get the face recognition API instance
 */
export function getFaceRecognitionAPI(): FaceRecognitionAPI {
  if (!faceRecognitionAPI) {
    throw new Error('Face recognition system not initialized. Call initializeFaceRecognition() first.');
  }
  return faceRecognitionAPI;
}

/**
 * Cleanup the face recognition system
 */
export async function disposeFaceRecognition(): Promise<void> {
  if (faceRecognitionAPI) {
    await faceRecognitionAPI.dispose();
    faceRecognitionAPI = null;
  }
}

// Tauri command handlers (would be called from Rust backend)
export const faceRecognitionCommands = {
  async initializeFaceRecognition(): Promise<void> {
    await initializeFaceRecognition();
  },

  async detectFaces(imagePath: string): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.detectFaces(imagePath);
  },

  async extractEmbeddings(faceIds: string[]): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.extractEmbeddings(faceIds);
  },

  async findSimilarFaces(queryFaceId: string, threshold?: number, maxResults?: number): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.findSimilarFaces(queryFaceId, threshold, maxResults);
  },

  async clusterFaces(algorithm?: string): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.clusterFaces(algorithm);
  },

  async getPeople(): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.getPeople();
  },

  async updatePerson(personId: string, name: string): Promise<void> {
    const api = getFaceRecognitionAPI();
    await api.updatePerson(personId, name);
  },

  async getProcessingStatus(): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.getProcessingStatus();
  },

  async getCapabilities(): Promise<any> {
    const api = getFaceRecognitionAPI();
    return await api.getCapabilities();
  },

  async setProcessingMode(mode: ProcessingMode): Promise<void> {
    const api = getFaceRecognitionAPI();
    await api.setProcessingMode(mode);
  },

  async queueImagesForProcessing(imagePaths: string[]): Promise<void> {
    const api = getFaceRecognitionAPI();
    await api.queueImagesForProcessing(imagePaths);
  },

  async processNextImage(): Promise<boolean> {
    const api = getFaceRecognitionAPI();
    return await api.processNextImage();
  },

  async disposeFaceRecognition(): Promise<void> {
    await disposeFaceRecognition();
  }
};