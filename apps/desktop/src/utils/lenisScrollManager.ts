import Lenis from 'lenis';

interface LenisConfig {
  smoothness?: number;        // 0-1 (0 = smoothest, 1 = instant)
  duration?: number;         // Animation duration in ms
  easing?: (t: number) => number; // Easing function
  direction?: 'vertical' | 'horizontal';
  gestureDirection?: 'vertical' | 'horizontal' | 'both';
  mouseMultiplier?: number;
  touchMultiplier?: number;
  infinite?: boolean;
}

interface ScrollInfo {
  scroll: number;
  progress: number;
  velocity: number;
  direction: 'up' | 'down' | 'left' | 'right';
  isScrolling: boolean;
}

interface ScrollCallback {
  (scrollInfo: ScrollInfo): void;
}

class LenisScrollManager {
  private lenis: Lenis | null = null;
  private callbacks: ScrollCallback[] = [];
  private isInitialized = false;
  private currentScrollInfo: ScrollInfo = {
    scroll: 0,
    progress: 0,
    velocity: 0,
    direction: 'down',
    isScrolling: false
  };

  private rafId: number | null = null;
  private lastScrollY = 0;
  private lastDirection: 'up' | 'down' | 'left' | 'right' = 'down';

  initialize(config: LenisConfig = {}): Promise<void> {
    return new Promise((resolve) => {
      if (this.isInitialized) {
        resolve();
        return;
      }

      // Default smooth configuration for magical feel
      const defaultConfig: LenisConfig = {
        smoothness: 0.8, // Very smooth
        duration: 1200, // 1.2s scroll duration
        easing: (t) => t, // Linear easing
        direction: 'vertical',
        gestureDirection: 'vertical',
        mouseMultiplier: 1,
        touchMultiplier: 1,
        infinite: false,
        ...config
      };

      try {
        this.lenis = new Lenis({
          duration: defaultConfig.duration,
          easing: defaultConfig.easing,
        });

        console.log('Lenis initialized successfully');
        // Set up scroll event handling
        this.setupScrollEvents();

        // Start the animation loop
        this.startAnimationLoop();

        this.isInitialized = true;
        console.log('Lenis scroll initialized with magical smoothness');
        resolve();

      } catch (error) {
        console.error('Failed to initialize Lenis:', error);
        // Fallback to native scrolling
        resolve();
      }
    });
  }

  private setupScrollEvents(): void {
    if (!this.lenis) return;

    this.lenis.on('scroll', (data: any) => {
      const scrollY = data.scroll || 0;
      const velocity = data.velocity || 0;

      // Determine scroll direction
      let direction: 'up' | 'down' | 'left' | 'right' = this.lastDirection;
      if (scrollY > this.lastScrollY) {
        direction = 'down';
      } else if (scrollY < this.lastScrollY) {
        direction = 'up';
      }

      // Calculate progress (0-1 based on page height)
      const progress = Math.min(scrollY / (document.body.scrollHeight - window.innerHeight), 1);

      this.currentScrollInfo = {
        scroll: scrollY,
        progress,
        velocity: Math.abs(velocity),
        direction,
        isScrolling: Math.abs(velocity) > 0.1
      };

      this.lastScrollY = scrollY;
      this.lastDirection = direction;

      // Notify callbacks
      this.callbacks.forEach(callback => {
        try {
          callback(this.currentScrollInfo);
        } catch (error) {
          console.warn('Scroll callback error:', error);
        }
      });
    });
  }

  private startAnimationLoop(): void {
    if (!this.lenis) return;

    const animate = (time: number) => {
      this.lenis?.raf(time);
      this.rafId = requestAnimationFrame(animate);
    };

    this.rafId = requestAnimationFrame(animate);
  }

  // Scroll to specific position with smooth animation
  scrollTo(y: number, duration?: number): Promise<void> {
    return new Promise((resolve) => {
      if (!this.lenis) {
        // Fallback to native scrolling
        window.scrollTo({ top: y, behavior: 'smooth' });
        setTimeout(resolve, duration || 1000);
        return;
      }

      this.lenis.scrollTo(y, { duration: duration || 1000 });
      setTimeout(resolve, duration || 1000);
    });
  }

  // Register scroll callback
  onScroll(callback: ScrollCallback): () => void {
    this.callbacks.push(callback);

    // Return unsubscribe function
    return () => {
      const index = this.callbacks.indexOf(callback);
      if (index > -1) {
        this.callbacks.splice(index, 1);
      }
    };
  }

  // Get current scroll information
  getScrollInfo(): ScrollInfo {
    return { ...this.currentScrollInfo };
  }

  // Adjust smoothness dynamically
  adjustSmoothness(smoothness: number): void {
    if (this.lenis) {
      // Lenis doesn't have a direct smoothness setter
      // We could destroy and recreate with new settings
      console.log(`Smoothness adjustment requested: ${smoothness}`);
    }
  }

  // Stop the scroll manager
  stop(): void {
    if (this.rafId) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }

    if (this.lenis) {
      this.lenis.stop();
    }
  }

  // Resume the scroll manager
  start(): void {
    if (this.lenis) {
      this.lenis.start();
      this.startAnimationLoop();
    }
  }

  // Destroy the scroll manager
  destroy(): void {
    this.stop();
    this.callbacks = [];

    if (this.lenis) {
      this.lenis.destroy();
      this.lenis = null;
    }

    this.isInitialized = false;
  }

  // Check if Lenis is available and working
  isActive(): boolean {
    return this.isInitialized && this.lenis !== null;
  }
}

// Singleton instance
export const lenisScrollManager = new LenisScrollManager();
export type { LenisConfig, ScrollInfo, ScrollCallback };