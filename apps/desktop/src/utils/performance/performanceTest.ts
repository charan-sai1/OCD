import { performanceBenchmarker, type BenchmarkResult } from './performanceBenchmarking';
import { advancedImageCache } from './advancedCache';
import { systemResourceManager } from './systemResourceManager';

export interface PerformanceTestConfig {
  duration: number; // Test duration in milliseconds
  imageCount: number; // Number of images to simulate
  scrollEvents: number; // Number of scroll events to simulate
  cacheOperations: number; // Number of cache operations to simulate
}

export interface PerformanceTestResult {
  benchmark: BenchmarkResult;
  cacheStats: {
    hitRate: number;
    size: number;
    operationCount: number;
  };
  systemStats: {
    memoryBudget: number;
    cpuPriority: string;
    networkPriority: string;
  };
  testConfig: PerformanceTestConfig;
}

/**
 * Runs a comprehensive performance test of the image gallery system
 */
export async function runPerformanceTest(config: Partial<PerformanceTestConfig> = {}): Promise<PerformanceTestResult> {
  const testConfig: PerformanceTestConfig = {
    duration: 10000,
    imageCount: 100,
    scrollEvents: 50,
    cacheOperations: 200,
    ...config
  };

  console.log('🚀 Starting Image Gallery Performance Test');
  console.log('Configuration:', testConfig);

  // Start monitoring
  performanceBenchmarker.startMonitoring();

  // Simulate image loading operations
  await simulateImageOperations(testConfig.imageCount);

  // Simulate scroll events
  await simulateScrollEvents(testConfig.scrollEvents);

  // Simulate cache operations
  await simulateCacheOperations(testConfig.cacheOperations);

  // Wait for remaining duration
  const remainingTime = Math.max(0, testConfig.duration - 2000); // Account for simulation time
  if (remainingTime > 0) {
    await new Promise(resolve => setTimeout(resolve, remainingTime));
  }

  // Collect results
  const benchmark = await performanceBenchmarker.stopMonitoring();
  const cacheStats = await getCacheStats();
  const systemStats = getSystemStats();

  const result: PerformanceTestResult = {
    benchmark,
    cacheStats,
    systemStats,
    testConfig
  };

  console.log('✅ Performance Test Complete');
  console.log('Results:', result);

  return result;
}

/**
 * Simulates image loading operations for testing
 */
async function simulateImageOperations(count: number): Promise<void> {
  console.log(`📸 Simulating ${count} image operations...`);

  for (let i = 0; i < count; i++) {
    const startTime = performance.now();
    const imagePath = `/test/image_${i}.jpg`;

    try {
      // Simulate cache check
      const cached = await advancedImageCache.get(imagePath);
      if (cached) {
        performanceBenchmarker.recordCacheHit(true);
      } else {
        // Simulate generation and caching
        await advancedImageCache.set(imagePath, new Blob(['test'], { type: 'image/jpeg' }), 'medium');
        performanceBenchmarker.recordCacheHit(false);
      }

      const loadTime = performance.now() - startTime;
      performanceBenchmarker.recordImageLoad(imagePath, loadTime);
    } catch (error) {
      console.warn(`Image operation ${i} failed:`, error);
    }

    // Small delay to simulate real-world timing
    if (i % 10 === 0) {
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  }
}

/**
 * Simulates scroll events for testing
 */
async function simulateScrollEvents(count: number): Promise<void> {
  console.log(`📜 Simulating ${count} scroll events...`);

  for (let i = 0; i < count; i++) {
    const startTime = performance.now();

    // Simulate scroll processing (minimal work)
    await new Promise(resolve => setTimeout(resolve, 1));

    const scrollTime = performance.now() - startTime;
    const fps = 1000 / scrollTime; // Rough FPS calculation
    performanceBenchmarker.recordScrollEvent(scrollTime, fps);

    // Variable delay to simulate different scroll speeds
    const delay = Math.random() * 50 + 10; // 10-60ms between scrolls
    await new Promise(resolve => setTimeout(resolve, delay));
  }
}

/**
 * Simulates cache operations for testing
 */
async function simulateCacheOperations(count: number): Promise<void> {
  console.log(`💾 Simulating ${count} cache operations...`);

  for (let i = 0; i < count; i++) {
    const imagePath = `/cache/test_image_${i % 20}.jpg`; // Reuse some paths for cache hits

    try {
      if (i % 3 === 0) {
        // Read operation
        await advancedImageCache.get(imagePath);
      } else {
        // Write operation
        const blob = new Blob([`test_data_${i}`], { type: 'image/jpeg' });
        await advancedImageCache.set(imagePath, blob, 'medium');
      }
    } catch (error) {
      console.warn(`Cache operation ${i} failed:`, error);
    }

    // Small delay
    if (i % 20 === 0) {
      await new Promise(resolve => setTimeout(resolve, 5));
    }
  }
}

/**
 * Gets cache statistics for the test result
 */
async function getCacheStats() {
  const stats = await advancedImageCache.getStats();

  return {
    hitRate: stats?.hitRate || 0,
    size: (stats?.totalSize || 0) / (1024 * 1024), // Convert to MB
    operationCount: stats?.count || 0
  };
}

/**
 * Gets system resource statistics
 */
function getSystemStats() {
  const budget = systemResourceManager.getResourceBudget();

  return {
    memoryBudget: budget.memoryMB,
    cpuPriority: budget.cpuPriority,
    networkPriority: budget.networkPriority
  };
}

/**
 * Formats performance test results for display
 */
export function formatPerformanceResults(result: PerformanceTestResult): string {
  const { benchmark, cacheStats, systemStats } = result;

  return `
🎯 **Performance Test Results**

**Overall Score:** ${benchmark.score}/100

**📊 Loading Performance:**
- Initial Load: ${benchmark.metrics.initialLoadTime.toFixed(0)}ms
- First Image: ${benchmark.metrics.firstImageLoadTime.toFixed(0)}ms
- Average Image Load: ${benchmark.metrics.averageImageLoadTime.toFixed(0)}ms
- Fastest Image: ${benchmark.metrics.fastestImageLoadTime.toFixed(0)}ms
- Slowest Image: ${benchmark.metrics.slowestImageLoadTime.toFixed(0)}ms

**🎨 Rendering Performance:**
- FPS: ${benchmark.metrics.fps.toFixed(1)}
- Grid Render Time: ${benchmark.metrics.gridRenderTime.toFixed(0)}ms
- Scroll Render Time: ${benchmark.metrics.scrollRenderTime.toFixed(0)}ms

**💾 Memory & Cache:**
- Peak Memory: ${benchmark.metrics.peakMemoryUsage.toFixed(1)}MB
- Average Memory: ${benchmark.metrics.averageMemoryUsage.toFixed(1)}MB
- Cache Hit Rate: ${(benchmark.metrics.cacheHitRate * 100).toFixed(1)}%
- Cache Size: ${cacheStats.size.toFixed(1)}MB

**👤 User Experience:**
- Time to Interactive: ${benchmark.metrics.timeToInteractive.toFixed(0)}ms
- Largest Contentful Paint: ${benchmark.metrics.largestContentfulPaint.toFixed(0)}ms
- Layout Shift: ${benchmark.metrics.cumulativeLayoutShift.toFixed(4)}

**🔧 System Resources:**
- Memory Budget: ${systemStats.memoryBudget.toFixed(0)}MB
- CPU Priority: ${systemStats.cpuPriority}
- Network Priority: ${systemStats.networkPriority}

**💡 Recommendations:**
${benchmark.recommendations.map(rec => `• ${rec}`).join('\n')}

**📈 Network:**
- Requests: ${benchmark.metrics.networkRequests}
- Transfer Size: ${(benchmark.metrics.networkTransferSize / (1024 * 1024)).toFixed(2)}MB
`;
}

/**
 * Runs a quick smoke test to ensure basic functionality
 */
export async function runSmokeTest(): Promise<boolean> {
  console.log('🧪 Running Smoke Test...');

  try {
    // Test cache operations
    const testPath = '/smoke/test.jpg';
    const testBlob = new Blob(['smoke_test'], { type: 'image/jpeg' });

    await advancedImageCache.set(testPath, testBlob, 'medium');
    const retrieved = await advancedImageCache.get(testPath);

    if (!retrieved) {
      throw new Error('Cache smoke test failed');
    }

    // Test system resource manager
    const budget = systemResourceManager.getResourceBudget();
    if (!budget.memoryMB || budget.memoryMB <= 0) {
      throw new Error('System resource manager smoke test failed');
    }

    console.log('✅ Smoke Test Passed');
    return true;
  } catch (error) {
    console.error('❌ Smoke Test Failed:', error);
    return false;
  }
}