// shared-backend/core/hardware-detection.ts
// Hardware detection and capability assessment for facial recognition

import { DeviceCapabilities, ProcessingMode } from './types.js';

/**
 * Platform-agnostic hardware detection
 * Platform-specific implementations will override these methods
 */
export abstract class HardwareDetector {
  abstract detectCapabilities(): Promise<DeviceCapabilities>;

  /**
   * Determine optimal processing mode based on device capabilities
   */
  static selectProcessingMode(capabilities: DeviceCapabilities): ProcessingMode {
    const { platform, cpuCores, memoryGB, hasGPU, batteryLevel, isCharging } = capabilities;

    if (platform === 'mobile') {
      // Mobile-specific logic - prioritize battery and memory
      if (batteryLevel !== undefined && batteryLevel < 20 && !isCharging) {
        return ProcessingMode.Fast;  // Conserve battery
      }

      if (memoryGB < 4) {
        return ProcessingMode.Fast;  // Limited memory
      }

      if (cpuCores >= 4 && memoryGB >= 6 && isCharging) {
        return ProcessingMode.Balanced;  // Good conditions for balanced processing
      }

      return ProcessingMode.Fast;  // Default to fast for mobile
    } else {
      // Desktop logic
      if (hasGPU && memoryGB >= 8) {
        return ProcessingMode.HighAccuracy;  // GPU available, plenty of memory
      }

      if (cpuCores >= 8 && memoryGB >= 16) {
        return ProcessingMode.HighAccuracy;  // Powerful CPU setup
      }

      if (cpuCores >= 4 && memoryGB >= 8) {
        return ProcessingMode.Balanced;  // Standard desktop
      }

      return ProcessingMode.Fast;  // Limited desktop hardware
    }
  }

  /**
   * Estimate processing performance for a given mode
   */
  static estimatePerformance(capabilities: DeviceCapabilities, mode: ProcessingMode): {
    facesPerSecond: number;
    memoryUsageMB: number;
    batteryDrainPerHour?: number;
  } {
    const { platform, cpuCores, memoryGB } = capabilities;
    const isMobile = platform === 'mobile';

    switch (mode) {
      case ProcessingMode.Fast:
        return {
          facesPerSecond: Math.min(cpuCores * 2, isMobile ? 5 : 15),
          memoryUsageMB: 100,
          batteryDrainPerHour: isMobile ? 2 : undefined
        };

      case ProcessingMode.Balanced:
        return {
          facesPerSecond: Math.min(cpuCores * 1.5, isMobile ? 8 : 12),
          memoryUsageMB: 300,
          batteryDrainPerHour: isMobile ? 5 : undefined
        };

      case ProcessingMode.HighAccuracy:
        return {
          facesPerSecond: Math.min(cpuCores * 1, isMobile ? 3 : 8),
          memoryUsageMB: 800,
          batteryDrainPerHour: isMobile ? 15 : undefined
        };
    }
  }

  /**
   * Check if current conditions are suitable for processing
   */
  static shouldProcess(capabilities: DeviceCapabilities, mode: ProcessingMode): boolean {
    const { platform, batteryLevel, isCharging, thermalState } = capabilities;

    if (platform === 'mobile') {
      // Don't process on low battery unless charging
      if (batteryLevel !== undefined && batteryLevel < 15 && !isCharging) {
        return false;
      }

      // Don't process high-accuracy on battery
      if (mode === ProcessingMode.HighAccuracy && !isCharging) {
        return false;
      }

      // Respect thermal state
      if (thermalState === 'serious' || thermalState === 'critical') {
        return false;
      }
    }

    return true;
  }
}

/**
 * Get platform-specific hardware detector
 */
export function getHardwareDetector(): HardwareDetector {
  // This will be overridden by platform-specific implementations
  throw new Error('Platform-specific hardware detector not implemented');
}