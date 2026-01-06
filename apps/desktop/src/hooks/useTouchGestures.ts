import React, { useRef, useCallback } from 'react';

export interface TouchGestureConfig {
  onSwipeLeft?: () => void;
  onSwipeRight?: () => void;
  onSwipeUp?: () => void;
  onSwipeDown?: () => void;
  onPinch?: (scale: number) => void;
  onDoubleTap?: () => void;
  swipeThreshold?: number;
  pinchThreshold?: number;
  doubleTapDelay?: number;
  preventBrowserGestures?: boolean;
}

export interface TouchState {
  startX: number;
  startY: number;
  currentX: number;
  currentY: number;
  startTime: number;
  isTracking: boolean;
  touchCount: number;
  scale: number;
  lastTapTime: number;
  isHorizontalSwipe: boolean;
  isVerticalSwipe: boolean;
}

const useTouchGestures = (config: TouchGestureConfig) => {
  const touchStateRef = useRef<TouchState>({
    startX: 0,
    startY: 0,
    currentX: 0,
    currentY: 0,
    startTime: 0,
    isTracking: false,
    touchCount: 0,
    scale: 1,
    lastTapTime: 0,
    isHorizontalSwipe: false,
    isVerticalSwipe: false,
  });

  const {
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onPinch,
    onDoubleTap,
    swipeThreshold = 50,
    pinchThreshold = 0.1,
    doubleTapDelay = 300,
    preventBrowserGestures = true,
  } = config;

  const handleTouchStart = useCallback((e: TouchEvent) => {
    const touchState = touchStateRef.current;
    const touches = e.touches;

    // Prevent default browser gestures if configured
    if (preventBrowserGestures && touches.length > 1) {
      e.preventDefault();
    }

    if (touches.length === 1) {
      // Single touch - potential swipe or tap
      const touch = touches[0];
      touchState.startX = touch.clientX;
      touchState.startY = touch.clientY;
      touchState.currentX = touch.clientX;
      touchState.currentY = touch.clientY;
      touchState.startTime = Date.now();
      touchState.isTracking = true;
      touchState.touchCount = 1;
      touchState.isHorizontalSwipe = false;
      touchState.isVerticalSwipe = false;
    } else if (touches.length === 2 && onPinch) {
      // Pinch gesture - prevent browser zoom
      e.preventDefault();

      const touch1 = touches[0];
      const touch2 = touches[1];

      const initialDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );

      touchState.startX = initialDistance;
      touchState.scale = 1;
      touchState.touchCount = 2;
      touchState.isTracking = true;
    }
  }, [onPinch, preventBrowserGestures]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const touchState = touchStateRef.current;

    if (!touchState.isTracking) return;

    const touches = e.touches;

    if (touches.length === 1 && touchState.touchCount === 1) {
      // Single touch move - detect swipe direction
      const touch = touches[0];
      const deltaX = Math.abs(touch.clientX - touchState.startX);
      const deltaY = Math.abs(touch.clientY - touchState.startY);

      // Determine swipe direction once movement exceeds threshold
      if (!touchState.isHorizontalSwipe && !touchState.isVerticalSwipe) {
        if (deltaX > 10 || deltaY > 10) {
          if (deltaX > deltaY) {
            touchState.isHorizontalSwipe = true;
            // Prevent vertical scrolling during horizontal swipe
            e.preventDefault();
          } else {
            touchState.isVerticalSwipe = true;
            // Allow vertical scrolling but prevent if we have swipe handlers
            if (onSwipeUp || onSwipeDown) {
              e.preventDefault();
            }
          }
        }
      } else if (touchState.isHorizontalSwipe) {
        // Prevent scrolling during confirmed horizontal swipe
        e.preventDefault();
      }

      touchState.currentX = touch.clientX;
      touchState.currentY = touch.clientY;
    } else if (touches.length === 2 && touchState.touchCount === 2 && onPinch) {
      // Pinch move - always prevent default
      e.preventDefault();

      const touch1 = touches[0];
      const touch2 = touches[1];

      const currentDistance = Math.sqrt(
        Math.pow(touch2.clientX - touch1.clientX, 2) +
        Math.pow(touch2.clientY - touch1.clientY, 2)
      );

      const newScale = currentDistance / touchState.startX;
      const scaleDelta = newScale - touchState.scale;

      if (Math.abs(scaleDelta) > pinchThreshold) {
        onPinch(newScale);
        touchState.scale = newScale;
      }
    }
  }, [onPinch, pinchThreshold, onSwipeUp, onSwipeDown]);

  const handleTouchEnd = useCallback((_e: TouchEvent) => {
    const touchState = touchStateRef.current;

    if (!touchState.isTracking) return;

    const endTime = Date.now();
    const duration = endTime - touchState.startTime;

    // Handle single touch gestures
    if (touchState.touchCount === 1) {
      const deltaX = touchState.currentX - touchState.startX;
      const deltaY = touchState.currentY - touchState.startY;
      const absDeltaX = Math.abs(deltaX);
      const absDeltaY = Math.abs(deltaY);

      // Check for double tap
      if (onDoubleTap && duration < 300 && absDeltaX < 10 && absDeltaY < 10) {
        const timeSinceLastTap = endTime - touchState.lastTapTime;
        if (timeSinceLastTap < doubleTapDelay) {
          onDoubleTap();
          touchState.lastTapTime = 0;
        } else {
          touchState.lastTapTime = endTime;
        }
      } else {
        // Check for swipe gestures
        const isHorizontalSwipe = absDeltaX > absDeltaY;
        const isVerticalSwipe = absDeltaY > absDeltaX;

        if (absDeltaX > swipeThreshold || absDeltaY > swipeThreshold) {
          if (isHorizontalSwipe) {
            if (deltaX > 0 && onSwipeRight) {
              onSwipeRight();
            } else if (deltaX < 0 && onSwipeLeft) {
              onSwipeLeft();
            }
          } else if (isVerticalSwipe) {
            if (deltaY > 0 && onSwipeDown) {
              onSwipeDown();
            } else if (deltaY < 0 && onSwipeUp) {
              onSwipeUp();
            }
          }
        }
      }
    }

    // Reset touch state
    touchState.isTracking = false;
    touchState.touchCount = 0;
  }, [
    onSwipeLeft,
    onSwipeRight,
    onSwipeUp,
    onSwipeDown,
    onDoubleTap,
    swipeThreshold,
    doubleTapDelay,
  ]);

  // Device orientation change handling
  const handleOrientationChange = useCallback(() => {
    // Reset touch state on orientation change
    const touchState = touchStateRef.current;
    touchState.isTracking = false;
    touchState.touchCount = 0;
    touchState.isHorizontalSwipe = false;
    touchState.isVerticalSwipe = false;
  }, []);

  // Add orientation change listener
  React.useEffect(() => {
    window.addEventListener('orientationchange', handleOrientationChange);
    window.addEventListener('resize', handleOrientationChange);

    return () => {
      window.removeEventListener('orientationchange', handleOrientationChange);
      window.removeEventListener('resize', handleOrientationChange);
    };
  }, [handleOrientationChange]);

  const attachListeners = useCallback((element: HTMLElement | null) => {
    if (!element) return;

    // Use passive listeners where possible for better performance
    element.addEventListener('touchstart', handleTouchStart, { passive: false });
    element.addEventListener('touchmove', handleTouchMove, { passive: false });
    element.addEventListener('touchend', handleTouchEnd, { passive: true });

    return () => {
      element.removeEventListener('touchstart', handleTouchStart);
      element.removeEventListener('touchmove', handleTouchMove);
      element.removeEventListener('touchend', handleTouchEnd);
    };
  }, [handleTouchStart, handleTouchMove, handleTouchEnd]);

  return {
    attachListeners,
    isTracking: touchStateRef.current.isTracking,
    touchCount: touchStateRef.current.touchCount,
  };
};

export default useTouchGestures;