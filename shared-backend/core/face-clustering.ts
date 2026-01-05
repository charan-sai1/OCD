// shared-backend/core/face-clustering.ts
// Face clustering algorithms for grouping faces into people

import { Face, PersonGroup, ProcessingMode } from './types.js';
import { FaceSimilarity } from './face-embedding.js';

/**
 * Abstract clustering algorithm interface
 */
export abstract class FaceClusteringAlgorithm {
  abstract clusterFaces(
    faces: Face[],
    config: ClusteringConfig
  ): Promise<PersonGroup[]>;

  abstract getAlgorithmName(): string;
}

/**
 * Configuration for face clustering
 */
export interface ClusteringConfig {
  similarityThreshold: number;
  minClusterSize: number;
  maxClusters?: number;
  enableOutlierDetection: boolean;
}

/**
 * Hierarchical clustering implementation
 */
export class HierarchicalClustering extends FaceClusteringAlgorithm {
  async clusterFaces(faces: Face[], config: ClusteringConfig): Promise<PersonGroup[]> {
    if (faces.length === 0) return [];

    // Filter faces with embeddings
    const facesWithEmbeddings = faces.filter(face => face.embedding);
    if (facesWithEmbeddings.length === 0) return [];

    // Build distance matrix
    const distanceMatrix = this.buildDistanceMatrix(facesWithEmbeddings);

    // Perform hierarchical clustering
    const clusters = this.agglomerativeClustering(distanceMatrix, config);

    // Convert to PersonGroup format
    return this.clustersToPersonGroups(clusters, facesWithEmbeddings, config);
  }

  private buildDistanceMatrix(faces: Face[]): number[][] {
    const n = faces.length;
    const matrix: number[][] = Array(n).fill(null).map(() => Array(n).fill(0));

    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        try {
          const embedding1 = faces[i].embedding;
          const embedding2 = faces[j].embedding;

          if (!embedding1 || !embedding2 || embedding1.length !== embedding2.length) {
            // Use maximum distance for invalid embeddings
            matrix[i][j] = matrix[j][i] = 1.0;
            continue;
          }

          const similarity = FaceSimilarity.cosineSimilarity(embedding1, embedding2);
          // Convert similarity to distance (higher similarity = lower distance)
          // Clamp to valid range
          const distance = Math.max(0, Math.min(1, 1 - similarity));
          matrix[i][j] = matrix[j][i] = distance;
        } catch (error) {
          console.warn(`Error calculating distance between faces ${i} and ${j}:`, error);
          // Use maximum distance for calculation errors
          matrix[i][j] = matrix[j][i] = 1.0;
        }
      }
    }

    return matrix;
  }

  private agglomerativeClustering(
    distanceMatrix: number[][],
    config: ClusteringConfig
  ): number[][] {
    const n = distanceMatrix.length;
    let clusters: number[][] = Array.from({ length: n }, (_, i) => [i]);

    while (clusters.length > config.minClusterSize) {
      // Find closest clusters
      let minDistance = Infinity;
      let mergeIndices = [-1, -1];

      for (let i = 0; i < clusters.length; i++) {
        for (let j = i + 1; j < clusters.length; j++) {
          const distance = this.clusterDistance(clusters[i], clusters[j], distanceMatrix);
          if (distance < minDistance) {
            minDistance = distance;
            mergeIndices = [i, j];
          }
        }
      }

      // Stop if minimum distance exceeds threshold
      if (minDistance > (1 - config.similarityThreshold)) break;

      // Merge clusters
      const [i, j] = mergeIndices;
      clusters[i] = [...clusters[i], ...clusters[j]];
      clusters.splice(j, 1);
    }

    return clusters;
  }

  private clusterDistance(
    cluster1: number[],
    cluster2: number[],
    distanceMatrix: number[][]
  ): number {
    // Average linkage
    let sum = 0;
    let count = 0;

    for (const i of cluster1) {
      for (const j of cluster2) {
        sum += distanceMatrix[i][j];
        count++;
      }
    }

    return sum / count;
  }

  private clustersToPersonGroups(
    clusters: number[][],
    faces: Face[],
    config: ClusteringConfig
  ): PersonGroup[] {
    return clusters
      .filter(cluster => cluster.length >= config.minClusterSize)
      .map((cluster, index) => {
        const clusterFaces = cluster.map(i => faces[i]);
        const representativeFace = this.selectRepresentativeFace(clusterFaces);

        return {
          id: `person_${index + 1}`,
          faceIds: clusterFaces.map(face => face.id),
          representativeFaceId: representativeFace.id,
          confidence: this.calculateClusterConfidence(clusterFaces),
          createdAt: new Date()
        };
      });
  }

  private selectRepresentativeFace(faces: Face[]): Face {
    // Select face with highest confidence and best quality
    return faces.reduce((best, current) => {
      const bestScore = (best.confidence || 0) * (best.quality ? (1 - best.quality.blur) : 1);
      const currentScore = (current.confidence || 0) * (current.quality ? (1 - current.quality.blur) : 1);
      return currentScore > bestScore ? current : best;
    });
  }

  private calculateClusterConfidence(faces: Face[]): number {
    // Average confidence of all faces in cluster
    const totalConfidence = faces.reduce((sum, face) => sum + (face.confidence || 0), 0);
    return totalConfidence / faces.length;
  }

  getAlgorithmName(): string {
    return 'Hierarchical Clustering';
  }
}

/**
 * DBSCAN clustering implementation (good for unknown cluster counts)
 */
export class DBSCANClustering extends FaceClusteringAlgorithm {
  async clusterFaces(faces: Face[], config: ClusteringConfig): Promise<PersonGroup[]> {
    if (faces.length === 0) return [];

    const facesWithEmbeddings = faces.filter(face => face.embedding);
    if (facesWithEmbeddings.length === 0) return [];

    // Convert similarity threshold to epsilon (distance threshold)
    const eps = 1 - config.similarityThreshold;
    const minPts = config.minClusterSize;

    // Perform DBSCAN clustering
    const clusters = this.dbscan(facesWithEmbeddings, eps, minPts);

    // Convert to PersonGroup format
    return clusters.map((cluster, index) => {
      const clusterFaces = cluster.map(i => facesWithEmbeddings[i]);
      const representativeFace = this.selectRepresentativeFace(clusterFaces);

      return {
        id: `person_${index + 1}`,
        faceIds: clusterFaces.map(face => face.id),
        representativeFaceId: representativeFace.id,
        confidence: this.calculateClusterConfidence(clusterFaces),
        createdAt: new Date()
      };
    });
  }

  private dbscan(faces: Face[], eps: number, minPts: number): number[][] {
    const n = faces.length;
    const visited = new Set<number>();
    const clustered = new Set<number>();
    const clusters: number[][] = [];

    for (let i = 0; i < n; i++) {
      if (visited.has(i)) continue;

      visited.add(i);
      const neighbors = this.regionQuery(i, faces, eps);

      if (neighbors.length < minPts) {
        // Mark as noise/outlier
        continue;
      }

      // Start new cluster
      const cluster: number[] = [];
      const queue = [...neighbors];

      while (queue.length > 0) {
        const point = queue.shift()!;
        if (clustered.has(point)) continue;

        clustered.add(point);
        cluster.push(point);

        if (!visited.has(point)) {
          visited.add(point);
          const pointNeighbors = this.regionQuery(point, faces, eps);
          if (pointNeighbors.length >= minPts) {
            queue.push(...pointNeighbors.filter(p => !visited.has(p)));
          }
        }
      }

      clusters.push(cluster);
    }

    return clusters;
  }

  private regionQuery(point: number, faces: Face[], eps: number): number[] {
    const neighbors: number[] = [];

    for (let i = 0; i < faces.length; i++) {
      const distance = 1 - FaceSimilarity.cosineSimilarity(
        faces[point].embedding!,
        faces[i].embedding!
      );

      if (distance <= eps) {
        neighbors.push(i);
      }
    }

    return neighbors;
  }

  private selectRepresentativeFace(faces: Face[]): Face {
    // Select face closest to cluster centroid
    if (faces.length === 1) return faces[0];

    const centroid = this.calculateCentroid(faces);
    let bestFace = faces[0];
    let bestDistance = Infinity;

    for (const face of faces) {
      const distance = FaceSimilarity.euclideanDistance(centroid, face.embedding!);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestFace = face;
      }
    }

    return bestFace;
  }

  private calculateCentroid(faces: Face[]): number[] {
    const dimensions = faces[0].embedding!.length;
    const centroid = new Array(dimensions).fill(0);

    for (const face of faces) {
      for (let i = 0; i < dimensions; i++) {
        centroid[i] += face.embedding![i];
      }
    }

    for (let i = 0; i < dimensions; i++) {
      centroid[i] /= faces.length;
    }

    return centroid;
  }

  private calculateClusterConfidence(faces: Face[]): number {
    // Average confidence weighted by distance from centroid
    const centroid = this.calculateCentroid(faces);
    let totalWeightedConfidence = 0;
    let totalWeight = 0;

    for (const face of faces) {
      const distance = FaceSimilarity.euclideanDistance(centroid, face.embedding!);
      const weight = Math.exp(-distance); // Closer points have higher weight
      totalWeightedConfidence += (face.confidence || 0) * weight;
      totalWeight += weight;
    }

    return totalWeightedConfidence / totalWeight;
  }

  getAlgorithmName(): string {
    return 'DBSCAN Clustering';
  }
}

/**
 * Face clustering pipeline with algorithm selection
 */
export class FaceClusteringPipeline {
  private algorithms: Map<string, FaceClusteringAlgorithm> = new Map();

  constructor() {
    // Register default algorithms
    this.registerAlgorithm('hierarchical', new HierarchicalClustering());
    this.registerAlgorithm('dbscan', new DBSCANClustering());
  }

  /**
   * Register a clustering algorithm
   */
  registerAlgorithm(name: string, algorithm: FaceClusteringAlgorithm): void {
    this.algorithms.set(name, algorithm);
  }

  /**
   * Cluster faces into people groups
   */
  async clusterFaces(
    faces: Face[],
    algorithm: string = 'dbscan',
    config: Partial<ClusteringConfig> = {}
  ): Promise<PersonGroup[]> {
    const clusteringAlgorithm = this.algorithms.get(algorithm);
    if (!clusteringAlgorithm) {
      throw new Error(`Unknown clustering algorithm: ${algorithm}`);
    }

    // Default configuration based on processing mode
    const defaultConfig: ClusteringConfig = {
      similarityThreshold: 0.6,
      minClusterSize: 2,
      enableOutlierDetection: true,
      ...config
    };

    return await clusteringAlgorithm.clusterFaces(faces, defaultConfig);
  }

  /**
   * Get available clustering algorithms
   */
  getAvailableAlgorithms(): string[] {
    return Array.from(this.algorithms.keys());
  }

  /**
   * Merge person groups (for manual curation)
   */
  mergePersonGroups(groups: PersonGroup[]): PersonGroup {
    if (groups.length === 0) return groups[0];
    if (groups.length === 1) return groups[0];

    const merged: PersonGroup = {
      id: `merged_${Date.now()}`,
      name: groups.find(g => g.name)?.name,
      faceIds: groups.flatMap(g => g.faceIds),
      representativeFaceId: groups[0].representativeFaceId, // Could be improved
      confidence: Math.max(...groups.map(g => g.confidence)),
      createdAt: new Date()
    };

    return merged;
  }

  /**
   * Split person group (for manual curation)
   */
  splitPersonGroup(
    group: PersonGroup,
    faceIds: string[][]
  ): PersonGroup[] {
    return faceIds.map((ids, index) => ({
      id: `${group.id}_split_${index + 1}`,
      name: group.name,
      faceIds: ids,
      representativeFaceId: ids[0],
      confidence: group.confidence,
      createdAt: new Date()
    }));
  }
}