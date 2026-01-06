interface PredictedImage {
  imagePath: string;
  confidence: number; // 0.0 to 1.0
  expectedTimeToNeed: number; // milliseconds
  size?: number; // estimated size in bytes
}

interface LoadTask {
  imagePath: string;
  priority: 'high' | 'normal' | 'low';
  confidence: number;
  estimatedLoadTime: number;
  systemPriority: 'background' | 'normal' | 'foreground';
  createdAt: number;
  retries: number;
}

interface QueueStats {
  pendingTasks: number;
  activeTasks: number;
  completedTasks: number;
  failedTasks: number;
  averageWaitTime: number;
  averageLoadTime: number;
}

class PredictiveLoadingQueue {
  private taskQueue: LoadTask[] = [];
  private activeTasks = new Map<string, LoadTask>();
  private completedTasks: LoadTask[] = [];
  private failedTasks: LoadTask[] = [];

  private readonly MAX_ACTIVE_TASKS = 3;
  private readonly MAX_QUEUE_SIZE = 20;
  private readonly MAX_RETRIES = 2;

  constructor() {
    this.startQueueProcessor();
  }

  // Add images to queue based on prediction results
  enqueueWithPrediction(images: PredictedImage[], basePriority: 'high' | 'normal' | 'low' = 'normal'): void {
    const now = Date.now();

    images.forEach(image => {
      // Skip if already in queue or active
      if (this.isInQueue(image.imagePath) || this.activeTasks.has(image.imagePath)) {
        return;
      }

      // Calculate priority based on confidence and time to need
      const priority = this.calculatePriority(image, basePriority);

      const task: LoadTask = {
        imagePath: image.imagePath,
        priority,
        confidence: image.confidence,
        estimatedLoadTime: image.expectedTimeToNeed,
        systemPriority: this.mapConfidenceToSystemPriority(image.confidence),
        createdAt: now,
        retries: 0
      };

      this.addTask(task);
    });

    // Sort queue by priority
    this.sortQueue();
  }

  // Process queue based on system resources
  async processQueueAdaptively(): Promise<void> {
    const { systemResourceManager } = await import('./systemResourceManager');
    const strategy = systemResourceManager.getAppropriateStrategy();
    const maxConcurrent = Math.min(strategy.maxConcurrentLoads, this.MAX_ACTIVE_TASKS);

    // Don't exceed system limits
    if (this.activeTasks.size >= maxConcurrent) {
      return;
    }

    // Get tasks that can be started
    const availableSlots = maxConcurrent - this.activeTasks.size;
    const tasksToStart = this.taskQueue.splice(0, availableSlots);

    // Start tasks
    const startPromises = tasksToStart.map(task => this.startTask(task));
    await Promise.allSettled(startPromises);
  }

  // Adjust priorities based on real-time user actions
  adjustPriorities(currentPosition: number, _scrollDirection: 'up' | 'down' | 'left' | 'right'): void {
    // Re-prioritize tasks based on current user position and direction
    this.taskQueue.forEach(task => {
      const taskPriority = this.recalculatePriority(task, currentPosition);
      task.priority = taskPriority;
    });

    this.sortQueue();
  }

  // Cancel unlikely predictions
  cancelUnlikelyPredictions(): void {
    // Remove low-confidence tasks that are far from current position
    const now = Date.now();
    this.taskQueue = this.taskQueue.filter(task => {
      // Keep if high confidence or recently added
      const age = now - task.createdAt;
      return task.confidence > 0.6 || age < 5000; // Keep recent tasks
    });
  }

  // Get queue statistics
  getStats(): QueueStats {
    const allTasks = [...this.completedTasks, ...this.failedTasks];
    const waitTimes = allTasks.map(t => t.createdAt ? Date.now() - t.createdAt : 0);
    const loadTimes = this.completedTasks.map(t => t.estimatedLoadTime || 0);

    return {
      pendingTasks: this.taskQueue.length,
      activeTasks: this.activeTasks.size,
      completedTasks: this.completedTasks.length,
      failedTasks: this.failedTasks.length,
      averageWaitTime: waitTimes.length > 0 ? waitTimes.reduce((a, b) => a + b, 0) / waitTimes.length : 0,
      averageLoadTime: loadTimes.length > 0 ? loadTimes.reduce((a, b) => a + b, 0) / loadTimes.length : 0
    };
  }

  // Clear all queues (for testing or reset)
  clear(): void {
    this.taskQueue = [];
    this.activeTasks.clear();
    this.completedTasks = [];
    this.failedTasks = [];
  }

  private addTask(task: LoadTask): void {
    // Don't exceed queue size
    if (this.taskQueue.length >= this.MAX_QUEUE_SIZE) {
      // Remove lowest priority task
      this.taskQueue.sort((a, b) => this.getPriorityScore(b) - this.getPriorityScore(a));
      this.taskQueue.pop();
    }

    this.taskQueue.push(task);
  }

  private sortQueue(): void {
    this.taskQueue.sort((a, b) => this.getPriorityScore(b) - this.getPriorityScore(a));
  }

  private getPriorityScore(task: LoadTask): number {
    const priorityScores = { high: 3, normal: 2, low: 1 };
    const confidenceScore = task.confidence;
    const agePenalty = (Date.now() - task.createdAt) / 10000; // Slight penalty for older tasks

    return priorityScores[task.priority] + confidenceScore - agePenalty;
  }

  private calculatePriority(image: PredictedImage, basePriority: 'high' | 'normal' | 'low'): 'high' | 'normal' | 'low' {
    // High confidence = higher priority
    if (image.confidence > 0.8) {
      return 'high';
    }

    // Short time to need = higher priority
    if (image.expectedTimeToNeed < 2000) {
      return basePriority === 'low' ? 'normal' : 'high';
    }

    // Medium time = normal priority
    if (image.expectedTimeToNeed < 5000) {
      return 'normal';
    }

    // Long time = lower priority
    return 'low';
  }

  private mapConfidenceToSystemPriority(confidence: number): 'background' | 'normal' | 'foreground' {
    if (confidence > 0.8) return 'foreground';
    if (confidence > 0.6) return 'normal';
    return 'background';
  }

  private recalculatePriority(task: LoadTask, currentPosition: number): 'high' | 'normal' | 'low' {
    // Extract position from image path (assuming format: "image_X")
    const taskPosition = this.extractPositionFromPath(task.imagePath);
    if (taskPosition === null) return task.priority;

    const distance = Math.abs(taskPosition - currentPosition);

    // Adjust priority based on distance and scroll direction
    if (distance === 0) return 'high'; // Currently viewing
    if (distance === 1) return 'high'; // Next image
    if (distance === 2) return 'normal'; // 2 images away
    if (distance <= 5) return 'low'; // Within 5 images

    // Far away - very low priority
    return 'low';
  }

  private extractPositionFromPath(imagePath: string): number | null {
    // Extract number from "image_X" format
    const match = imagePath.match(/image_(\d+)/);
    return match ? parseInt(match[1], 10) : null;
  }

  private async startTask(task: LoadTask): Promise<void> {
    if (this.activeTasks.has(task.imagePath)) {
      return; // Already active
    }

    this.activeTasks.set(task.imagePath, task);

    try {
      // Simulate loading (in real implementation, this would load the actual image)
      await this.loadImage(task);

      // Mark as completed
      this.activeTasks.delete(task.imagePath);
      this.completedTasks.push(task);

      // Keep only recent completed tasks
      if (this.completedTasks.length > 50) {
        this.completedTasks = this.completedTasks.slice(-50);
      }

    } catch (error) {
      console.warn(`Failed to load ${task.imagePath}:`, error);

      // Retry logic
      if (task.retries < this.MAX_RETRIES) {
        task.retries++;
        task.createdAt = Date.now(); // Reset timestamp for retry
        this.addTask(task); // Re-queue
      } else {
        // Mark as failed
        this.failedTasks.push(task);
        // Keep only recent failed tasks
        if (this.failedTasks.length > 20) {
          this.failedTasks = this.failedTasks.slice(-20);
        }
      }

      this.activeTasks.delete(task.imagePath);
    }
  }

  private async loadImage(task: LoadTask): Promise<void> {
    // Simulate network delay based on task priority
    const delay = task.priority === 'high' ? 100 : task.priority === 'normal' ? 300 : 800;
    await new Promise(resolve => setTimeout(resolve, delay));

    // In real implementation, this would:
    // 1. Check cache
    // 2. Load from disk/network if needed
    // 3. Update cache
    // 4. Notify completion

    console.log(`Loaded ${task.imagePath} with priority ${task.priority}`);
  }

  private isInQueue(imagePath: string): boolean {
    return this.taskQueue.some(task => task.imagePath === imagePath);
  }

  private startQueueProcessor(): void {
    // Process queue every 500ms
    setInterval(() => {
      this.processQueueAdaptively();
    }, 500);
  }
}

// Singleton instance
export const predictiveLoadingQueue = new PredictiveLoadingQueue();
export type { PredictedImage, LoadTask, QueueStats };