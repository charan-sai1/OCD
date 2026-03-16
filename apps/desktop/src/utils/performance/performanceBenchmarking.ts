export interface PerformanceMetrics {
  // Loading performance
  initialLoadTime: number;
  firstImageLoadTime: number;
  averageImageLoadTime: number;
  slowestImageLoadTime: number;
  fastestImageLoadTime: number;

  // Rendering performance
  initialRenderTime: number;
  gridRenderTime: number;
  scrollRenderTime: number;
  fps: number;

  // Memory performance
  peakMemoryUsage: number;
  averageMemoryUsage: number;
  cacheHitRate: number;
  cacheSize: number;

  // User experience
  timeToInteractive: number;
  largestContentfulPaint: number;
  cumulativeLayoutShift: number;

  // System performance
  cpuUsage: number;
  networkRequests: number;
  networkTransferSize: number;
}

export interface BenchmarkResult {
  metrics: PerformanceMetrics;
  recommendations: string[];
  score: number; // 0-100 performance score
  timestamp: number;
}

export class PerformanceBenchmarker {
  private static instance: PerformanceBenchmarker;
  private measurements: Map<string, number[]> = new Map();
  private observers: PerformanceObserver[] = [];
  private isRunning = false;

  private constructor() {}

  static getInstance(): PerformanceBenchmarker {
    if (!PerformanceBenchmarker.instance) {
      PerformanceBenchmarker.instance = new PerformanceBenchmarker();
    }
    return PerformanceBenchmarker.instance;
  }

  // Start comprehensive performance monitoring
  startMonitoring(): void {
    if (this.isRunning) return;

    this.isRunning = true;
    this.setupPerformanceObservers();
    this.recordInitialMetrics();
  }

  // Stop monitoring and generate report
  async stopMonitoring(): Promise<BenchmarkResult> {
    if (!this.isRunning) {
      throw new Error('Benchmarking not running');
    }

    this.isRunning = false;
    this.cleanupObservers();

    const metrics = await this.collectMetrics();
    const recommendations = this.generateRecommendations(metrics);
    const score = this.calculatePerformanceScore(metrics);

    return {
      metrics,
      recommendations,
      score,
      timestamp: Date.now()
    };
  }

  // Record a specific measurement
  recordMeasurement(name: string, value: number): void {
    if (!this.measurements.has(name)) {
      this.measurements.set(name, []);
    }
    this.measurements.get(name)!.push(value);
  }

  // Record image load timing
  recordImageLoad(imagePath: string, loadTime: number): void {
    this.recordMeasurement('imageLoadTimes', loadTime);
    this.recordMeasurement(`imageLoad_${imagePath}`, loadTime);
  }

  // Record scroll performance
  recordScrollEvent(scrollTime: number, fps: number): void {
    this.recordMeasurement('scrollTimes', scrollTime);
    this.recordMeasurement('fps', fps);
  }

  // Record memory usage
  recordMemoryUsage(memoryMB: number): void {
    this.recordMeasurement('memoryUsage', memoryMB);
  }

  // Record cache performance
  recordCacheHit(hit: boolean): void {
    this.recordMeasurement('cacheHits', hit ? 1 : 0);
  }

  private setupPerformanceObservers(): void {
    // Observe Largest Contentful Paint
    if ('PerformanceObserver' in window) {
      try {
        const lcpObserver = new PerformanceObserver((list) => {
          const entries = list.getEntries();
          const lastEntry = entries[entries.length - 1];
          this.recordMeasurement('lcp', lastEntry.startTime);
        });
        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });
        this.observers.push(lcpObserver);
      } catch (e) {
        console.warn('LCP observer not supported');
      }

      // Observe Layout Shifts
      try {
        const clsObserver = new PerformanceObserver((list) => {
          let clsValue = 0;
          for (const entry of list.getEntries()) {
            if (!(entry as any).hadRecentInput) {
              clsValue += (entry as any).value;
            }
          }
          this.recordMeasurement('cls', clsValue);
        });
        clsObserver.observe({ entryTypes: ['layout-shift'] });
        this.observers.push(clsObserver);
      } catch (e) {
        console.warn('CLS observer not supported');
      }

      // Observe Navigation Timing
      try {
        const navigationObserver = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            if (entry.entryType === 'navigation') {
              const navEntry = entry as PerformanceNavigationTiming;
              this.recordMeasurement('navigationTiming', navEntry.loadEventEnd - navEntry.fetchStart);
            }
          }
        });
        navigationObserver.observe({ entryTypes: ['navigation'] });
        this.observers.push(navigationObserver);
      } catch (e) {
        console.warn('Navigation observer not supported');
      }
    }
  }

  private recordInitialMetrics(): void {
    // Record initial memory usage
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      this.recordMemoryUsage(memInfo.usedJSHeapSize / (1024 * 1024));
    }

    // Record initial timestamp
    this.recordMeasurement('initialTimestamp', performance.now());
  }

  private cleanupObservers(): void {
    this.observers.forEach(observer => {
      try {
        observer.disconnect();
      } catch (e) {
        // Ignore cleanup errors
      }
    });
    this.observers = [];
  }

  private async collectMetrics(): Promise<PerformanceMetrics> {
    const imageLoadTimes = this.measurements.get('imageLoadTimes') || [];
    const fpsMeasurements = this.measurements.get('fps') || [];
    const memoryMeasurements = this.measurements.get('memoryUsage') || [];
    const cacheHits = this.measurements.get('cacheHits') || [];

    // Calculate cache hit rate
    const totalCacheRequests = cacheHits.length;
    const cacheHitRate = totalCacheRequests > 0 ?
      (cacheHits.reduce((sum, hit) => sum + hit, 0) / totalCacheRequests) : 0;

    return {
      // Loading performance
      initialLoadTime: this.getMeasurement('navigationTiming') || 0,
      firstImageLoadTime: imageLoadTimes.length > 0 ? Math.min(...imageLoadTimes) : 0,
      averageImageLoadTime: imageLoadTimes.length > 0 ? imageLoadTimes.reduce((a, b) => a + b, 0) / imageLoadTimes.length : 0,
      slowestImageLoadTime: imageLoadTimes.length > 0 ? Math.max(...imageLoadTimes) : 0,
      fastestImageLoadTime: imageLoadTimes.length > 0 ? Math.min(...imageLoadTimes) : 0,

      // Rendering performance
      initialRenderTime: this.getMeasurement('initialTimestamp') || 0,
      gridRenderTime: this.getAverageMeasurement('scrollTimes'),
      scrollRenderTime: this.getAverageMeasurement('scrollTimes'),
      fps: fpsMeasurements.length > 0 ? fpsMeasurements.reduce((a, b) => a + b, 0) / fpsMeasurements.length : 60,

      // Memory performance
      peakMemoryUsage: memoryMeasurements.length > 0 ? Math.max(...memoryMeasurements) : 0,
      averageMemoryUsage: this.getAverageMeasurement('memoryUsage'),
      cacheHitRate,
      cacheSize: await this.getCacheSize(),

      // User experience
      timeToInteractive: this.getMeasurement('tti') || 0,
      largestContentfulPaint: this.getMeasurement('lcp') || 0,
      cumulativeLayoutShift: this.getMeasurement('cls') || 0,

      // System performance
      cpuUsage: await this.measureCpuUsage(),
      networkRequests: await this.countNetworkRequests(),
      networkTransferSize: await this.measureNetworkTransfer()
    };
  }

  private generateRecommendations(metrics: PerformanceMetrics): string[] {
    const recommendations: string[] = [];

    // Image loading recommendations
    if (metrics.averageImageLoadTime > 2000) {
      recommendations.push('Consider implementing more aggressive preloading for better image load times');
    }

    if (metrics.slowestImageLoadTime > 5000) {
      recommendations.push('Some images are loading very slowly - check network conditions or image sizes');
    }

    // Rendering recommendations
    if (metrics.fps < 50) {
      recommendations.push('Low FPS detected - consider reducing animation complexity or implementing virtualization');
    }

    // Memory recommendations
    if (metrics.peakMemoryUsage > 500) {
      recommendations.push('High memory usage detected - consider implementing more aggressive cache cleanup');
    }

    if (metrics.cacheHitRate < 0.7) {
      recommendations.push('Low cache hit rate - consider increasing cache size or improving cache strategy');
    }

    // User experience recommendations
    if (metrics.cumulativeLayoutShift > 0.1) {
      recommendations.push('High layout shift detected - ensure proper image aspect ratios and loading placeholders');
    }

    if (metrics.largestContentfulPaint > 2500) {
      recommendations.push('Slow LCP detected - optimize the loading of the largest content element');
    }

    return recommendations;
  }

  private calculatePerformanceScore(metrics: PerformanceMetrics): number {
    let score = 100;

    // Image loading (30% weight)
    const imageScore = Math.max(0, 100 - (metrics.averageImageLoadTime / 50)); // Penalize >2s average
    score = score * 0.7 + imageScore * 0.3;

    // Rendering performance (25% weight)
    const renderScore = Math.min(100, metrics.fps * 2); // FPS-based score
    score = score * 0.75 + renderScore * 0.25;

    // Memory efficiency (20% weight)
    const memoryScore = Math.max(0, 100 - (metrics.peakMemoryUsage / 10)); // Penalize >1GB
    score = score * 0.8 + memoryScore * 0.2;

    // Cache efficiency (15% weight)
    const cacheScore = metrics.cacheHitRate * 100;
    score = score * 0.85 + cacheScore * 0.15;

    // User experience (10% weight)
    const uxScore = Math.max(0, 100 - (metrics.cumulativeLayoutShift * 1000));
    score = score * 0.9 + uxScore * 0.1;

    return Math.round(Math.max(0, Math.min(100, score)));
  }

  private getMeasurement(name: string): number | undefined {
    const measurements = this.measurements.get(name);
    return measurements && measurements.length > 0 ? measurements[measurements.length - 1] : undefined;
  }

  private getAverageMeasurement(name: string): number {
    const measurements = this.measurements.get(name) || [];
    return measurements.length > 0 ?
      measurements.reduce((a, b) => a + b, 0) / measurements.length : 0;
  }

  private async getCacheSize(): Promise<number> {
    try {
      // This would need to be implemented based on your cache system
      // For now, return a placeholder
      return 50; // MB
    } catch {
      return 0;
    }
  }

  private async measureCpuUsage(): Promise<number> {
    // Simple CPU measurement - in practice you'd use more sophisticated monitoring
    return 30; // Placeholder
  }

  private async countNetworkRequests(): Promise<number> {
    try {
      const entries = performance.getEntriesByType('resource');
      return entries.length;
    } catch {
      return 0;
    }
  }

  private async measureNetworkTransfer(): Promise<number> {
    try {
      const entries = performance.getEntriesByType('resource') as PerformanceResourceTiming[];
      return entries.reduce((total, entry) => {
        return total + (entry.transferSize || 0);
      }, 0);
    } catch {
      return 0;
    }
  }

  // Utility method to run a benchmark test
  async runBenchmark(durationMs: number = 10000): Promise<BenchmarkResult> {
    console.log('Starting performance benchmark...');

    this.startMonitoring();

    // Simulate some activity
    await new Promise(resolve => setTimeout(resolve, durationMs));

    const result = await this.stopMonitoring();

    console.log('Benchmark complete:', result);
    return result;
  }
}

// Singleton instance
export const performanceBenchmarker = PerformanceBenchmarker.getInstance();