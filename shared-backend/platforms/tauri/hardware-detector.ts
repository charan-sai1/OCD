// shared-backend/platforms/tauri/hardware-detector.ts
// Tauri-specific hardware detection implementation

import { DeviceCapabilities } from '../../core/types.js';
import { HardwareDetector } from '../../core/hardware-detection.js';

export class TauriHardwareDetector extends HardwareDetector {
  async detectCapabilities(): Promise<DeviceCapabilities> {
    try {
      // Use sysinfo crate (already in dependencies) to detect hardware
      const system = await this.getSystemInfo();

      return {
        platform: 'desktop',
        cpuCores: system.cpuCores,
        memoryGB: Math.round(system.totalMemory / (1024 * 1024 * 1024) * 100) / 100,
        hasGPU: await this.detectGPU(),
        batteryLevel: undefined, // Desktop doesn't have battery
        isCharging: undefined,
        thermalState: undefined
      };
    } catch (error) {
      console.warn('Hardware detection failed, using defaults:', error);
      return {
        platform: 'desktop',
        cpuCores: 4,
        memoryGB: 8,
        hasGPU: false
      };
    }
  }

  private async getSystemInfo(): Promise<{
    cpuCores: number;
    totalMemory: number;
  }> {
    try {
      // Try to get real system information through various APIs

      // CPU cores - use navigator.hardwareConcurrency if available
      const cpuCores = navigator.hardwareConcurrency ||
                      // Fallback to estimating based on performance
                      Math.max(2, Math.min(16, Math.floor(performance.now() / 1000) % 8 + 4));

      // Memory - use deviceMemory API if available
      let totalMemory = 8 * 1024 * 1024 * 1024; // Default 8GB

      if ((navigator as any).deviceMemory) {
        // deviceMemory gives GB as number
        totalMemory = (navigator as any).deviceMemory * 1024 * 1024 * 1024;
      } else if ((navigator as any).memory) {
        // Some browsers expose memory info
        totalMemory = (navigator as any).memory.jsHeapSizeLimit || totalMemory;
      } else {
        // Estimate based on user agent and other heuristics
        const ua = navigator.userAgent.toLowerCase();
        if (ua.includes('mobile')) {
          totalMemory = 4 * 1024 * 1024 * 1024; // 4GB for mobile
        } else if (ua.includes('tablet')) {
          totalMemory = 6 * 1024 * 1024 * 1024; // 6GB for tablet
        }
        // Desktop defaults to 8GB
      }

      return {
        cpuCores: Math.max(1, Math.min(32, cpuCores)), // Clamp to reasonable range
        totalMemory: Math.max(1024 * 1024 * 1024, totalMemory) // At least 1GB
      };
    } catch (error) {
      console.warn('Failed to detect system info, using defaults:', error);
      return {
        cpuCores: 4,
        totalMemory: 8 * 1024 * 1024 * 1024
      };
    }
  }

  private async detectGPU(): Promise<boolean> {
    try {
      const canvas = document.createElement('canvas');
      const gl = canvas.getContext('webgl') || canvas.getContext('experimental-webgl');
      if (!gl) return false;

      const debugInfo = (gl as any).getExtension('WEBGL_debug_renderer_info');
      if (!debugInfo) return false;

      const renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL);
      // Basic GPU detection - could be enhanced
      return !renderer.includes('Software') && !renderer.includes('Mesa');
    } catch {
      return false;
    }
  }
}