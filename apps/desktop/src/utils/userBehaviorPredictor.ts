interface ScrollEvent {
  timestamp: number;
  position: number;
  velocity: number;
  direction: 'up' | 'down' | 'left' | 'right';
}

interface ClickEvent {
  timestamp: number;
  imagePath: string;
  position: { x: number; y: number };
  dwellTime: number; // How long user viewed this image
}

interface UserSession {
  startTime: number;
  endTime: number;
  scrollEvents: ScrollEvent[];
  clickEvents: ClickEvent[];
  totalImagesViewed: number;
  averageDwellTime: number;
  navigationPattern: 'linear' | 'jumping' | 'browsing' | 'searching' | 'reviewing';
}

interface BehaviorPattern {
  scrollDirection: 'vertical' | 'horizontal' | 'mixed';
  navigationStyle: 'linear' | 'jumping' | 'browsing';
  interactionSpeed: 'slow' | 'moderate' | 'fast';
  focusPattern: 'quick_glance' | 'detailed_review' | 'selective';
  confidence: number;
}

interface PredictionResult {
  nextImages: string[];
  confidence: number;
  expectedTimeToNeed: number; // milliseconds
  recommendedPreloadCount: number;
}

class UserBehaviorPredictor {
  private recentScrollEvents: ScrollEvent[] = [];
  private recentClickEvents: ClickEvent[] = [];
  private sessionHistory: UserSession[] = [];
  private behaviorModel: BehaviorPattern | null = null;

  private readonly SCROLL_HISTORY_WINDOW = 10000; // 10 seconds
  private readonly CLICK_HISTORY_WINDOW = 30000; // 30 seconds
  private readonly MAX_SESSIONS = 10; // Keep last 10 sessions for learning

  constructor() {
    this.loadSessionHistory();
  }

  // Record user scroll behavior
  recordScroll(position: number, velocity: number, direction: 'up' | 'down' | 'left' | 'right'): void {
    const scrollEvent: ScrollEvent = {
      timestamp: Date.now(),
      position,
      velocity,
      direction
    };

    this.recentScrollEvents.push(scrollEvent);

    // Keep only recent events
    const cutoff = Date.now() - this.SCROLL_HISTORY_WINDOW;
    this.recentScrollEvents = this.recentScrollEvents.filter(e => e.timestamp > cutoff);

    // Update behavior model
    this.updateBehaviorModel();
  }

  // Record user click/interaction behavior
  recordClick(imagePath: string, position: { x: number; y: number }, dwellTime: number): void {
    const clickEvent: ClickEvent = {
      timestamp: Date.now(),
      imagePath,
      position,
      dwellTime
    };

    this.recentClickEvents.push(clickEvent);

    // Keep only recent events
    const cutoff = Date.now() - this.CLICK_HISTORY_WINDOW;
    this.recentClickEvents = this.recentClickEvents.filter(e => e.timestamp > cutoff);

    // Update behavior model
    this.updateBehaviorModel();
  }

  // Analyze recent behavior to predict what user will do next
  predictNextImages(currentPosition: number, totalImages: number): PredictionResult {
    if (!this.behaviorModel) {
      return this.getConservativePrediction(currentPosition, totalImages);
    }

    const pattern = this.behaviorModel;
    let nextImages: string[] = [];
    let confidence = pattern.confidence;
    let expectedTime = 2000; // Default 2 seconds
    let preloadCount = 2; // Default 2 images

    // Analyze scroll direction and velocity to predict next positions
    const recentScrolls = this.recentScrollEvents.slice(-5);
    if (recentScrolls.length > 0) {
      const avgVelocity = recentScrolls.reduce((sum, s) => sum + s.velocity, 0) / recentScrolls.length;
      const direction = recentScrolls[recentScrolls.length - 1].direction;

      // Calculate expected next positions based on velocity and direction
      const velocityMultiplier = Math.min(avgVelocity / 100, 3); // Cap at 3x speed
      const baseStep = Math.ceil(velocityMultiplier);

      switch (direction) {
        case 'down':
          // Scrolling down (next images)
          for (let i = 1; i <= baseStep; i++) {
            const nextPos = currentPosition + i;
            if (nextPos < totalImages) {
              nextImages.push(`image_${nextPos}`);
            }
          }
          break;

        case 'up':
          // Scrolling up (previous images)
          for (let i = 1; i <= baseStep; i++) {
            const nextPos = currentPosition - i;
            if (nextPos >= 0) {
              nextImages.push(`image_${nextPos}`);
            }
          }
          break;
      }

      // Adjust timing based on velocity
      expectedTime = Math.max(500, 3000 / (avgVelocity + 1)); // Faster scrolling = less time
      preloadCount = Math.min(5, Math.ceil(baseStep * 1.5)); // More images for faster scrolling
    }

    // Adjust confidence based on pattern stability
    if (pattern.navigationStyle === 'linear') {
      confidence = Math.min(1.0, confidence * 1.2); // Boost confidence for linear navigation
    } else if (pattern.navigationStyle === 'jumping') {
      confidence = Math.max(0.3, confidence * 0.8); // Reduce confidence for jumping navigation
    }

    return {
      nextImages,
      confidence,
      expectedTimeToNeed: expectedTime,
      recommendedPreloadCount: preloadCount
    };
  }

  // Update behavior model based on recent activity
  private updateBehaviorModel(): void {
    const scrollEvents = this.recentScrollEvents.slice(-20);
    const clickEvents = this.recentClickEvents.slice(-10);

    if (scrollEvents.length < 5) return; // Need minimum data

    // Analyze scroll patterns
    const verticalScrolls = scrollEvents.filter(e => e.direction === 'up' || e.direction === 'down');
    const horizontalScrolls = scrollEvents.filter(e => e.direction === 'left' || e.direction === 'right');

    const scrollDirection = verticalScrolls.length > horizontalScrolls.length ? 'vertical' : 'horizontal';

    // Analyze navigation style
    const positionChanges = scrollEvents.map(e => e.position).slice(1);
    const deltas = positionChanges.map((pos, i) => Math.abs(pos - scrollEvents[i].position));

    const avgDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const linearRatio = deltas.filter(d => d < avgDelta * 0.5).length / deltas.length;

    let navigationStyle: 'linear' | 'jumping' | 'browsing';
    if (linearRatio > 0.7) {
      navigationStyle = 'linear';
    } else if (avgDelta > 10) {
      navigationStyle = 'jumping';
    } else {
      navigationStyle = 'browsing';
    }

    // Navigation pattern is derived from navigationStyle

    // Analyze interaction speed
    const avgVelocity = scrollEvents.reduce((sum, s) => sum + s.velocity, 0) / scrollEvents.length;
    let interactionSpeed: 'slow' | 'moderate' | 'fast';
    if (avgVelocity < 50) {
      interactionSpeed = 'slow';
    } else if (avgVelocity < 150) {
      interactionSpeed = 'moderate';
    } else {
      interactionSpeed = 'fast';
    }

    // Analyze focus pattern
    const avgDwellTime = clickEvents.length > 0
      ? clickEvents.reduce((sum, c) => sum + c.dwellTime, 0) / clickEvents.length
      : 2000; // Default

    let focusPattern: 'quick_glance' | 'detailed_review' | 'selective';
    if (avgDwellTime < 1000) {
      focusPattern = 'quick_glance';
    } else if (avgDwellTime > 5000) {
      focusPattern = 'detailed_review';
    } else {
      focusPattern = 'selective';
    }

    // Calculate confidence based on data consistency and amount
    const confidence = Math.min(0.9, (scrollEvents.length * 0.03) + (clickEvents.length * 0.05));

    this.behaviorModel = {
      scrollDirection,
      navigationStyle,
      interactionSpeed,
      focusPattern,
      confidence
    };
  }

  // Conservative fallback prediction
  private getConservativePrediction(currentPosition: number, totalImages: number): PredictionResult {
    const nextImages: string[] = [];

    // Load next 2 images conservatively
    for (let i = 1; i <= 2; i++) {
      const nextPos = currentPosition + i;
      if (nextPos < totalImages) {
        nextImages.push(`image_${nextPos}`);
      }
    }

    return {
      nextImages,
      confidence: 0.5,
      expectedTimeToNeed: 3000,
      recommendedPreloadCount: 2
    };
  }

  // Get current behavior pattern for debugging/monitoring
  getCurrentBehaviorPattern(): BehaviorPattern | null {
    return this.behaviorModel;
  }

  // Start new session tracking
  startSession(): void {
    // Could implement session-based learning here
    // For now, we use continuous learning
  }

  // End session and save patterns
  endSession(): void {
    if (this.recentScrollEvents.length > 0 || this.recentClickEvents.length > 0) {
      const session: UserSession = {
        startTime: Date.now() - 300000, // Approximate 5 minutes ago
        endTime: Date.now(),
        scrollEvents: [...this.recentScrollEvents],
        clickEvents: [...this.recentClickEvents],
        totalImagesViewed: this.recentClickEvents.length,
        averageDwellTime: this.recentClickEvents.length > 0
          ? this.recentClickEvents.reduce((sum, c) => sum + c.dwellTime, 0) / this.recentClickEvents.length
          : 0,
        navigationPattern: this.behaviorModel?.navigationStyle || 'browsing'
      };

      this.sessionHistory.push(session);

      // Keep only recent sessions
      if (this.sessionHistory.length > this.MAX_SESSIONS) {
        this.sessionHistory = this.sessionHistory.slice(-this.MAX_SESSIONS);
      }

      this.saveSessionHistory();
    }
  }

  private loadSessionHistory(): void {
    try {
      const saved = localStorage.getItem('apple-style-session-history');
      if (saved) {
        this.sessionHistory = JSON.parse(saved);
      }
    } catch (error) {
      console.warn('Failed to load session history:', error);
    }
  }

  private saveSessionHistory(): void {
    try {
      localStorage.setItem('apple-style-session-history', JSON.stringify(this.sessionHistory));
    } catch (error) {
      console.warn('Failed to save session history:', error);
    }
  }

  // Reset learning (for testing or user preference)
  resetLearning(): void {
    this.recentScrollEvents = [];
    this.recentClickEvents = [];
    this.sessionHistory = [];
    this.behaviorModel = null;
    localStorage.removeItem('apple-style-session-history');
  }
}

// Singleton instance
export const userBehaviorPredictor = new UserBehaviorPredictor();
export type { ScrollEvent, ClickEvent, UserSession, BehaviorPattern, PredictionResult };