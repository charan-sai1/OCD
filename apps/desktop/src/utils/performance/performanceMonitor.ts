class PerformanceMonitor {
  private metrics = new Map<string, number[]>();
  private startTimes = new Map<string, number>();

  start(operation: string) {
    this.startTimes.set(operation, performance.now());
  }

  end(operation: string) {
    const startTime = this.startTimes.get(operation);
    if (startTime) {
      const duration = performance.now() - startTime;
      this.recordMetric(operation, duration);
      this.startTimes.delete(operation);
    }
  }

  recordMetric(name: string, value: number) {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }
    this.metrics.get(name)!.push(value);
    const measurements = this.metrics.get(name)!;
    if (measurements.length > 100) {
      measurements.shift();
    }
  }

  getAverage(name: string): number {
    const measurements = this.metrics.get(name);
    if (!measurements || measurements.length === 0) return 0;
    return measurements.reduce((sum, val) => sum + val, 0) / measurements.length;
  }

  getStats(name: string) {
    const measurements = this.metrics.get(name) || [];
    if (measurements.length === 0) return null;
    const avg = this.getAverage(name);
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);
    return { average: avg, min, max, count: measurements.length, last: measurements[measurements.length - 1] };
  }

  logAllStats() {
    console.group('Performance Stats');
    for (const [name] of this.metrics) {
      const stats = this.getStats(name);
      if (stats) {
        console.log(`${name}: avg=${stats.average.toFixed(2)}ms, min=${stats.min.toFixed(2)}ms, max=${stats.max.toFixed(2)}ms (${stats.count} samples)`);
      }
    }
    console.groupEnd();
  }
}

export const performanceMonitor = new PerformanceMonitor();
