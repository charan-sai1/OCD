interface DelayedLoadConfig {
  effectType: 'none' | 'cascade' | 'wave' | 'spiral' | 'random';
  baseDelay: number;        // Base delay before any image loads (ms)
  cascadeDelay: number;     // Delay between sequential images (ms)
  fadeInDuration: number;   // Time for fade-in animation (ms)
  staggerRows: boolean;     // Whether to stagger row by row
  priorityBasedDelay: boolean; // Higher priority = shorter delay
  scrollBasedAdjustment: boolean; // Adjust delays based on scroll velocity
  maxConcurrentLoads: number; // Maximum images loading simultaneously
}

interface DelayedLoadTask {
  imagePath: string;
  delay: number;
  priority: 'high' | 'normal' | 'low';
  position: { row: number; col: number };
  fadeInDuration: number;
  createdAt: number;
  timeoutId?: NodeJS.Timeout;
}

interface LoadingStats {
  pendingTasks: number;
  activeTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  averageDelay: number;
  totalLoadTime: number;
}

class DelayedImageLoader {
  private config: DelayedLoadConfig;
  private pendingTasks: DelayedLoadTask[] = [];
  private activeTasks = new Map<string, DelayedLoadTask>();
  private completedTasks: DelayedLoadTask[] = [];
  private cancelledTasks: DelayedLoadTask[] = [];
  private loadCallbacks = new Map<string, ((success: boolean) => void)[]>();
  private scrollVelocity = 0;
  private currentRowIndex = 0;

  constructor(config: DelayedLoadConfig) {
    this.config = { ...config };
  }

  // Update configuration dynamically
  updateConfig(newConfig: Partial<DelayedLoadConfig>): void {
    this.config = { ...this.config, ...newConfig };
  }

  // Schedule a delayed load for an image
  scheduleLoad(
    imagePath: string,
    position: { row: number; col: number },
    priority: 'high' | 'normal' | 'low' = 'normal',
    onComplete?: (success: boolean) => void
  ): void {
    // Cancel existing task for this image if any
    this.cancelLoad(imagePath);

    // Calculate delay based on configuration
    const delay = this.calculateDelay(position, priority);

    const task: DelayedLoadTask = {
      imagePath,
      delay,
      priority,
      position,
      fadeInDuration: this.config.fadeInDuration,
      createdAt: Date.now()
    };

    // Register completion callback
    if (onComplete) {
      if (!this.loadCallbacks.has(imagePath)) {
        this.loadCallbacks.set(imagePath, []);
      }
      this.loadCallbacks.get(imagePath)!.push(onComplete);
    }

    // Schedule the delayed load
    task.timeoutId = setTimeout(() => {
      this.executeLoad(task);
    }, delay);

    this.pendingTasks.push(task);
  }

  // Cancel a scheduled load
  cancelLoad(imagePath: string): void {
    // Cancel pending task
    const pendingIndex = this.pendingTasks.findIndex(t => t.imagePath === imagePath);
    if (pendingIndex > -1) {
      const task = this.pendingTasks[pendingIndex];
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
      this.pendingTasks.splice(pendingIndex, 1);
      this.cancelledTasks.push(task);
    }

    // Cancel active task
    if (this.activeTasks.has(imagePath)) {
      const task = this.activeTasks.get(imagePath)!;
      this.activeTasks.delete(imagePath);
      this.cancelledTasks.push(task);
    }
  }

  // Execute the actual loading (called after delay)
  private async executeLoad(task: DelayedLoadTask): Promise<void> {
    // Remove from pending
    const pendingIndex = this.pendingTasks.findIndex(t => t.imagePath === task.imagePath);
    if (pendingIndex > -1) {
      this.pendingTasks.splice(pendingIndex, 1);
    }

    // Check if we can load (respect max concurrent limit)
    if (this.activeTasks.size >= this.config.maxConcurrentLoads) {
      // Re-queue with slight delay
      setTimeout(() => this.executeLoad(task), 100);
      return;
    }

    // Add to active tasks
    this.activeTasks.set(task.imagePath, task);

    try {
      // In a real implementation, this would trigger the actual image loading
      // For now, simulate the loading process
      await this.simulateImageLoad(task);

      // Mark as completed
      this.activeTasks.delete(task.imagePath);
      this.completedTasks.push(task);

      // Notify callbacks
      const callbacks = this.loadCallbacks.get(task.imagePath);
      if (callbacks) {
        callbacks.forEach(callback => callback(true));
        this.loadCallbacks.delete(task.imagePath);
      }

    } catch (error) {
      console.warn(`Failed to load image ${task.imagePath}:`, error);

      // Mark as failed/cancelled
      this.activeTasks.delete(task.imagePath);
      this.cancelledTasks.push(task);

      // Notify callbacks with failure
      const callbacks = this.loadCallbacks.get(task.imagePath);
      if (callbacks) {
        callbacks.forEach(callback => callback(false));
        this.loadCallbacks.delete(task.imagePath);
      }
    }
  }

  // Calculate delay based on configuration and parameters
  private calculateDelay(position: { row: number; col: number }, priority: 'high' | 'normal' | 'low'): number {
    let delay = this.config.baseDelay;

    // Effect type adjustments
    switch (this.config.effectType) {
      case 'cascade':
        // Row-based cascading
        if (this.config.staggerRows) {
          const rowDelay = (position.row - this.currentRowIndex) * this.config.cascadeDelay;
          delay += Math.max(0, rowDelay);
        }
        break;

      case 'wave':
        // Wave pattern: alternating rows
        const waveOffset = position.row % 2 === 0 ? 0 : this.config.cascadeDelay / 2;
        delay += position.col * (this.config.cascadeDelay / 3) + waveOffset;
        break;

      case 'spiral':
        // Spiral from center outward
        const centerRow = 2; // Approximate center
        const centerCol = 3;
        const distanceFromCenter = Math.abs(position.row - centerRow) + Math.abs(position.col - centerCol);
        delay += distanceFromCenter * this.config.cascadeDelay;
        break;

      case 'random':
        // Random but controlled delay
        const randomOffset = Math.random() * this.config.cascadeDelay;
        delay += randomOffset;
        break;

      case 'none':
      default:
        // No additional delay
        break;
    }

    // Priority-based adjustments
    if (this.config.priorityBasedDelay) {
      if (priority === 'high') {
        delay *= 0.5; // 50% faster for high priority
      } else if (priority === 'low') {
        delay *= 1.5; // 50% slower for low priority
      }
    }

    // Scroll velocity adjustments
    if (this.config.scrollBasedAdjustment && this.scrollVelocity > 50) {
      // Fast scrolling = shorter delays
      delay *= Math.max(0.3, 1 - (this.scrollVelocity - 50) / 200);
    }

    return Math.max(0, delay);
  }

  // Update scroll velocity for adaptive delays
  updateScrollVelocity(velocity: number): void {
    this.scrollVelocity = velocity;
  }

  // Update current row context for cascading effects
  updateCurrentRow(rowIndex: number): void {
    this.currentRowIndex = rowIndex;
  }

  // Get loading statistics
  getStats(): LoadingStats {
    const delays = this.completedTasks.map(t => t.delay);

    return {
      pendingTasks: this.pendingTasks.length,
      activeTasks: this.activeTasks.size,
      completedTasks: this.completedTasks.length,
      cancelledTasks: this.cancelledTasks.length,
      averageDelay: delays.length > 0 ? delays.reduce((a, b) => a + b, 0) / delays.length : 0,
      totalLoadTime: this.completedTasks.reduce((sum, t) => sum + (Date.now() - t.createdAt - t.delay), 0)
    };
  }

  // Clear all pending and active tasks
  clear(): void {
    // Clear timeouts
    this.pendingTasks.forEach(task => {
      if (task.timeoutId) {
        clearTimeout(task.timeoutId);
      }
    });

    this.pendingTasks = [];
    this.activeTasks.clear();
    this.completedTasks = [];
    this.cancelledTasks = [];
    this.loadCallbacks.clear();
  }

  // Simulate image loading (replace with actual loading logic)
  private async simulateImageLoad(task: DelayedLoadTask): Promise<void> {
    // Simulate network delay based on priority
    const baseDelay = task.priority === 'high' ? 50 : task.priority === 'normal' ? 150 : 300;
    const randomVariation = Math.random() * 50; // Add some randomness

    await new Promise(resolve => setTimeout(resolve, baseDelay + randomVariation));

    // In real implementation, this would trigger actual image loading
    console.log(`Loaded ${task.imagePath} with ${task.delay}ms delay (priority: ${task.priority})`);
  }

  // Get current configuration
  getConfig(): DelayedLoadConfig {
    return { ...this.config };
  }
}

// Singleton instance with default magical configuration
export const delayedImageLoader = new DelayedImageLoader({
  effectType: 'cascade',
  baseDelay: 100,         // 100ms base delay for magical feel
  cascadeDelay: 50,       // 50ms between images in cascade
  fadeInDuration: 300,    // 300ms smooth fade-in
  staggerRows: true,      // Row-by-row cascading
  priorityBasedDelay: true, // High priority loads faster
  scrollBasedAdjustment: true, // Adjust for scroll velocity
  maxConcurrentLoads: 3   // Don't overwhelm the system
});

export type { DelayedLoadConfig, DelayedLoadTask, LoadingStats };