import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FastImage from "./FastImage";
import { advancedImageCache } from "../utils/advancedCache";
import { DeviceCapabilities } from "../utils/deviceCapabilities";

interface VirtualGridProps {
  images: string[];
  imageSize: number;
  onImageClick?: (imagePath: string) => void;
  overscan?: number; // Extra items to render outside viewport
  prefetchDistance?: number; // Distance to prefetch thumbnails
}

// Enhanced FastImage component with intersection-based loading and prefetching
const FastImageWithIntersection: React.FC<{
  imagePath: string;
  alt: string;
  onClick?: () => void;
  onVisible?: () => void;
  distance: number; // Distance from viewport center (0 = in viewport)
  priority: 'high' | 'normal' | 'low';
  prefetchDistance?: number;
}> = memo(({
  imagePath,
  alt,
  onClick,
  onVisible,
  distance,
  priority,
  prefetchDistance = 2
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isVisible, setIsVisible] = useState(false);
  const [isPrefetched, setIsPrefetched] = useState(false);

  // Determine loading priority based on distance from viewport
  const getLoadingPriority = useCallback((distance: number): 'high' | 'normal' | 'low' => {
    if (distance <= 0.5) return 'high';   // In viewport
    if (distance <= 1) return 'normal';  // Near viewport
    return 'low';                        // Far away
  }, []);

  const currentPriority = priority !== 'low' ? priority : getLoadingPriority(distance);

  // Prefetch thumbnails for nearby images
  useEffect(() => {
    if (Math.abs(distance) <= prefetchDistance && !isPrefetched) {
      const prefetchThumbnail = async () => {
        try {
          const deviceProfile = DeviceCapabilities.detect();
          const cachedUrl = await advancedImageCache.get(imagePath, deviceProfile.recommendedSettings.quality);

          if (!cachedUrl) {
            // Thumbnail not cached, could trigger generation here if needed
            // For now, just mark as prefetched to avoid repeated attempts
          }
          setIsPrefetched(true);
        } catch (error) {
          console.warn('Prefetch failed for', imagePath, error);
        }
      };

      prefetchThumbnail();
    }
  }, [distance, prefetchDistance, imagePath, isPrefetched]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        const wasVisible = isVisible;

        setIsVisible(visibleEntries.length > 0);

        if (visibleEntries.length > 0 && !wasVisible) {
          onVisible?.();
        }
      },
      {
        rootMargin: "200px", // Start loading 200px before visible
        threshold: 0.01,
      }
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, [onVisible, isVisible]);

  return (
    <div ref={containerRef}>
      <FastImage
        imagePath={imagePath}
        alt={alt}
        onClick={onClick}
        priority={currentPriority}
        width={300}
        height={300}
      />
    </div>
  );
});

FastImageWithIntersection.displayName = "FastImageWithIntersection";

const EnhancedVirtualizedImageGrid: React.FC<VirtualGridProps> = memo(({
  images = [],
  imageSize,
  onImageClick,
  overscan = 5,
  prefetchDistance = 3
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 });
  const [scrollVelocity, setScrollVelocity] = useState(0);
  const lastScrollY = useRef(0);
  const lastScrollTime = useRef(Date.now());

  // Safety check
  if (!images || images.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, imageSize || 4);

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

  // Enhanced scroll handler with velocity tracking
  const updateVisibleRange = useCallback(() => {
    if (!gridRef.current) return;

    const now = Date.now();
    const currentScrollY = window.scrollY;
    const timeDelta = now - lastScrollTime.current;
    const scrollDelta = currentScrollY - lastScrollY.current;

    // Calculate scroll velocity (pixels per second)
    const velocity = timeDelta > 0 ? Math.abs(scrollDelta / (timeDelta / 1000)) : 0;
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
  }, [columnCount, images.length]);

  // Throttled scroll listener for better performance
  useEffect(() => {
    let ticking = false;
    let rafId: number;

    const handleScroll = () => {
      if (!ticking) {
        rafId = requestAnimationFrame(() => {
          updateVisibleRange();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    updateVisibleRange(); // Initial calculation

    return () => {
      window.removeEventListener('scroll', handleScroll);
      if (rafId) cancelAnimationFrame(rafId);
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
        // Hardware acceleration for smooth scrolling
        transform: "translateZ(0)",
        willChange: "transform",
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
          const priority = distance <= 0.5 ? 'high' : distance <= 1 ? 'normal' : 'low';

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
              <FastImageWithIntersection
                imagePath={imagePath}
                alt={imagePath.split("/").pop() || `Image ${actualIndex + 1}`}
                onClick={() => onImageClick?.(imagePath)}
                distance={distance}
                priority={priority}
                prefetchDistance={prefetchDistance}
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