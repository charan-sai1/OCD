interface ResourceBudget {
  memoryMB: number;
  cpuPriority: 'low' | 'normal' | 'high' | 'critical';
  networkPriority: 'background' | 'normal' | 'foreground';
  batteryAware: boolean;
}

interface SystemMetrics {
  memoryPressure: 'normal' | 'warning' | 'critical';
  cpuUsage: number; // 0-100
  batteryLevel: number; // 0-100, -1 if unknown
  networkQuality: 'poor' | 'fair' | 'good' | 'excellent';
  isLowPowerMode: boolean;
}

interface LoadingStrategy {
  maxConcurrentLoads: number;
  preloadDistance: number; // How many images ahead to preload
  memoryBudgetRatio: number; // Percentage of available memory to use
  backgroundPriority: boolean;
  adaptiveQuality: boolean;
}

class SystemResourceManager {
  private currentMetrics: SystemMetrics;
  private resourceBudget: ResourceBudget;
  private monitoringInterval: number | null = null;
  private budgetUpdateCallbacks: ((budget: ResourceBudget) => void)[] = [];

  constructor() {
    this.currentMetrics = this.getInitialMetrics();
    this.resourceBudget = this.calculateResourceBudget();
    this.startMonitoring();
  }

  // Get current resource budget for the app
  getResourceBudget(): ResourceBudget {
    return { ...this.resourceBudget };
  }

  // Get appropriate loading strategy based on current system state
  getAppropriateStrategy(): LoadingStrategy {
    const metrics = this.currentMetrics;
    const baseStrategy: LoadingStrategy = {
      maxConcurrentLoads: 2,
      preloadDistance: 2,
      memoryBudgetRatio: 0.6, // Use 60% of available memory
      backgroundPriority: true,
      adaptiveQuality: true
    };

    // Adjust based on memory pressure
    switch (metrics.memoryPressure) {
      case 'critical':
        return {
          ...baseStrategy,
          maxConcurrentLoads: 0, // Stop background loading
          preloadDistance: 0,
          memoryBudgetRatio: 0.3,
          backgroundPriority: false
        };

      case 'warning':
        return {
          ...baseStrategy,
          maxConcurrentLoads: 1,
          preloadDistance: 1,
          memoryBudgetRatio: 0.4
        };

      case 'normal':
      default:
        // Check battery and CPU
        if (metrics.batteryLevel > 0 && metrics.batteryLevel < 20) {
          // Low battery - be conservative
          return {
            ...baseStrategy,
            maxConcurrentLoads: 1,
            preloadDistance: 1,
            memoryBudgetRatio: 0.5
          };
        }

        if (metrics.cpuUsage > 80) {
          // High CPU usage - reduce load
          return {
            ...baseStrategy,
            maxConcurrentLoads: 1,
            preloadDistance: 2
          };
        }

        // Normal conditions - optimal loading
        return {
          ...baseStrategy,
          maxConcurrentLoads: 3,
          preloadDistance: 3,
          memoryBudgetRatio: 0.7
        };
    }
  }

  // Check if system can handle additional loading
  canLoadMore(estimatedSize: number = 0): boolean {
    const budget = this.resourceBudget;
    const currentUsage = this.estimateCurrentMemoryUsage();

    // Leave 20% buffer for system stability
    const availableMemory = budget.memoryMB * 0.8;

    return currentUsage + estimatedSize < availableMemory;
  }

  // Register callback for budget updates
  onBudgetUpdate(callback: (budget: ResourceBudget) => void): () => void {
    this.budgetUpdateCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.budgetUpdateCallbacks.indexOf(callback);
      if (index > -1) {
        this.budgetUpdateCallbacks.splice(index, 1);
      }
    };
  }

  // Get current system metrics
  getCurrentMetrics(): SystemMetrics {
    return { ...this.currentMetrics };
  }

  private getInitialMetrics(): SystemMetrics {
    return {
      memoryPressure: this.detectMemoryPressure(),
      cpuUsage: this.estimateCpuUsage(),
      batteryLevel: this.getBatteryLevel(),
      networkQuality: this.detectNetworkQuality(),
      isLowPowerMode: this.detectLowPowerMode()
    };
  }

  private calculateResourceBudget(): ResourceBudget {
    const metrics = this.currentMetrics;

    // Base calculations
    const baseMemoryMB = this.calculateBaseMemoryBudget();
    const adjustedMemoryMB = this.adjustMemoryForConditions(baseMemoryMB, metrics);

    return {
      memoryMB: adjustedMemoryMB,
      cpuPriority: this.calculateCpuPriority(metrics),
      networkPriority: this.calculateNetworkPriority(metrics),
      batteryAware: metrics.batteryLevel > 0 && metrics.batteryLevel < 30
    };
  }

  private calculateBaseMemoryBudget(): number {
    // Apple's philosophy: use what's available but leave room for system
    const availableMemory = this.getAvailableMemoryMB();

    if (availableMemory <= 1024) { // Low memory system (1GB)
      return Math.max(50, availableMemory * 0.3); // 30% of available, min 50MB
    } else if (availableMemory <= 4096) { // Standard system (4GB)
      return Math.max(100, availableMemory * 0.4); // 40% of available, min 100MB
    } else { // High memory system (8GB+)
      return Math.max(200, availableMemory * 0.5); // 50% of available, min 200MB
    }
  }

  private adjustMemoryForConditions(baseMemory: number, metrics: SystemMetrics): number {
    let multiplier = 1.0;

    // Reduce based on memory pressure
    switch (metrics.memoryPressure) {
      case 'warning':
        multiplier *= 0.7;
        break;
      case 'critical':
        multiplier *= 0.3;
        break;
    }

    // Reduce based on battery level
    if (metrics.batteryLevel > 0 && metrics.batteryLevel < 20) {
      multiplier *= 0.6;
    }

    // Reduce based on CPU usage
    if (metrics.cpuUsage > 70) {
      multiplier *= 0.8;
    }

    return Math.max(30, baseMemory * multiplier); // Minimum 30MB
  }

  private calculateCpuPriority(metrics: SystemMetrics): 'low' | 'normal' | 'high' | 'critical' {
    if (metrics.memoryPressure === 'critical' || metrics.cpuUsage > 90) {
      return 'low';
    }

    if (metrics.memoryPressure === 'warning' || metrics.cpuUsage > 70) {
      return 'normal';
    }

    if (metrics.batteryLevel > 0 && metrics.batteryLevel < 15) {
      return 'normal';
    }

    return 'high';
  }

  private calculateNetworkPriority(metrics: SystemMetrics): 'background' | 'normal' | 'foreground' {
    if (metrics.networkQuality === 'poor') {
      return 'background';
    }

    if (metrics.memoryPressure === 'critical') {
      return 'background';
    }

    return 'foreground';
  }

  private detectMemoryPressure(): 'normal' | 'warning' | 'critical' {
    // Check available memory
    const availableMemory = this.getAvailableMemoryMB();
    const totalMemory = this.getTotalMemoryMB();

    if (totalMemory === 0) return 'normal'; // Can't detect

    const usageRatio = (totalMemory - availableMemory) / totalMemory;

    if (usageRatio > 0.9) return 'critical'; // >90% memory used
    if (usageRatio > 0.75) return 'warning';  // >75% memory used

    return 'normal';
  }

  private estimateCpuUsage(): number {
    // Simple estimation - in a real app, you'd use more sophisticated monitoring
    // For now, return a conservative estimate
    return 30; // Assume 30% CPU usage as baseline
  }

  private getBatteryLevel(): number {
    try {
      // Modern browsers support battery API
      if ('getBattery' in navigator) {
        // Note: This is async in real implementation
        return 80; // Placeholder - would need async handling
      }
    } catch (error) {
      // Battery API not supported
    }

    return -1; // Unknown
  }

  private detectNetworkQuality(): 'poor' | 'fair' | 'good' | 'excellent' {
    try {
      if ('connection' in navigator) {
        const connection = (navigator as any).connection;
        const effectiveType = connection?.effectiveType;

        switch (effectiveType) {
          case 'slow-2g':
          case '2g':
            return 'poor';
          case '3g':
            return 'fair';
          case '4g':
            return 'good';
          default:
            return 'excellent';
        }
      }
    } catch (error) {
      // Network API not supported
    }

    return 'good'; // Default assumption
  }

  private detectLowPowerMode(): boolean {
    // iOS Safari has low power mode detection, but not cross-platform
    // For now, assume false
    return false;
  }

  private getAvailableMemoryMB(): number {
    // Try to detect available memory
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      const usedMB = memInfo.usedJSHeapSize / (1024 * 1024);
      const totalMB = memInfo.totalJSHeapSize / (1024 * 1024);

      // Estimate available as total - used (very rough)
      return Math.max(100, totalMB - usedMB);
    }

    // Fallback estimates based on device type
    if (window.innerWidth < 768) {
      return 200; // Mobile devices - assume limited memory
    } else {
      return 500; // Desktop - assume more memory available
    }
  }

  private getTotalMemoryMB(): number {
    if ('memory' in performance) {
      return (performance as any).memory.totalJSHeapSize / (1024 * 1024);
    }

    // Fallback estimates
    if (window.innerWidth < 768) {
      return 512; // Mobile devices - assume 512MB heap
    } else {
      return 1024; // Desktop - assume 1GB heap
    }
  }

  private estimateCurrentMemoryUsage(): number {
    // Rough estimate - in practice, you'd track actual usage
    // This is a placeholder for the concept
    return 50; // Assume 50MB current usage
  }

  private startMonitoring(): void {
    // Update metrics every 5 seconds
    this.monitoringInterval = window.setInterval(() => {
      const oldMetrics = { ...this.currentMetrics };
      this.currentMetrics = {
        memoryPressure: this.detectMemoryPressure(),
        cpuUsage: this.estimateCpuUsage(),
        batteryLevel: this.getBatteryLevel(),
        networkQuality: this.detectNetworkQuality(),
        isLowPowerMode: this.detectLowPowerMode()
      };

      // Check if budget needs recalculation
      const needsUpdate = this.metricsChangedSignificantly(oldMetrics, this.currentMetrics);

      if (needsUpdate) {
        this.resourceBudget = this.calculateResourceBudget();
        this.notifyBudgetUpdate();
      }
    }, 5000); // Update every 5 seconds
  }

  private metricsChangedSignificantly(old: SystemMetrics, current: SystemMetrics): boolean {
    return old.memoryPressure !== current.memoryPressure ||
           Math.abs(old.cpuUsage - current.cpuUsage) > 20 ||
           (old.batteryLevel !== current.batteryLevel && current.batteryLevel > 0);
  }

  private notifyBudgetUpdate(): void {
    this.budgetUpdateCallbacks.forEach(callback => {
      try {
        callback(this.resourceBudget);
      } catch (error) {
        console.warn('Budget update callback failed:', error);
      }
    });
  }

  // Cleanup
  destroy(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }
    this.budgetUpdateCallbacks = [];
  }
}

// Singleton instance
export const systemResourceManager = new SystemResourceManager();
export type { ResourceBudget, SystemMetrics, LoadingStrategy };