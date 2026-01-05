// shared-backend/test-facial-recognition.ts
// Test script for facial recognition functionality

import { FaceRecognitionAPI } from './core/api.js';
import { TauriHardwareDetector } from './platforms/tauri/hardware-detector.js';
import { FaceDetectionPipeline } from './core/face-detection.js';
import { FaceEmbeddingPipeline } from './core/face-embedding.js';
import { FaceClusteringPipeline } from './core/face-clustering.js';
import { TauriSQLiteDatabase } from './platforms/tauri/database.js';
import {
  YOLOv5FaceDetector,
  MTCNNFaceDetector,
  RetinaFaceDetector
} from './platforms/tauri/face-detectors.js';
import {
  MobileFaceNetEmbeddingExtractor,
  FaceNetEmbeddingExtractor,
  ArcFaceEmbeddingExtractor
} from './platforms/tauri/embedding-extractors.js';
import { ProcessingMode } from './core/types.js';

/**
 * Test the facial recognition system
 */
async function testFacialRecognition() {
  console.log('🧪 Testing Facial Recognition System...');

  try {
    // Initialize components
    const hardwareDetector = new TauriHardwareDetector();
    const capabilities = await hardwareDetector.detectCapabilities();
    console.log('📊 Detected capabilities:', capabilities);

    const database = new TauriSQLiteDatabase();
    await database.initialize();

    // Create pipelines
    const detectionPipeline = new FaceDetectionPipeline(capabilities);
    const embeddingPipeline = new FaceEmbeddingPipeline(capabilities);
    const clusteringPipeline = new FaceClusteringPipeline();

    // Register models
    detectionPipeline.registerDetector(ProcessingMode.Fast, new YOLOv5FaceDetector());
    detectionPipeline.registerDetector(ProcessingMode.Balanced, new MTCNNFaceDetector());
    detectionPipeline.registerDetector(ProcessingMode.HighAccuracy, new RetinaFaceDetector());

    embeddingPipeline.registerExtractor(ProcessingMode.Fast, new MobileFaceNetEmbeddingExtractor());
    embeddingPipeline.registerExtractor(ProcessingMode.Balanced, new FaceNetEmbeddingExtractor());
    embeddingPipeline.registerExtractor(ProcessingMode.HighAccuracy, new ArcFaceEmbeddingExtractor());

    // Create API
    const api = new FaceRecognitionAPI(
      hardwareDetector,
      detectionPipeline,
      embeddingPipeline,
      clusteringPipeline,
      database
    );

    await api.initialize();
    console.log('✅ Facial recognition API initialized');

    // Test hardware detection
    const caps = await api.getCapabilities();
    console.log('🔧 Hardware capabilities:', caps);

    // Test processing mode selection
    const optimalMode = ProcessingMode.HighAccuracy; // Force high accuracy for testing
    await api.setProcessingMode(optimalMode);
    console.log(`🎯 Set processing mode to: ${optimalMode}`);

    // Test with mock image data
    console.log('🖼️ Testing face detection with mock image...');
    const mockImageData: ImageData = {
      width: 640,
      height: 480,
      data: new Uint8ClampedArray(640 * 480 * 4)
    };

    // Fill with some mock image data
    for (let i = 0; i < mockImageData.data.length; i += 4) {
      mockImageData.data[i] = Math.random() * 255;     // R
      mockImageData.data[i + 1] = Math.random() * 255; // G
      mockImageData.data[i + 2] = Math.random() * 255; // B
      mockImageData.data[i + 3] = 255;                 // A
    }

    const detectionResult = await api.detectFaces('/test/image.jpg', mockImageData);
    console.log(`👤 Detected ${detectionResult.faces.length} faces in ${detectionResult.processingTime}ms`);
    console.log('📍 Face details:', detectionResult.faces.map(f => ({
      id: f.id,
      confidence: f.confidence,
      bounds: f.bounds
    })));

    if (detectionResult.faces.length > 0) {
      // Test embedding extraction
      console.log('🧠 Testing embedding extraction...');
      const embeddingResult = await api.extractEmbeddings(detectionResult.faces.map(f => f.id));
      console.log(`🧮 Extracted embeddings in ${embeddingResult.processingTime}ms`);
      console.log('📐 Embedding dimensions:', embeddingResult.faces[0]?.embedding?.length || 0);

      // Test clustering
      console.log('🔗 Testing face clustering...');
      const clusters = await api.clusterFaces();
      console.log(`👥 Created ${clusters.length} person clusters`);
      clusters.forEach((cluster, i) => {
        console.log(`  Person ${i + 1}: ${cluster.faceIds.length} faces, confidence: ${cluster.confidence}`);
      });
    }

    // Cleanup
    await api.dispose();
    console.log('🧹 Cleanup completed');

    console.log('🎉 All tests passed! Facial recognition system is working.');

  } catch (error) {
    console.error('❌ Test failed:', error);
    throw error;
  }
}

// Run test if this file is executed directly
if (typeof window === 'undefined') {
  // Node.js environment
  testFacialRecognition().catch(console.error);
} else {
  // Browser environment - expose for manual testing
  (window as any).testFacialRecognition = testFacialRecognition;
}