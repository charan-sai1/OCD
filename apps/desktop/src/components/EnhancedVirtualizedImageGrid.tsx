import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import LazyImageContainer from "./LazyImageContainer";
import { userBehaviorPredictor } from "../utils/userBehaviorPredictor";
import { systemResourceManager } from "../utils/systemResourceManager";
import { predictiveLoadingQueue } from "../utils/predictiveLoadingQueue";
import { visualContinuityManager } from "../utils/visualContinuityManager";
import { lenisScrollManager, type LenisConfig } from "../utils/lenisScrollManager";
import { delayedImageLoader, type DelayedLoadConfig } from "../utils/delayedImageLoader";

interface VirtualGridProps {
  images: string[];
  imageSize: number;
  onImageClick?: (imagePath: string) => void;
  overscan?: number; // Extra items to render outside viewport
  prefetchDistance?: number; // Distance to prefetch thumbnails
  pagesToPreload?: number; // Number of pages to preload ahead (default: 3)

  aggressivePreloading?: boolean; // Ignore memory limits for preloading
  enableSmoothScroll?: boolean; // Enable Lenis smooth scrolling
  lenisConfig?: LenisConfig; // Lenis scroll configuration
  delayedLoading?: DelayedLoadConfig; // Delayed loading configuration
}

// Lazy image container with intersection-based visibility detection
const LazyImageWithIntersection: React.FC<{
  imagePath: string;
  onClick?: () => void;
  onVisible?: () => void;
  distance: number; // Distance from viewport center (0 = in viewport)
  priority: 'high' | 'normal' | 'low';
  prefetchDistance?: number;
}> = memo(({
  imagePath,
  onClick,
  onVisible,
  distance,
  priority,
  prefetchDistance = 2
}) => {
  const [hasTriggeredVisible, setHasTriggeredVisible] = useState(false);

  // Determine loading priority based on distance from viewport
  const getLoadingPriority = useCallback((distance: number): 'high' | 'normal' | 'low' => {
    if (distance <= 0.5) return 'high';   // In viewport
    if (distance <= 1) return 'normal';  // Near viewport
    return 'low';                        // Far away
  }, []);

  const currentPriority = priority !== 'low' ? priority : getLoadingPriority(distance);

  // Notify parent when image becomes visible (for prefetching)
  useEffect(() => {
    if (distance <= prefetchDistance && !hasTriggeredVisible) {
      setHasTriggeredVisible(true);
      onVisible?.();
    }
  }, [distance, prefetchDistance, onVisible, hasTriggeredVisible]);

  return (
    <LazyImageContainer
      imagePath={imagePath}
      width={300}
      height={300}
      aspectRatio={1}
      onClick={onClick}
      onLoad={() => {
        // Could trigger additional logic when image loads
        if (process.env.NODE_ENV === 'development') {
          console.log(`Image loaded: ${imagePath.split('/').pop()}`);
        }
      }}
      onError={(error) => {
        console.warn(`Image failed to load: ${imagePath}`, error);
      }}
      placeholderVariant="shimmer"
      transitionDuration={300}
      priority={currentPriority}
    />
  );
});

LazyImageWithIntersection.displayName = "LazyImageWithIntersection";

const EnhancedVirtualizedImageGrid: React.FC<VirtualGridProps> = memo(({
  images = [],
  imageSize,
  onImageClick,
  overscan = 5,
  prefetchDistance = 3,
  pagesToPreload = 3,
  aggressivePreloading = false,
  enableSmoothScroll = true,
  lenisConfig,
  delayedLoading
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const [preloadRange, setPreloadRange] = useState({ start: 0, end: 100 });
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(Date.now());
  const lenisInitialized = useRef(false);

  // Safety check
  if (!images || images.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, imageSize || 4);

  // Calculate page information based on viewport and grid layout
  const calculatePageInfo = useCallback(() => {
    if (!gridRef.current) return { itemsPerPage: 100, currentPage: 0 };

    const viewportHeight = window.innerHeight;
    const itemSize = gridRef.current.offsetWidth / columnCount;
    const itemsPerRow = columnCount;
    const rowsPerViewport = Math.ceil(viewportHeight / itemSize);
    const itemsPerPage = rowsPerViewport * itemsPerRow;
    const currentPage = Math.floor(window.scrollY / viewportHeight);

    return { itemsPerPage, currentPage };
  }, [columnCount]);

  // Calculate preload range based on current page and pagesToPreload
  const calculatePreloadRange = useCallback((currentPage: number, itemsPerPage: number) => {
    // Load current page + pagesToPreload ahead + 1 page behind for smooth scrolling
    const startPage = Math.max(0, currentPage - 1);
    const endPage = currentPage + pagesToPreload;
    const startIndex = startPage * itemsPerPage;
    const endIndex = Math.min(images.length, endPage * itemsPerPage);

    return { start: startIndex, end: endIndex };
  }, [images.length, pagesToPreload, aggressivePreloading]);

  // Adaptive overscan based on scroll velocity for better performance
  const adaptiveOverscan = useMemo(() => {
    if (scrollVelocity > 10) return overscan * 2; // Fast scrolling, render more
    if (scrollVelocity > 5) return overscan * 1.5; // Medium scrolling
    return overscan; // Slow scrolling, minimal overscan
  }, [scrollVelocity, overscan]);

  // Only render visible items + adaptive buffer
  const renderedImages = useMemo(() => {
    if (images.length <= 100) {
      return images; // Small collections: render all
    }

    const start = Math.max(0, visibleRange.start - adaptiveOverscan);
    const end = Math.min(images.length, visibleRange.end + adaptiveOverscan);

    return images.slice(start, end);
  }, [images, visibleRange, adaptiveOverscan]);

  // Calculate image priority based on page position
  const getImagePriority = useCallback((index: number): 'high' | 'normal' | 'low' => {
    const { currentPage, itemsPerPage } = calculatePageInfo();
    const imagePage = Math.floor(index / itemsPerPage);
    const pageDiff = imagePage - currentPage;

    // Page-based priority assignment
    if (pageDiff === 0) return 'high';      // Current page - highest priority
    if (pageDiff === 1) return 'high';      // Next page - high priority
    if (pageDiff === 2) return 'normal';    // 2 pages ahead - normal priority
    if (pageDiff === -1) return 'low';      // Previous page - low priority (maintenance)
    if (pageDiff === 3) return 'low';       // 3 pages ahead - low priority

    // Beyond preload range - don't preload
    return 'low';
  }, [calculatePageInfo]);

  // Check if image should be prefetched based on preload range
  const shouldPrefetch = useCallback((index: number): boolean => {
    return index >= preloadRange.start && index < preloadRange.end;
  }, [preloadRange]);

  // Apple-style image interaction handling
  const handleImageClick = useCallback((imagePath: string, _index: number) => {
    // Record click behavior for learning
    userBehaviorPredictor.recordClick(imagePath, { x: 0, y: 0 }, 3000); // Assume 3s dwell time

    // Handle visual continuity if transitioning to another view
    if (onImageClick) {
      // Prepare smooth transition
      visualContinuityManager.prepareNextImage(imagePath);
      onImageClick(imagePath);
    }
  }, [onImageClick]);

  const handleImageVisible = useCallback((_index: number) => {
    // Record that this image became visible for behavior learning
    // Note: We could track visibility patterns here for more sophisticated learning
  }, []);

  // Unified scroll handler with optional explicit scroll position/velocity
  const updateVisibleRange = useCallback((explicitScrollY?: number, explicitVelocity?: number) => {
    if (!gridRef.current) return;

    const now = Date.now();
    // Use explicit parameters if provided, otherwise detect scroll
    let currentScrollY: number;
    let velocity: number;

    if (explicitScrollY !== undefined) {
      // Explicit scroll position provided (from Lenis callback)
      currentScrollY = explicitScrollY;
      velocity = explicitVelocity || 0;
    } else if (lenisScrollManager.isActive()) {
      // Use Lenis scroll info as fallback
      const scrollInfo = lenisScrollManager.getScrollInfo();
      currentScrollY = scrollInfo.scroll;
      velocity = scrollInfo.velocity;
    } else {
      // Use native scroll detection
      currentScrollY = window.scrollY;
      const timeDelta = now - lastScrollTime.current;
      const scrollDelta = currentScrollY - lastScrollY.current;
      velocity = timeDelta > 0 ? Math.abs(scrollDelta / (timeDelta / 1000)) : 0;
    }

    setScrollVelocity(velocity);
    lastScrollY.current = currentScrollY;
    lastScrollTime.current = now;

    const container = gridRef.current;
    const itemHeight = container.offsetWidth / columnCount;
    const visibleHeight = window.innerHeight;
    const scrollTop = currentScrollY;

    // Calculate which rows are visible with hysteresis for smoother scrolling
    const startRow = Math.floor(scrollTop / itemHeight) - 1; // Extra row for hysteresis
    const endRow = Math.floor((scrollTop + visibleHeight) / itemHeight) + 1;

    // Convert rows to image indices
    const startIndex = Math.max(0, startRow * columnCount);
    const endIndex = Math.min(images.length, (endRow + 1) * columnCount);

    setVisibleRange({
      start: startIndex,
      end: endIndex
    });

    // Debug logging to identify scrolling issues
    if (process.env.NODE_ENV === 'development') {
      console.log('VirtualGrid: Updated visible range', {
        startIndex,
        endIndex,
        currentScrollY,
        velocity,
        renderedImagesCount: renderedImages.length
      });
    }

    // Apple-style intelligence: predict and preload based on behavior
    const currentPosition = Math.floor(scrollTop / (container.offsetWidth / columnCount));
    // Calculate scroll direction based on last scroll position
    const scrollDelta = currentScrollY - lastScrollY.current;
    const scrollDirection = scrollDelta > 0 ? 'down' : 'up';

    // Record scroll behavior for learning
    userBehaviorPredictor.recordScroll(currentPosition, velocity, scrollDirection as any);

    // Get system-aware loading strategy
    const strategy = systemResourceManager.getAppropriateStrategy();

    // Predict next images based on user behavior
    const prediction = userBehaviorPredictor.predictNextImages(currentPosition, images.length);

    // Adjust prediction based on system resources
    const adjustedPrediction = {
      ...prediction,
      recommendedPreloadCount: Math.min(
        prediction.recommendedPreloadCount,
        strategy.preloadDistance
      )
    };

    // Convert prediction to preloadable images with delayed loading coordination
    const imagesToPreload = [];
    for (let i = 1; i <= adjustedPrediction.recommendedPreloadCount; i++) {
      const nextPos = scrollDirection === 'down'
        ? currentPosition + i
        : currentPosition - i;

      if (nextPos >= 0 && nextPos < images.length) {
        const row = Math.floor(nextPos / columnCount);
        const col = nextPos % columnCount;

        imagesToPreload.push({
          imagePath: `image_${nextPos}`,
          confidence: adjustedPrediction.confidence * (1 - i * 0.1), // Decrease confidence for further images
          expectedTimeToNeed: adjustedPrediction.expectedTimeToNeed + (i * 100), // Later images take longer
          size: 50000 // Estimated 50KB per image
        });

        // Schedule delayed loading for magical cascade effect
        const priority: 'high' | 'normal' | 'low' = i === 1 ? 'high' : i === 2 ? 'normal' : 'low';
        delayedImageLoader.scheduleLoad(
          `image_${nextPos}`,
          { row, col },
          priority
        );
      }
    }

    // Queue intelligent preloading
    if (imagesToPreload.length > 0) {
      predictiveLoadingQueue.enqueueWithPrediction(imagesToPreload);
    }

    // Update preload range based on current page and system resources
    const { currentPage, itemsPerPage } = calculatePageInfo();
    const newPreloadRange = calculatePreloadRange(currentPage, itemsPerPage);
    setPreloadRange(newPreloadRange);

    // Handle rapid scrolling with visual continuity
    if (velocity > 50) {
      visualContinuityManager.handleRapidScroll(velocity, `image_${currentPosition}`);
    }

    // Update delayed loader with current row context for cascading effects
    delayedImageLoader.updateCurrentRow(startRow);
  }, [columnCount, images.length, calculatePageInfo, calculatePreloadRange]);

  // Initialize Lenis smooth scrolling and delayed loading
  useEffect(() => {
    const initializeMagicalScrolling = async () => {
      if (enableSmoothScroll && !lenisInitialized.current) {
        try {
          await lenisScrollManager.initialize(lenisConfig);
          lenisInitialized.current = true;
          console.log('Magical smooth scrolling enabled');
        } catch (error) {
          console.warn('Lenis initialization failed, using native scrolling:', error);
        }
      }

      // Configure delayed loader if provided
      if (delayedLoading) {
        delayedImageLoader.updateConfig(delayedLoading);
      }
    };

    initializeMagicalScrolling();

    return () => {
      // Cleanup will be handled by component unmount
    };
  }, [enableSmoothScroll, lenisConfig, delayedLoading]);

  // Clean scroll event handling - only use one scroll source to avoid conflicts
  useEffect(() => {
    // Start user behavior session
    userBehaviorPredictor.startSession();

    // Set up scroll event handling based on what's available
    let cleanup: (() => void) | null = null;

    if (lenisScrollManager.isActive()) {
      // Use Lenis scroll events - clean and direct
      const unsubscribeLenis = lenisScrollManager.onScroll((scrollInfo) => {
        // Update delayed loader with scroll velocity
        delayedImageLoader.updateScrollVelocity(scrollInfo.velocity);

        // Trigger range updates with explicit scroll position
        updateVisibleRange(scrollInfo.scroll, scrollInfo.velocity);
      });

      cleanup = unsubscribeLenis;
    } else {
      // Use native scroll events with throttling
      let ticking = false;
      let rafId: number;

      const handleNativeScroll = () => {
        if (!ticking) {
          rafId = requestAnimationFrame(() => {
            updateVisibleRange();
            ticking = false;
          });
          ticking = true;
        }
      };

      window.addEventListener('scroll', handleNativeScroll, { passive: true });

      cleanup = () => {
        window.removeEventListener('scroll', handleNativeScroll);
        if (rafId) cancelAnimationFrame(rafId);
      };
    }

    // Initial calculation
    updateVisibleRange();

    // Subscribe to system resource changes
    const unsubscribeResources = systemResourceManager.onBudgetUpdate((budget) => {
      console.log('System resource budget updated:', budget);
    });

    return () => {
      if (cleanup) cleanup();
      unsubscribeResources();

      // End user behavior session
      userBehaviorPredictor.endSession();
    };
  }, [updateVisibleRange]);

  // Memoize expensive calculations
  const itemHeight = useMemo(() => {
    if (!gridRef.current) return 100;
    return gridRef.current.getBoundingClientRect().width / columnCount;
  }, [columnCount]);

  // Calculate distance from viewport center for loading priority
  const calculateDistanceFromViewport = useCallback((index: number): number => {
    if (!gridRef.current) return Infinity;

    const gridRect = gridRef.current.getBoundingClientRect();
    const viewportCenter = window.innerHeight / 2;
    const row = Math.floor(index / columnCount);
    const itemTop = gridRect.top + (row * itemHeight);
    const itemCenter = itemTop + (itemHeight / 2);

    return Math.abs(itemCenter - viewportCenter) / window.innerHeight;
  }, [columnCount, itemHeight]);

  return (
    <Box
      ref={gridRef}
      sx={{
        width: "100%",
        padding: 1,
        boxSizing: "border-box",
        // Basic container for scrolling - removed potential conflicting styles
        overflow: "visible", // Let parent handle scrolling
        position: "relative",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
          gap: 1,
          width: "100%",
          // Optimize for GPU acceleration
          contain: "layout style paint",
        }}
      >
        {renderedImages.map((imagePath) => {
          const actualIndex = images.indexOf(imagePath);
          const distance = calculateDistanceFromViewport(actualIndex);
          const pagePriority = getImagePriority(actualIndex);
          const shouldBePrefetched = shouldPrefetch(actualIndex);

          // Combine distance and page priority for optimal loading
          const priority = pagePriority === 'high' ? 'high' : distance <= 0.5 ? 'high' : 'normal';

          return (
            <Box
              key={`${imagePath}-${actualIndex}`}
              sx={{
                aspectRatio: "1",
                width: "100%",
                maxWidth: "100%",
                contain: "layout style paint",
                transform: "translateZ(0)",
                willChange: "transform",
              }}
            >
              <LazyImageWithIntersection
                imagePath={imagePath}
                onClick={() => handleImageClick(imagePath, actualIndex)}
                onVisible={() => handleImageVisible(actualIndex)}
                distance={distance}
                priority={priority}
                prefetchDistance={shouldBePrefetched ? prefetchDistance : 0}
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

EnhancedVirtualizedImageGrid.displayName = "EnhancedVirtualizedImageGrid";

export default EnhancedVirtualizedImageGrid;