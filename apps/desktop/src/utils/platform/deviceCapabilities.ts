interface DeviceProfile {
  cpuCores: number;
  memoryGB: number;
  isMobile: boolean;
  connectionSpeed: 'slow' | 'medium' | 'fast';
  recommendedSettings: {
    batchSize: number;
    quality: 'low' | 'medium' | 'high';
    maxCacheSize: number;
  };
}

class DeviceCapabilities {
  static detect(): DeviceProfile {
    const cores = navigator.hardwareConcurrency || 4;
    const memory = (navigator as any).deviceMemory || 4;
    const isMobile = window.innerWidth < 768;

    // Determine optimal settings based on capabilities
    return {
      cpuCores: cores,
      memoryGB: memory,
      isMobile,
      connectionSpeed: 'fast', // Local app, so always fast
      recommendedSettings: this.getOptimalSettings(cores, memory, isMobile)
    };
  }

  private static getOptimalSettings(cores: number, memory: number, isMobile: boolean) {
    if (isMobile) {
      return { batchSize: 1, quality: 'low' as const, maxCacheSize: 25 * 1024 * 1024 };
    }

    if (cores >= 8 && memory >= 8) {
      return { batchSize: 5, quality: 'high' as const, maxCacheSize: 200 * 1024 * 1024 };
    }

    return { batchSize: 3, quality: 'medium' as const, maxCacheSize: 100 * 1024 * 1024 };
  }
}

export { DeviceCapabilities, type DeviceProfile };