// apps/desktop/src/hooks/useFaceRecognition.ts
// React hook for facial recognition functionality

import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

export interface Face {
  id: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  landmarks?: {
    leftEye: { x: number; y: number };
    rightEye: { x: number; y: number };
    nose: { x: number; y: number };
    leftMouth: { x: number; y: number };
    rightMouth: { x: number; y: number };
  };
}

export interface PersonGroup {
  id: string;
  name?: string;
  faceIds: string[];
  representativeFaceId: string;
  confidence: number;
  createdAt: string;
}

export interface ProcessingStatus {
  isProcessing: boolean;
  queueLength: number;
  currentImage?: string;
  progress: number;  // 0-100
  estimatedTimeRemaining?: number; // seconds
  currentStage?: ProcessingStage;
  stageProgress?: StageProgress;
  processedImages?: number;
  totalImages?: number;
  facesDetected?: number;
  processingSpeed?: number; // images per minute
}

export enum ProcessingStage {
  Idle = 'idle',
  DetectingFaces = 'detecting_faces',
  ExtractingEmbeddings = 'extracting_embeddings',
  ClusteringFaces = 'clustering_faces',
  Completed = 'completed',
  Error = 'error'
}

export interface StageProgress {
  detection: { completed: number; total: number; timeSpent: number };
  embedding: { completed: number; total: number; timeSpent: number };
  clustering: { completed: boolean; timeSpent: number };
}

export interface ProcessingMetrics {
  startTime: number;
  imagesProcessed: number;
  facesDetected: number;
  stageStartTime: { [key in ProcessingStage]?: number };
  stageMetrics: { [key in ProcessingStage]?: { itemsProcessed: number; totalItems: number } };
}

export interface DeviceCapabilities {
  platform: 'desktop' | 'mobile';
  cpuCores: number;
  memoryGB: number;
  hasGPU: boolean;
  batteryLevel?: number;
  isCharging?: boolean;
  thermalState?: 'nominal' | 'fair' | 'serious' | 'critical';
}

export enum ProcessingMode {
  Fast = 'fast',
  Balanced = 'balanced',
  HighAccuracy = 'accurate'
}

export function useFaceRecognition() {
  const [isInitialized, setIsInitialized] = useState(false);
  const [capabilities, setCapabilities] = useState<DeviceCapabilities | null>(null);
  const [processingStatus, setProcessingStatus] = useState<ProcessingStatus | null>(null);
  const [people, setPeople] = useState<PersonGroup[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [processingMetrics, setProcessingMetrics] = useState<ProcessingMetrics>({
    startTime: 0,
    imagesProcessed: 0,
    facesDetected: 0,
    stageStartTime: {},
    stageMetrics: {}
  });

  // Helper function to update processing metrics
  const updateProcessingMetrics = useCallback((stage: ProcessingStage, metrics: Partial<ProcessingMetrics>) => {
    setProcessingMetrics(prev => ({
      ...prev,
      ...metrics,
      stageStartTime: {
        ...prev.stageStartTime,
        [stage]: prev.stageStartTime[stage] || Date.now()
      }
    }));
  }, []);

  // Helper function to calculate stage progress
  const calculateStageProgress = useCallback((): StageProgress => {
    const now = Date.now();
    const { stageStartTime, stageMetrics } = processingMetrics;

    return {
      detection: {
        completed: stageMetrics[ProcessingStage.DetectingFaces]?.itemsProcessed || 0,
        total: stageMetrics[ProcessingStage.DetectingFaces]?.totalItems || 0,
        timeSpent: stageStartTime[ProcessingStage.DetectingFaces]
          ? now - stageStartTime[ProcessingStage.DetectingFaces]!
          : 0
      },
      embedding: {
        completed: stageMetrics[ProcessingStage.ExtractingEmbeddings]?.itemsProcessed || 0,
        total: stageMetrics[ProcessingStage.ExtractingEmbeddings]?.totalItems || 0,
        timeSpent: stageStartTime[ProcessingStage.ExtractingEmbeddings]
          ? now - stageStartTime[ProcessingStage.ExtractingEmbeddings]!
          : 0
      },
      clustering: {
        completed: !!stageMetrics[ProcessingStage.ClusteringFaces],
        timeSpent: stageStartTime[ProcessingStage.ClusteringFaces]
          ? now - stageStartTime[ProcessingStage.ClusteringFaces]!
          : 0
      }
    };
  }, [processingMetrics]);

  // Initialize face recognition system
  const initialize = useCallback(async () => {
    if (isInitialized) return;

    try {
      setIsLoading(true);
      await invoke('initialize_face_recognition');
      setIsInitialized(true);

      // Get capabilities
      const caps = await invoke('get_capabilities') as DeviceCapabilities;
      setCapabilities(caps);

      // Get initial people
      await loadPeople();
    } catch (error) {
      console.error('Failed to initialize face recognition:', error);
    } finally {
      setIsLoading(false);
    }
  }, [isInitialized]);

  // Load people from backend
  const loadPeople = useCallback(async () => {
    try {
      const peopleData = await invoke('get_people') as PersonGroup[];
      setPeople(peopleData);
    } catch (error) {
      console.error('Failed to load people:', error);
    }
  }, []);

  // Detect faces in an image
  const detectFaces = useCallback(async (imagePath: string) => {
    try {
      updateProcessingMetrics(ProcessingStage.DetectingFaces, {
        stageMetrics: {
          [ProcessingStage.DetectingFaces]: {
            itemsProcessed: (processingMetrics.stageMetrics[ProcessingStage.DetectingFaces]?.itemsProcessed || 0) + 1,
            totalItems: processingMetrics.stageMetrics[ProcessingStage.DetectingFaces]?.totalItems || 1
          }
        }
      });

      const result = await invoke('detect_faces', { imagePath }) as { faces: Face[]; processingTime: number; modelUsed: string };

      // Update faces detected count
      setProcessingMetrics(prev => ({
        ...prev,
        facesDetected: prev.facesDetected + result.faces.length,
        imagesProcessed: prev.imagesProcessed + 1
      }));

      return result;
    } catch (error) {
      console.error('Failed to detect faces:', error);
      updateProcessingMetrics(ProcessingStage.Error, {});
      throw error;
    }
  }, [processingMetrics, updateProcessingMetrics]);

  // Extract embeddings for faces
  const extractEmbeddings = useCallback(async (faceIds: string[]) => {
    try {
      updateProcessingMetrics(ProcessingStage.ExtractingEmbeddings, {
        stageMetrics: {
          [ProcessingStage.ExtractingEmbeddings]: {
            itemsProcessed: (processingMetrics.stageMetrics[ProcessingStage.ExtractingEmbeddings]?.itemsProcessed || 0) + faceIds.length,
            totalItems: processingMetrics.stageMetrics[ProcessingStage.ExtractingEmbeddings]?.totalItems || faceIds.length
          }
        }
      });

      const result = await invoke('extract_embeddings', { faceIds }) as { faces: Face[]; processingTime: number; modelUsed: string };
      return result;
    } catch (error) {
      console.error('Failed to extract embeddings:', error);
      updateProcessingMetrics(ProcessingStage.Error, {});
      throw error;
    }
  }, [processingMetrics, updateProcessingMetrics]);

  // Find similar faces
  const findSimilarFaces = useCallback(async (
    queryFaceId: string,
    threshold: number = 0.6,
    maxResults: number = 10
  ) => {
    try {
      const result = await invoke('find_similar_faces', {
        queryFaceId,
        threshold,
        maxResults
      });
      return result as {
        similarFaces: Array<{
          face: Face;
          similarity: number;
          imagePath: string;
        }>;
      };
    } catch (error) {
      console.error('Failed to find similar faces:', error);
      throw error;
    }
  }, []);

  // Cluster faces into people
  const clusterFaces = useCallback(async (algorithm: string = 'dbscan') => {
    try {
      setIsLoading(true);
      updateProcessingMetrics(ProcessingStage.ClusteringFaces, {
        stageMetrics: {
          [ProcessingStage.ClusteringFaces]: { itemsProcessed: 1, totalItems: 1 }
        }
      });

      const result = await invoke('cluster_faces', { algorithm });
      const personGroups = (result as { personGroups: PersonGroup[] }).personGroups;

      setPeople(personGroups);
      updateProcessingMetrics(ProcessingStage.Completed, {});
      return personGroups;
    } catch (error) {
      console.error('Failed to cluster faces:', error);
      updateProcessingMetrics(ProcessingStage.Error, {});
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [updateProcessingMetrics]);

  // Update person information
  const updatePerson = useCallback(async (personId: string, name: string) => {
    try {
      await invoke('update_person', { personId, name });
      // Update local state
      setPeople(prev => prev.map(person =>
        person.id === personId ? { ...person, name } : person
      ));
    } catch (error) {
      console.error('Failed to update person:', error);
      throw error;
    }
  }, []);

  // Get processing status
  const getProcessingStatus = useCallback(async () => {
    try {
      const status = await invoke('get_processing_status') as ProcessingStatus;
      setProcessingStatus(status);
      return status;
    } catch (error) {
      console.error('Failed to get processing status:', error);
      throw error;
    }
  }, []);

  // Set processing mode
  const setProcessingMode = useCallback(async (mode: ProcessingMode) => {
    try {
      await invoke('set_processing_mode', { mode });
    } catch (error) {
      console.error('Failed to set processing mode:', error);
      throw error;
    }
  }, []);

  // Initialize processing metrics for a batch
  const initializeBatchProcessing = useCallback((imageCount: number) => {
    setProcessingMetrics({
      startTime: Date.now(),
      imagesProcessed: 0,
      facesDetected: 0,
      stageStartTime: {
        [ProcessingStage.DetectingFaces]: Date.now()
      },
      stageMetrics: {
        [ProcessingStage.DetectingFaces]: { itemsProcessed: 0, totalItems: imageCount }
      }
    });
  }, []);

  // Queue images for processing
  const queueImagesForProcessing = useCallback(async (imagePaths: string[]) => {
    try {
      initializeBatchProcessing(imagePaths.length);
      await invoke('queue_images_for_processing', { imagePaths });
    } catch (error) {
      console.error('Failed to queue images:', error);
      throw error;
    }
  }, [initializeBatchProcessing]);

  // Process next image in queue
  const processNextImage = useCallback(async () => {
    try {
      const processed = await invoke('process_next_image') as boolean;
      return processed;
    } catch (error) {
      console.error('Failed to process next image:', error);
      throw error;
    }
  }, []);

  // Enhanced getProcessingStatus with detailed metrics
  const getEnhancedProcessingStatus = useCallback(async (): Promise<ProcessingStatus> => {
    try {
      const baseStatus = await invoke('get_processing_status') as ProcessingStatus;
      const stageProgress = calculateStageProgress();

      // Calculate overall progress based on stages
      let overallProgress = 0;
      let totalStages = 0;

      if (stageProgress.detection.total > 0) {
        overallProgress += (stageProgress.detection.completed / stageProgress.detection.total) * 40;
        totalStages++;
      }
      if (stageProgress.embedding.total > 0) {
        overallProgress += (stageProgress.embedding.completed / stageProgress.embedding.total) * 40;
        totalStages++;
      }
      if (stageProgress.clustering.completed || processingMetrics.stageMetrics[ProcessingStage.ClusteringFaces]) {
        overallProgress += 20;
        totalStages++;
      }

      // Normalize progress if not all stages are active
      if (totalStages > 0) {
        overallProgress = Math.min(overallProgress, 100);
      }

      // Calculate processing speed
      const elapsedTime = (Date.now() - processingMetrics.startTime) / 1000 / 60; // minutes
      const processingSpeed = elapsedTime > 0 ? processingMetrics.imagesProcessed / elapsedTime : 0;

      // Estimate remaining time
      const remainingImages = Math.max(0,
        (processingMetrics.stageMetrics[ProcessingStage.DetectingFaces]?.totalItems || 0) -
        (processingMetrics.stageMetrics[ProcessingStage.DetectingFaces]?.itemsProcessed || 0)
      );
      const estimatedTimeRemaining = (processingSpeed > 0 && remainingImages > 0)
        ? (remainingImages / processingSpeed) * 60 // seconds
        : undefined;

      const enhancedStatus: ProcessingStatus = {
        ...baseStatus,
        progress: Math.min(overallProgress, 100),
        currentStage: baseStatus.isProcessing ? ProcessingStage.DetectingFaces : ProcessingStage.Idle,
        stageProgress,
        processedImages: processingMetrics.imagesProcessed,
        totalImages: processingMetrics.stageMetrics[ProcessingStage.DetectingFaces]?.totalItems || 0,
        facesDetected: processingMetrics.facesDetected,
        processingSpeed,
        estimatedTimeRemaining
      };

      setProcessingStatus(enhancedStatus);
      return enhancedStatus;
    } catch (error) {
      console.error('Failed to get enhanced processing status:', error);
      throw error;
    }
  }, [calculateStageProgress, processingMetrics]);

  // Auto-refresh processing status
  useEffect(() => {
    if (!isInitialized) return;

    const interval = setInterval(async () => {
      try {
        await getEnhancedProcessingStatus();
      } catch (error) {
        // Ignore errors in background updates
      }
    }, 2000); // Update every 2 seconds

    return () => clearInterval(interval);
  }, [isInitialized, getEnhancedProcessingStatus]);

  return {
    // State
    isInitialized,
    capabilities,
    processingStatus,
    people,
    isLoading,

    // Actions
    initialize,
    detectFaces,
    extractEmbeddings,
    findSimilarFaces,
    clusterFaces,
    updatePerson,
    getProcessingStatus,
    setProcessingMode,
    queueImagesForProcessing,
    processNextImage,
    loadPeople,
    initializeBatchProcessing
  };
}