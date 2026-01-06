interface TransitionConfig {
  duration: number;
  easing: string;
  type: 'fade' | 'slide' | 'scale' | 'blur-to-sharp';
}

interface ContinuityState {
  currentImage: string | null;
  nextImage: string | null;
  transitionProgress: number;
  isTransitioning: boolean;
}

class VisualContinuityManager {
  private continuityState: ContinuityState = {
    currentImage: null,
    nextImage: null,
    transitionProgress: 0,
    isTransitioning: false
  };

  private transitionCallbacks: ((state: ContinuityState) => void)[] = [];

  // Smooth cross-fade between images
  async transitionBetween(
    fromImage: string,
    toImage: string,
    config: Partial<TransitionConfig> = {}
  ): Promise<void> {
    if (this.continuityState.isTransitioning) {
      return; // Already transitioning
    }

    const transitionConfig: TransitionConfig = {
      duration: config.duration || 300,
      easing: config.easing || 'cubic-bezier(0.4, 0, 0.2, 1)',
      type: config.type || 'fade',
      ...config
    };

    this.continuityState = {
      currentImage: fromImage,
      nextImage: toImage,
      transitionProgress: 0,
      isTransitioning: true
    };

    this.notifyStateChange();

    // Perform transition
    await this.performTransition(transitionConfig);

    // Complete transition
    this.continuityState = {
      currentImage: toImage,
      nextImage: null,
      transitionProgress: 1,
      isTransitioning: false
    };

    this.notifyStateChange();
  }

  // Prepare next image invisibly before user requests it
  async prepareNextImage(imagePath: string): Promise<void> {
    // Pre-load image without showing it
    // In real implementation, this would create an img element with opacity: 0
    // and position: absolute to preload it invisibly

    console.log(`Preparing next image: ${imagePath}`);

    // Simulate preloading
    await new Promise(resolve => setTimeout(resolve, 50));
  }

  // Handle swipe gesture transitions
  async handleSwipeTransition(
    direction: 'left' | 'right' | 'up' | 'down',
    currentImage: string,
    nextImage: string
  ): Promise<void> {
    const swipeConfig: TransitionConfig = {
      duration: 400,
      easing: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)', // iOS-style easing
      type: 'slide'
    };

    // Adjust config based on direction
    const adjustedConfig = {
      ...swipeConfig,
      direction // Pass direction for slide animation
    };

    await this.transitionBetween(currentImage, nextImage, adjustedConfig as any);
  }

  // Adaptive transition timing based on device performance
  getOptimalTransitionDuration(devicePerformance: 'slow' | 'normal' | 'fast' = 'normal'): number {
    switch (devicePerformance) {
      case 'slow':
        return 500; // Slower for smoother feel on slow devices
      case 'fast':
        return 200; // Faster on high-performance devices
      case 'normal':
      default:
        return 300; // Standard iOS-style duration
    }
  }

  // Get current continuity state
  getCurrentState(): ContinuityState {
    return { ...this.continuityState };
  }

  // Register callback for state changes
  onStateChange(callback: (state: ContinuityState) => void): () => void {
    this.transitionCallbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.transitionCallbacks.indexOf(callback);
      if (index > -1) {
        this.transitionCallbacks.splice(index, 1);
      }
    };
  }

  private async performTransition(config: TransitionConfig): Promise<void> {
    const { duration, easing } = config;
    const startTime = Date.now();

    return new Promise((resolve) => {
      const animate = () => {
        const elapsed = Date.now() - startTime;
        const progress = Math.min(elapsed / duration, 1);

        // Apply easing function
        const easedProgress = this.applyEasing(progress, easing);

        this.continuityState.transitionProgress = easedProgress;
        this.notifyStateChange();

        if (progress < 1) {
          requestAnimationFrame(animate);
        } else {
          resolve();
        }
      };

      requestAnimationFrame(animate);
    });
  }

  private applyEasing(progress: number, easing: string): number {
    // Simple cubic-bezier approximation
    // In production, you'd use a proper easing library
    if (easing.includes('cubic-bezier')) {
      // Parse cubic-bezier values (simplified)
      // For now, just return progress with slight smoothing
      return this.smoothStep(progress);
    }

    return progress;
  }

  private smoothStep(x: number): number {
    // Smooth step function for natural transitions
    return x * x * (3 - 2 * x);
  }

  private notifyStateChange(): void {
    this.transitionCallbacks.forEach(callback => {
      try {
        callback(this.getCurrentState());
      } catch (error) {
        console.warn('Continuity state callback failed:', error);
      }
    });
  }

  // Apple-style blur-to-sharp transition for progressive loading
  async performBlurToSharpTransition(
    imageElement: HTMLImageElement,
    lowQualityUrl: string,
    highQualityUrl: string
  ): Promise<void> {
    // Start with low quality image
    imageElement.src = lowQualityUrl;
    imageElement.style.filter = 'blur(2px)';
    imageElement.style.transition = 'filter 0.3s ease-out';

    // Wait for low quality to load
    await new Promise((resolve) => {
      if (imageElement.complete) {
        resolve(void 0);
      } else {
        imageElement.onload = () => resolve(void 0);
        imageElement.onerror = () => resolve(void 0); // Continue even on error
      }
    });

    // Switch to high quality and remove blur
    imageElement.src = highQualityUrl;

    // Wait for high quality to load
    await new Promise((resolve) => {
      if (imageElement.complete) {
        resolve(void 0);
      } else {
        imageElement.onload = () => resolve(void 0);
        imageElement.onerror = () => resolve(void 0);
      }
    });

    // Remove blur with smooth transition
    imageElement.style.filter = 'none';
  }

  // Prepare images for smooth scrolling transitions
  prepareScrollTransition(currentImages: string[], direction: 'forward' | 'backward'): void {
    // Preload adjacent images based on scroll direction
    const nextImages = direction === 'forward'
      ? currentImages.slice(-2) // Last 2 images (prepare for forward scroll)
      : currentImages.slice(0, 2); // First 2 images (prepare for backward scroll)

    nextImages.forEach(imagePath => {
      this.prepareNextImage(imagePath);
    });
  }

  // Handle rapid scrolling with smooth transitions
  handleRapidScroll(scrollVelocity: number, _currentImage: string): void {
    const transitionDuration = Math.max(150, 400 - (scrollVelocity * 0.5));

    // Faster scrolling = quicker transitions but still smooth
    console.log(`Rapid scroll detected: ${scrollVelocity}px/s, using ${transitionDuration}ms transitions`);
  }
}

// Singleton instance
export const visualContinuityManager = new VisualContinuityManager();
export type { TransitionConfig, ContinuityState };