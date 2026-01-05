// shared-backend/core/types.ts
// Shared TypeScript interfaces for cross-platform facial recognition

export interface DeviceCapabilities {
  platform: 'desktop' | 'mobile';
  cpuCores: number;
  memoryGB: number;
  hasGPU: boolean;
  batteryLevel?: number;     // Mobile only
  isCharging?: boolean;      // Mobile only
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical'; // iOS
}

export enum ProcessingMode {
  Fast = 'fast',           // HOG detection + lightweight embeddings
  Balanced = 'balanced',   // MTCNN detection + FaceNet embeddings
  HighAccuracy = 'accurate' // RetinaFace + ArcFace embeddings
}

export interface Face {
  id: string;
  bounds: FaceBounds;
  confidence: number;
  landmarks?: FaceLandmarks;
  quality?: FaceQuality;
  embedding?: number[];  // Optional for memory efficiency
}

export interface FaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface FaceLandmarks {
  leftEye: Point;
  rightEye: Point;
  nose: Point;
  leftMouth: Point;
  rightMouth: Point;
}

export interface Point {
  x: number;
  y: number;
}

export interface FaceQuality {
  blur: number;        // 0-1, lower is better
  brightness: number;  // 0-1, 0.3-0.7 is ideal
  angle: number;       // degrees from frontal
  size: number;        // relative face size in image
}

export interface FaceDetectionResult {
  faces: Face[];
  processingTime: number;
  modelUsed: string;
  imagePath: string;
}

export interface EmbeddingResult {
  faces: Face[];  // Updated with embeddings
  processingTime: number;
  modelUsed: string;
}

export interface PersonGroup {
  id: string;
  name?: string;
  faceIds: string[];
  representativeFaceId: string;
  confidence: number;
  createdAt: Date;
}

export interface ProcessingStatus {
  isProcessing: boolean;
  queueLength: number;
  currentImage?: string;
  progress: number;  // 0-100
  estimatedTimeRemaining?: number; // seconds
}

export interface FaceRecognitionConfig {
  mode: ProcessingMode;
  similarityThreshold: number;  // 0-1 for face matching
  minFaceSize: number;         // minimum face size in pixels
  maxFacesPerImage: number;    // limit faces per image
  enableEmbeddingCompression: boolean;
  enableQualityFiltering: boolean;
}

// Database types
export interface DatabaseFace {
  id: string;
  imagePath: string;
  bounds: string;  // JSON string
  embedding: Uint8Array;  // Compressed
  confidence: number;
  qualityScore: number;
  landmarks: string;  // JSON string
  createdAt: Date;
}

export interface DatabasePerson {
  id: string;
  name?: string;
  faceCount: number;
  representativeFaceId: string;
  createdAt: Date;
}

export interface ProcessingQueueItem {
  imagePath: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  priority: number;
  retryCount: number;
  createdAt: Date;
  error?: string;
}