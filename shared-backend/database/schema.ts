// shared-backend/database/schema.ts
// SQLite database schema and operations for facial recognition data

import {
  DatabaseFace,
  DatabasePerson,
  ProcessingQueueItem,
  Face,
  PersonGroup
} from '../core/types.js';

/**
 * Database schema definitions
 */
export const FACE_TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS faces (
    id TEXT PRIMARY KEY,
    image_path TEXT NOT NULL,
    bounds TEXT NOT NULL,        -- JSON: {x, y, width, height}
    embedding BLOB,              -- Compressed embedding vector
    embedding_min REAL,          -- Min value for decompression
    embedding_max REAL,          -- Max value for decompression
    confidence REAL NOT NULL,
    quality_score REAL,          -- Face quality metric
    landmarks TEXT,              -- JSON: facial landmarks
    person_id TEXT,              -- Associated person (can be null)
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (person_id) REFERENCES people(id)
  );

  CREATE INDEX IF NOT EXISTS idx_faces_image_path ON faces(image_path);
  CREATE INDEX IF NOT EXISTS idx_faces_person_id ON faces(person_id);
  CREATE INDEX IF NOT EXISTS idx_faces_quality ON faces(quality_score);
`;

export const PERSON_TABLE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS people (
    id TEXT PRIMARY KEY,
    name TEXT,
    face_count INTEGER DEFAULT 0,
    representative_face_id TEXT REFERENCES faces(id),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
`;

export const PROCESSING_QUEUE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS processing_queue (
    image_path TEXT PRIMARY KEY,
    status TEXT DEFAULT 'pending',  -- pending, processing, completed, failed
    priority INTEGER DEFAULT 0,
    retry_count INTEGER DEFAULT 0,
    error_message TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_queue_status ON processing_queue(status);
  CREATE INDEX IF NOT EXISTS idx_queue_priority ON processing_queue(priority DESC);
`;

export const FACE_PERSON_RELATION_SCHEMA = `
  CREATE TABLE IF NOT EXISTS face_person_relations (
    face_id TEXT REFERENCES faces(id),
    person_id TEXT REFERENCES people(id),
    confidence REAL,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (face_id, person_id)
  );
`;

/**
 * Abstract database interface for cross-platform compatibility
 */
export abstract class FaceDatabase {
  abstract initialize(): Promise<void>;
  abstract close(): Promise<void>;

  // Face operations
  abstract insertFace(face: DatabaseFace): Promise<void>;
  abstract getFace(faceId: string): Promise<DatabaseFace | null>;
  abstract getFacesByImage(imagePath: string): Promise<DatabaseFace[]>;
  abstract getFacesByPerson(personId: string): Promise<DatabaseFace[]>;
  abstract updateFacePerson(faceId: string, personId: string | null): Promise<void>;
  abstract deleteFace(faceId: string): Promise<void>;

  // Person operations
  abstract insertPerson(person: DatabasePerson): Promise<void>;
  abstract getPerson(personId: string): Promise<DatabasePerson | null>;
  abstract getAllPeople(): Promise<DatabasePerson[]>;
  abstract updatePerson(person: DatabasePerson): Promise<void>;
  abstract updatePersonFaceCount(personId: string): Promise<void>;
  abstract deletePerson(personId: string): Promise<void>;

  // Processing queue operations
  abstract enqueueImage(imagePath: string, priority?: number): Promise<void>;
  abstract dequeueNextImage(): Promise<ProcessingQueueItem | null>;
  abstract updateProcessingStatus(
    imagePath: string,
    status: string,
    error?: string
  ): Promise<void>;
  abstract getPendingImages(limit?: number): Promise<ProcessingQueueItem[]>;

  // Analytics and queries
  abstract getFaceCount(): Promise<number>;
  abstract getPersonCount(): Promise<number>;
  abstract getUnassignedFaces(): Promise<DatabaseFace[]>;
  abstract getFacesWithoutEmbeddings(): Promise<DatabaseFace[]>;

  // Bulk operations
  abstract bulkInsertFaces(faces: DatabaseFace[]): Promise<void>;
  abstract bulkUpdatePersonAssignments(updates: Array<{
    faceId: string;
    personId: string | null;
  }>): Promise<void>;
}

/**
 * Database conversion utilities
 */
export class DatabaseConverters {
  /**
   * Convert Face to DatabaseFace
   */
  static faceToDatabase(face: Face, imagePath: string): DatabaseFace {
    return {
      id: face.id,
      imagePath,
      bounds: JSON.stringify(face.bounds),
      embedding: face.embedding ? new Uint8Array(face.embedding.length * 4) : new Uint8Array(0), // Placeholder
      embedding_min: face.embedding ? Math.min(...face.embedding) : 0,
      embedding_max: face.embedding ? Math.max(...face.embedding) : 0,
      confidence: face.confidence,
      qualityScore: face.quality ? this.calculateQualityScore(face.quality) : 0,
      landmarks: face.landmarks ? JSON.stringify(face.landmarks) : null,
      createdAt: new Date()
    };
  }

  /**
   * Convert DatabaseFace to Face
   */
  static databaseToFace(dbFace: DatabaseFace): Face {
    return {
      id: dbFace.id,
      bounds: JSON.parse(dbFace.bounds),
      confidence: dbFace.confidence,
      landmarks: dbFace.landmarks ? JSON.parse(dbFace.landmarks) : undefined,
      quality: dbFace.qualityScore ? this.qualityScoreToQuality(dbFace.qualityScore) : undefined
    };
  }

  /**
   * Convert PersonGroup to DatabasePerson
   */
  static personGroupToDatabase(personGroup: PersonGroup): DatabasePerson {
    return {
      id: personGroup.id,
      name: personGroup.name,
      faceCount: personGroup.faceIds.length,
      representativeFaceId: personGroup.representativeFaceId,
      createdAt: personGroup.createdAt
    };
  }

  private static calculateQualityScore(quality: any): number {
    // Calculate composite quality score (0-1)
    const blurScore = Math.max(0, 1 - quality.blur);
    const brightnessScore = quality.brightness > 0.2 && quality.brightness < 0.8 ? 1 : 0.5;
    const angleScore = Math.max(0, 1 - (quality.angle / 45)); // Penalize angles > 45 degrees
    const sizeScore = Math.min(1, quality.size * 50); // Prefer larger faces

    return (blurScore + brightnessScore + angleScore + sizeScore) / 4;
  }

  private static qualityScoreToQuality(score: number): any {
    // Reverse conversion (approximate)
    return {
      blur: Math.max(0, 1 - score),
      brightness: 0.5,
      angle: (1 - score) * 45,
      size: score / 50
    };
  }
}

/**
 * Database migration utilities
 */
export class DatabaseMigrations {
  static readonly MIGRATIONS = [
    {
      version: 1,
      description: 'Initial schema',
      sql: [
        FACE_TABLE_SCHEMA,
        PERSON_TABLE_SCHEMA,
        PROCESSING_QUEUE_SCHEMA,
        FACE_PERSON_RELATION_SCHEMA
      ].join('\n')
    }
  ];

  static async runMigrations(db: FaceDatabase): Promise<void> {
    // Implementation depends on specific database adapter
    // This would check current version and run necessary migrations
  }
}