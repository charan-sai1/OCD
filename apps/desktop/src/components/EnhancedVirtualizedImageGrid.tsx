import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
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
  showStatusIndicator?: boolean; // Show image count indicator
  totalFilesInDirectory?: number; // Total files in the directory (for status display)
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
  delayedLoading,
  showStatusIndicator = false,
  totalFilesInDirectory
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const [preloadRange, setPreloadRange] = useState({ start: 0, end: 100 });
  const [showAllImages, setShowAllImages] = useState(false);
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
    if (images.length <= 100) return 0; // No overscan needed for small collections

    // More aggressive overscan for larger collections
    const baseOverscan = Math.max(overscan, Math.ceil(images.length / 50)); // Scale with collection size

    if (scrollVelocity > 10) return baseOverscan * 3; // Fast scrolling, render much more
    if (scrollVelocity > 5) return baseOverscan * 2; // Medium scrolling
    return baseOverscan; // Slow scrolling, moderate overscan
  }, [scrollVelocity, overscan, images.length]);

  // Only render visible items + adaptive buffer
  const renderedImages = useMemo(() => {
    // If user requested to show all images, or collection is small, render everything
    if (showAllImages || images.length <= 100) {
      return images;
    }

    // For larger collections, ensure we have a reasonable visible range
    const minVisibleItems = Math.min(50, images.length); // Always show at least 50 items
    const start = Math.max(0, visibleRange.start - adaptiveOverscan);
    const end = Math.min(images.length, Math.max(visibleRange.end + adaptiveOverscan, start + minVisibleItems));

    const result = images.slice(start, end);

    // Debug logging for large collections
    if (process.env.NODE_ENV === 'development' && images.length > 500) {
      console.log(`VirtualGrid: Rendering ${result.length} images (${start}-${end}) of ${images.length} total`);
    }

    return result;
  }, [images, visibleRange, adaptiveOverscan, showAllImages]);

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

  // Unified scroll handler with reliable scroll detection
  const updateVisibleRange = useCallback((explicitScrollY?: number, explicitVelocity?: number) => {
    if (!gridRef.current) return;

    const now = Date.now();

    // Prioritize explicit scroll position (from smooth scroll libraries), fallback to window scroll
    let currentScrollY: number;
    let velocity: number;

    if (explicitScrollY !== undefined) {
      // Explicit scroll position provided (highest priority)
      currentScrollY = explicitScrollY;
      velocity = explicitVelocity || 0;
    } else {
      // Use window scroll position (reliable fallback)
      currentScrollY = window.scrollY || window.pageYOffset || 0;
      const timeDelta = now - lastScrollTime.current;
      const scrollDelta = currentScrollY - lastScrollY.current;
      velocity = timeDelta > 0 ? Math.abs(scrollDelta / (timeDelta / 1000)) : 0;
    }

    setScrollVelocity(velocity);
    lastScrollY.current = currentScrollY;
    lastScrollTime.current = now;

    const container = gridRef.current;
    const containerRect = container.getBoundingClientRect();
    const itemHeight = containerRect.width / columnCount;
    const visibleHeight = window.innerHeight;
    const scrollTop = Math.max(0, currentScrollY - containerRect.top); // Relative to container

    // Calculate which rows are visible with better bounds checking
    const startRow = Math.max(0, Math.floor(scrollTop / itemHeight) - 2); // More buffer
    const endRow = Math.min(
      Math.ceil(images.length / columnCount),
      Math.floor((scrollTop + visibleHeight) / itemHeight) + 3 // More buffer
    );

    // Convert rows to image indices with safety bounds
    const startIndex = Math.max(0, startRow * columnCount);
    const maxEndIndex = images.length;
    const calculatedEndIndex = Math.min(maxEndIndex, (endRow + 1) * columnCount);
    const endIndex = Math.max(startIndex + 20, calculatedEndIndex); // Minimum 20 items visible

    // Ensure we don't go beyond bounds
    const safeStartIndex = Math.min(startIndex, maxEndIndex - 20);
    const safeEndIndex = Math.min(endIndex, maxEndIndex);

    setVisibleRange({
      start: safeStartIndex,
      end: safeEndIndex
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

  // Calculate total content height for proper scrolling
  const totalContentHeight = useMemo(() => {
    if (images.length <= 100) return 'auto'; // Let browser handle small collections

    const rows = Math.ceil(images.length / columnCount);
    const gapSize = 8; // 8px gap between items
    const totalHeight = rows * (itemHeight + gapSize) - gapSize; // Subtract last gap

    return `${totalHeight}px`;
  }, [images.length, columnCount, itemHeight]);

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
        position: "relative",
        minHeight: totalContentHeight, // Ensure container is tall enough for all content
        overflow: "visible", // Let parent handle scrolling
      }}
    >
      {showStatusIndicator && (
        <Box
          sx={{
            position: "fixed",
            top: 16,
            left: 16,
            zIndex: 1000,
            backgroundColor: "rgba(0, 0, 0, 0.85)",
            color: "white",
            padding: "10px 16px",
            borderRadius: "10px",
            fontSize: "0.8rem",
            fontWeight: 500,
            backdropFilter: "blur(10px)",
            boxShadow: "0 6px 16px rgba(0, 0, 0, 0.3)",
            border: "1px solid rgba(255, 255, 255, 0.15)",
            display: "flex",
            flexDirection: "column",
            gap: "4px",
            minWidth: "220px",
          }}
        >
          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Visible in Grid:</span>
            <span style={{ fontWeight: 700, color: "#4ade80" }}>{renderedImages.length}</span>
          </Box>

          <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <span>Total Imported:</span>
            <span style={{ fontWeight: 700 }}>
              {totalFilesInDirectory !== undefined ? totalFilesInDirectory : images.length}
            </span>
          </Box>

          {images.length > 100 && (
            <Box sx={{ mt: "6px", pt: "6px", borderTop: "1px solid rgba(255, 255, 255, 0.2)" }}>
              <Box sx={{ display: "flex", justifyContent: "space-between", alignItems: "center", mb: "4px" }}>
                <span style={{ fontSize: "0.75rem", opacity: 0.8 }}>Scroll Progress:</span>
                <span style={{ fontSize: "0.75rem", fontWeight: 600 }}>
                  {Math.round((visibleRange.end / images.length) * 100)}%
                </span>
              </Box>
              <Box
                sx={{
                  width: "100%",
                  height: "3px",
                  backgroundColor: "rgba(255, 255, 255, 0.2)",
                  borderRadius: "2px",
                  overflow: "hidden",
                  mb: "6px",
                }}
              >
                <Box
                  sx={{
                    width: `${Math.min(100, (visibleRange.end / images.length) * 100)}%`,
                    height: "100%",
                    backgroundColor: "#3b82f6",
                    borderRadius: "2px",
                    transition: "width 0.3s ease",
                  }}
                />
              </Box>

              {!showAllImages && (
                <Button
                  size="small"
                  variant="outlined"
                  onClick={() => setShowAllImages(true)}
                  sx={{
                    width: "100%",
                    fontSize: "0.7rem",
                    padding: "2px 8px",
                    minHeight: "24px",
                    borderColor: "rgba(255, 255, 255, 0.3)",
                    color: "white",
                    "&:hover": {
                      borderColor: "rgba(255, 255, 255, 0.5)",
                      backgroundColor: "rgba(255, 255, 255, 0.1)",
                    },
                  }}
                >
                  Load All Images
                </Button>
              )}

              {showAllImages && (
                <Box sx={{
                  fontSize: "0.7rem",
                  color: "#4ade80",
                  textAlign: "center",
                  fontWeight: 600
                }}>
                  ✓ All images loaded
                </Box>
              )}
            </Box>
          )}
        </Box>
      )}
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