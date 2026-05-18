export interface DeviceCapabilities {
  cpuCores: number;
  memoryGB: number;
  hasGPU: boolean;
  recommendedSettings: {
    batchSize: number;
    quality: 'low' | 'medium' | 'high';
    maxConcurrent: number;
  };
}

export const DeviceCapabilities = {
  detect(): DeviceCapabilities {
    // Desktop fallback - conservative settings
    return {
      cpuCores: 4,
      memoryGB: 8,
      hasGPU: false,
      recommendedSettings: {
        batchSize: 3,
        quality: 'medium',
        maxConcurrent: 2,
      },
    };
  }
};

