import { DeviceCapabilities } from './deviceCapabilities';

interface PerformanceMetrics {
  thumbnailGenerationTime: number; // Average time per image in ms
  cacheHitRate: number;
  memoryUsage: number; // In MB
  scrollPerformance: number; // FPS
  deviceCapabilities: ReturnType<typeof DeviceCapabilities.detect>;
  timestamp: number;
}

interface ScrollMetrics {
  fps: number;
  averageFrameTime: number;
  droppedFrames: number;
}

class PerformanceMonitor {
  private metrics: PerformanceMetrics[] = [];
  private scrollMeasurements: number[] = [];
  private lastFrameTime = 0;
  private frameCount = 0;
  private startTime = 0;
  private isMonitoringScroll = false;

  recordThumbnailGeneration(duration: number, imageCount: number) {
    const metric: PerformanceMetrics = {
      thumbnailGenerationTime: duration / imageCount, // per image
      cacheHitRate: this.calculateCacheHitRate(),
      memoryUsage: this.getMemoryUsage(),
      scrollPerformance: this.getScrollPerformance(),
      deviceCapabilities: DeviceCapabilities.detect(),
      timestamp: Date.now()
    };

    this.metrics.push(metric);

    // Keep only last 100 measurements
    if (this.metrics.length > 100) {
      this.metrics = this.metrics.slice(-100);
    }

    console.log(`Performance: ${metric.thumbnailGenerationTime.toFixed(0)}ms per image, ${(metric.cacheHitRate * 100).toFixed(1)}% cache hit rate`);
  }

  startScrollMonitoring() {
    if (this.isMonitoringScroll) return;

    this.isMonitoringScroll = true;
    this.scrollMeasurements = [];
    this.frameCount = 0;
    this.startTime = performance.now();

    const measureScroll = (timestamp: number) => {
      if (!this.isMonitoringScroll) return;

      if (this.lastFrameTime > 0) {
        const frameTime = timestamp - this.lastFrameTime;
        this.scrollMeasurements.push(frameTime);
        this.frameCount++;
      }

      this.lastFrameTime = timestamp;

      // Stop after 10 seconds or 1000 measurements
      if (timestamp - this.startTime < 10000 && this.frameCount < 1000) {
        requestAnimationFrame(measureScroll);
      } else {
        this.isMonitoringScroll = false;
      }
    };

    requestAnimationFrame(measureScroll);
  }

  stopScrollMonitoring(): ScrollMetrics | null {
    this.isMonitoringScroll = false;

    if (this.scrollMeasurements.length === 0) return null;

    const averageFrameTime = this.scrollMeasurements.reduce((a, b) => a + b, 0) / this.scrollMeasurements.length;
    const fps = 1000 / averageFrameTime;

    // Calculate dropped frames (frames taking > 16.67ms at 60fps)
    const targetFrameTime = 1000 / 60;
    const droppedFrames = this.scrollMeasurements.filter(time => time > targetFrameTime * 1.5).length;

    return {
      fps: Math.min(fps, 60), // Cap at 60fps
      averageFrameTime,
      droppedFrames
    };
  }

  private calculateCacheHitRate(): number {
    // This would need to be tracked from the cache implementation
    // For now, return a placeholder based on recent metrics
    const recentMetrics = this.metrics.slice(-10);
    if (recentMetrics.length === 0) return 0.8; // Default assumption

    return recentMetrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / recentMetrics.length;
  }

  private getMemoryUsage(): number {
    if ('memory' in performance) {
      const memInfo = (performance as any).memory;
      return memInfo.usedJSHeapSize / (1024 * 1024); // Convert to MB
    }
    return 0;
  }

  private getScrollPerformance(): number {
    const scrollMetrics = this.stopScrollMonitoring();
    if (scrollMetrics) {
      this.startScrollMonitoring(); // Restart monitoring
      return scrollMetrics.fps;
    }

    // Return last known FPS or default
    const recentMetrics = this.metrics.slice(-5);
    if (recentMetrics.length > 0) {
      return recentMetrics.reduce((sum, m) => sum + m.scrollPerformance, 0) / recentMetrics.length;
    }

    return 60; // Default assumption
  }

  getAverageMetrics(): PerformanceMetrics {
    if (this.metrics.length === 0) {
      return {
        thumbnailGenerationTime: 0,
        cacheHitRate: 0,
        memoryUsage: 0,
        scrollPerformance: 60,
        deviceCapabilities: DeviceCapabilities.detect(),
        timestamp: Date.now()
      };
    }

    return {
      thumbnailGenerationTime: this.metrics.reduce((sum, m) => sum + m.thumbnailGenerationTime, 0) / this.metrics.length,
      cacheHitRate: this.metrics.reduce((sum, m) => sum + m.cacheHitRate, 0) / this.metrics.length,
      memoryUsage: Math.max(...this.metrics.map(m => m.memoryUsage)),
      scrollPerformance: this.metrics.reduce((sum, m) => sum + m.scrollPerformance, 0) / this.metrics.length,
      deviceCapabilities: this.metrics[this.metrics.length - 1].deviceCapabilities,
      timestamp: Date.now()
    };
  }

  getPerformanceReport(): {
    summary: PerformanceMetrics;
    recommendations: string[];
    bottlenecks: string[];
  } {
    const summary = this.getAverageMetrics();
    const recommendations: string[] = [];
    const bottlenecks: string[] = [];

    // Analyze thumbnail generation performance
    if (summary.thumbnailGenerationTime > 500) {
      bottlenecks.push('Slow thumbnail generation');
      recommendations.push('Consider reducing thumbnail quality or batch size');
    }

    // Analyze cache performance
    if (summary.cacheHitRate < 0.7) {
      bottlenecks.push('Low cache hit rate');
      recommendations.push('Increase cache size or pre-warm cache for frequently accessed images');
    }

    // Analyze memory usage
    if (summary.memoryUsage > 200) {
      bottlenecks.push('High memory usage');
      recommendations.push('Reduce cache size or implement more aggressive cleanup');
    }

    // Analyze scroll performance
    if (summary.scrollPerformance < 50) {
      bottlenecks.push('Poor scroll performance');
      recommendations.push('Enable virtualization or reduce image count per view');
    }

    // Device-specific recommendations
    const device = summary.deviceCapabilities;
    if (device.isMobile) {
      recommendations.push('Consider using lower quality thumbnails on mobile devices');
    }

    if (device.cpuCores < 4) {
      recommendations.push('Reduce concurrent thumbnail generation on low-end devices');
    }

    return { summary, recommendations, bottlenecks };
  }

  reset() {
    this.metrics = [];
    this.scrollMeasurements = [];
    this.frameCount = 0;
    this.startTime = 0;
    this.lastFrameTime = 0;
    this.isMonitoringScroll = false;
  }

  exportData(): PerformanceMetrics[] {
    return [...this.metrics];
  }
}

// Singleton instance
export const performanceMonitor = new PerformanceMonitor();
export type { PerformanceMetrics, ScrollMetrics };