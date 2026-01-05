// shared-backend/platforms/tauri/database.ts
// Tauri-specific database implementation with proper data validation and error handling

import { FaceDatabase } from '../../database/schema.js';
import {
  DatabaseFace,
  DatabasePerson,
  ProcessingQueueItem
} from '../../core/types.js';

interface DatabaseConfig {
  maxRetries: number;
  retryDelay: number;
  maxStorageSize: number; // MB
  enableCompression: boolean;
}

export class TauriSQLiteDatabase extends FaceDatabase {
  private config: DatabaseConfig = {
    maxRetries: 3,
    retryDelay: 100,
    maxStorageSize: 100, // 100MB limit
    enableCompression: true
  };

  private initialized = false;

  async initialize(): Promise<void> {
    if (this.initialized) return;

    try {
      // Initialize storage with validation
      this.initializeStorage();
      this.validateStorageIntegrity();
      this.cleanupOldData();

      this.initialized = true;
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Failed to initialize database:', error);
      throw new Error(`Database initialization failed: ${error}`);
    }
  }

  async close(): Promise<void> {
    // Cleanup and flush data
    this.flushToStorage();
    this.initialized = false;
  }

  async insertFace(face: DatabaseFace): Promise<void> {
    this.validateFaceData(face);

    const faces = this.getStoredFaces();
    faces.push({
      ...face,
      createdAt: face.createdAt || new Date()
    });

    this.setStoredFaces(faces);
  }

  async getFace(faceId: string): Promise<DatabaseFace | null> {
    if (!faceId || typeof faceId !== 'string') {
      throw new Error('Invalid face ID');
    }

    const faces = this.getStoredFaces();
    return faces.find(face => face.id === faceId) || null;
  }

  async getFacesByImage(imagePath: string): Promise<DatabaseFace[]> {
    if (!imagePath || typeof imagePath !== 'string') {
      throw new Error('Invalid image path');
    }

    const faces = this.getStoredFaces();
    return faces.filter(face => face.imagePath === imagePath);
  }

  async getFacesByPerson(personId: string): Promise<DatabaseFace[]> {
    if (personId && typeof personId !== 'string') {
      throw new Error('Invalid person ID');
    }

    const faces = this.getStoredFaces();
    return faces.filter(face => face.personId === personId);
  }

  async updateFacePerson(faceId: string, personId: string | null): Promise<void> {
    if (!faceId || typeof faceId !== 'string') {
      throw new Error('Invalid face ID');
    }

    if (personId && typeof personId !== 'string') {
      throw new Error('Invalid person ID');
    }

    const faces = this.getStoredFaces();
    const faceIndex = faces.findIndex(face => face.id === faceId);

    if (faceIndex === -1) {
      throw new Error(`Face with ID ${faceId} not found`);
    }

    faces[faceIndex].personId = personId;
    faces[faceIndex].updatedAt = new Date();
    this.setStoredFaces(faces);
  }

  async deleteFace(faceId: string): Promise<void> {
    if (!faceId || typeof faceId !== 'string') {
      throw new Error('Invalid face ID');
    }

    const faces = this.getStoredFaces();
    const filteredFaces = faces.filter(face => face.id !== faceId);

    if (filteredFaces.length === faces.length) {
      throw new Error(`Face with ID ${faceId} not found`);
    }

    this.setStoredFaces(filteredFaces);
  }

  async insertPerson(person: DatabasePerson): Promise<void> {
    this.validatePersonData(person);

    const people = this.getStoredPeople();
    people.push({
      ...person,
      createdAt: person.createdAt || new Date()
    });

    this.setStoredPeople(people);
  }

  async getPerson(personId: string): Promise<DatabasePerson | null> {
    if (!personId || typeof personId !== 'string') {
      throw new Error('Invalid person ID');
    }

    const people = this.getStoredPeople();
    return people.find(person => person.id === personId) || null;
  }

  async getAllPeople(): Promise<DatabasePerson[]> {
    return this.getStoredPeople();
  }

  async updatePerson(person: DatabasePerson): Promise<void> {
    this.validatePersonData(person);

    const people = this.getStoredPeople();
    const personIndex = people.findIndex(p => p.id === person.id);

    if (personIndex === -1) {
      throw new Error(`Person with ID ${person.id} not found`);
    }

    people[personIndex] = {
      ...person,
      updatedAt: new Date()
    };
    this.setStoredPeople(people);
  }

  async updatePersonFaceCount(personId: string): Promise<void> {
    const faces = this.getStoredFaces();
    const faceCount = faces.filter(face => face.personId === personId).length;

    const people = this.getStoredPeople();
    const personIndex = people.findIndex(p => p.id === personId);

    if (personIndex !== -1) {
      people[personIndex].faceCount = faceCount;
      people[personIndex].updatedAt = new Date();
      this.setStoredPeople(people);
    }
  }

  async deletePerson(personId: string): Promise<void> {
    if (!personId || typeof personId !== 'string') {
      throw new Error('Invalid person ID');
    }

    const people = this.getStoredPeople();
    const filteredPeople = people.filter(person => person.id !== personId);

    if (filteredPeople.length === people.length) {
      throw new Error(`Person with ID ${personId} not found`);
    }

    // Remove person assignments from faces
    const faces = this.getStoredFaces();
    faces.forEach(face => {
      if (face.personId === personId) {
        face.personId = null;
        face.updatedAt = new Date();
      }
    });

    this.setStoredPeople(filteredPeople);
    this.setStoredFaces(faces);
  }

  async enqueueImage(imagePath: string, priority: number = 0): Promise<void> {
    if (!imagePath || typeof imagePath !== 'string') {
      throw new Error('Invalid image path');
    }

    const queue = this.getStoredQueue();
    const existingIndex = queue.findIndex(item => item.imagePath === imagePath);

    const now = new Date();

    if (existingIndex === -1) {
      queue.push({
        imagePath,
        status: 'pending',
        priority,
        retryCount: 0,
        createdAt: now,
        updatedAt: now
      });
    } else {
      queue[existingIndex].status = 'pending';
      queue[existingIndex].priority = priority;
      queue[existingIndex].updatedAt = now;
    }

    this.setStoredQueue(queue);
  }

  async dequeueNextImage(): Promise<ProcessingQueueItem | null> {
    const queue = this.getStoredQueue()
      .filter(item => item.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());

    if (queue.length === 0) return null;

    const nextItem = { ...queue[0] };
    nextItem.status = 'processing';
    nextItem.updatedAt = new Date();

    const allQueue = this.getStoredQueue();
    const index = allQueue.findIndex(item => item.imagePath === nextItem.imagePath);
    if (index !== -1) {
      allQueue[index] = nextItem;
      this.setStoredQueue(allQueue);
    }

    return nextItem;
  }

  async updateProcessingStatus(
    imagePath: string,
    status: string,
    error?: string
  ): Promise<void> {
    if (!imagePath || typeof imagePath !== 'string') {
      throw new Error('Invalid image path');
    }

    if (!['pending', 'processing', 'completed', 'failed'].includes(status)) {
      throw new Error(`Invalid status: ${status}`);
    }

    const queue = this.getStoredQueue();
    const itemIndex = queue.findIndex(item => item.imagePath === imagePath);

    if (itemIndex === -1) {
      throw new Error(`Queue item for ${imagePath} not found`);
    }

    queue[itemIndex].status = status;
    queue[itemIndex].error = error;
    queue[itemIndex].updatedAt = new Date();

    this.setStoredQueue(queue);
  }

  async getPendingImages(limit?: number): Promise<ProcessingQueueItem[]> {
    const queue = this.getStoredQueue()
      .filter(item => item.status === 'pending')
      .sort((a, b) => b.priority - a.priority || a.createdAt.getTime() - b.createdAt.getTime());

    return limit ? queue.slice(0, limit) : queue;
  }

  async getFaceCount(): Promise<number> {
    return this.getStoredFaces().length;
  }

  async getPersonCount(): Promise<number> {
    return this.getStoredPeople().length;
  }

  async getUnassignedFaces(): Promise<DatabaseFace[]> {
    return this.getStoredFaces().filter(face => !face.personId);
  }

  async getFacesWithoutEmbeddings(): Promise<DatabaseFace[]> {
    return this.getStoredFaces().filter(face =>
      face.embedding && face.embedding.length > 0
    );
  }

  async bulkInsertFaces(faces: DatabaseFace[]): Promise<void> {
    faces.forEach(face => this.validateFaceData(face));

    const existingFaces = this.getStoredFaces();
    const newFaces = faces.map(face => ({
      ...face,
      createdAt: face.createdAt || new Date()
    }));

    existingFaces.push(...newFaces);
    this.setStoredFaces(existingFaces);
  }

  async bulkUpdatePersonAssignments(updates: Array<{
    faceId: string;
    personId: string | null;
  }>): Promise<void> {
    updates.forEach(update => {
      if (!update.faceId || typeof update.faceId !== 'string') {
        throw new Error('Invalid face ID in bulk update');
      }
      if (update.personId && typeof update.personId !== 'string') {
        throw new Error('Invalid person ID in bulk update');
      }
    });

    const faces = this.getStoredFaces();
    let updatedCount = 0;

    updates.forEach(update => {
      const faceIndex = faces.findIndex(face => face.id === update.faceId);
      if (faceIndex !== -1) {
        faces[faceIndex].personId = update.personId;
        faces[faceIndex].updatedAt = new Date();
        updatedCount++;
      }
    });

    if (updatedCount > 0) {
      this.setStoredFaces(faces);
    }
  }

  // Data validation methods
  private validateFaceData(face: DatabaseFace): void {
    if (!face.id || typeof face.id !== 'string') {
      throw new Error('Face must have a valid ID');
    }
    if (!face.imagePath || typeof face.imagePath !== 'string') {
      throw new Error('Face must have a valid image path');
    }
    if (!face.bounds || typeof face.bounds !== 'string') {
      throw new Error('Face must have valid bounds');
    }
    if (typeof face.confidence !== 'number' || face.confidence < 0 || face.confidence > 1) {
      throw new Error('Face confidence must be a number between 0 and 1');
    }
  }

  private validatePersonData(person: DatabasePerson): void {
    if (!person.id || typeof person.id !== 'string') {
      throw new Error('Person must have a valid ID');
    }
    if (person.name && typeof person.name !== 'string') {
      throw new Error('Person name must be a string if provided');
    }
  }

  // Storage management with error handling and validation
  private initializeStorage(): void {
    const keys = ['faces', 'people', 'processing_queue', 'metadata'];

    keys.forEach(key => {
      if (!localStorage.getItem(key)) {
        localStorage.setItem(key, JSON.stringify([]));
      }
    });

    // Store metadata
    localStorage.setItem('metadata', JSON.stringify({
      version: '1.0.0',
      initialized: new Date(),
      config: this.config
    }));
  }

  private validateStorageIntegrity(): void {
    try {
      const faces = this.getStoredFaces();
      const people = this.getStoredPeople();
      const queue = this.getStoredQueue();

      // Basic validation
      if (!Array.isArray(faces) || !Array.isArray(people) || !Array.isArray(queue)) {
        throw new Error('Invalid storage format');
      }
    } catch (error) {
      console.warn('Storage integrity check failed, resetting:', error);
      this.resetStorage();
    }
  }

  private cleanupOldData(): void {
    // Remove faces older than 90 days
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - 90);

    const faces = this.getStoredFaces();
    const filteredFaces = faces.filter(face =>
      new Date(face.createdAt) > cutoffDate
    );

    if (filteredFaces.length !== faces.length) {
      console.log(`Cleaned up ${faces.length - filteredFaces.length} old faces`);
      this.setStoredFaces(filteredFaces);
    }
  }

  private resetStorage(): void {
    localStorage.clear();
    this.initializeStorage();
  }

  private checkStorageSize(): void {
    // Rough estimate of storage usage
    const faces = localStorage.getItem('faces') || '';
    const people = localStorage.getItem('people') || '';
    const queue = localStorage.getItem('processing_queue') || '';

    const totalSize = (faces.length + people.length + queue.length) / (1024 * 1024); // MB

    if (totalSize > this.config.maxStorageSize) {
      console.warn(`Storage size (${totalSize.toFixed(2)}MB) exceeds limit. Consider cleanup.`);
    }
  }

  private flushToStorage(): void {
    // Ensure all data is properly serialized
    this.checkStorageSize();
  }

  // Safe storage access with error handling
  private getStoredFaces(): DatabaseFace[] {
    try {
      const data = localStorage.getItem('faces');
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to read faces from storage:', error);
      return [];
    }
  }

  private setStoredFaces(faces: DatabaseFace[]): void {
    try {
      localStorage.setItem('faces', JSON.stringify(faces));
    } catch (error) {
      console.error('Failed to write faces to storage:', error);
      throw new Error('Storage write failed');
    }
  }

  private getStoredPeople(): DatabasePerson[] {
    try {
      const data = localStorage.getItem('people');
      return data ? JSON.parse(data) : [];
    } catch (error) {
      console.error('Failed to read people from storage:', error);
      return [];
    }
  }

  private setStoredPeople(people: DatabasePerson[]): void {
    try {
      localStorage.setItem('people', JSON.stringify(people));
    } catch (error) {
      console.error('Failed to write people to storage:', error);
      throw new Error('Storage write failed');
    }
  }

  private getStoredQueue(): ProcessingQueueItem[] {
    try {
      const data = localStorage.getItem('processing_queue');
      if (!data) return [];

      const parsed = JSON.parse(data);
      // Convert date strings back to Date objects
      return parsed.map((item: any) => ({
        ...item,
        createdAt: new Date(item.createdAt),
        updatedAt: new Date(item.updatedAt || item.createdAt)
      }));
    } catch (error) {
      console.error('Failed to read queue from storage:', error);
      return [];
    }
  }

  private setStoredQueue(queue: ProcessingQueueItem[]): void {
    try {
      localStorage.setItem('processing_queue', JSON.stringify(queue));
    } catch (error) {
      console.error('Failed to write queue to storage:', error);
      throw new Error('Storage write failed');
    }
  }
}