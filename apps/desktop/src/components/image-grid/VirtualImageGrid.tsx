import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import FastImage from "../ui/FastImage";

interface VirtualImageGridProps {
  images: string[];
  imageSize: number;
  onImageClick?: (imagePath: string) => void;
  isLoadingImages?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

// Fast image component with intersection-based loading priority
const FastImageWithIntersection: React.FC<{
  imagePath: string;
  alt: string;
  onClick?: () => void;
  onVisible?: () => void;
  distance: number; // Distance from viewport center (0 = in viewport)
}> = memo(({
  imagePath,
  alt,
  onClick,
  onVisible,
  distance
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  // Determine loading priority based on distance from viewport
  const getLoadingPriority = useCallback((distance: number): 'high' | 'normal' | 'low' => {
    if (distance <= 0.5) return 'high';   // In viewport
    if (distance <= 1) return 'normal';  // Near viewport
    return 'low';                        // Far away
  }, []);

  const priority = getLoadingPriority(distance);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        // Throttle updates to prevent excessive processing
        const visibleEntries = entries.filter(entry => entry.isIntersecting);
        if (visibleEntries.length > 0) {
          onVisible?.();
          observer.unobserve(container);
        }
      },
      {
        rootMargin: "200px", // Start loading 200px before visible
        threshold: 0.01,
      }
    );

    observer.observe(container);

    return () => observer.disconnect();
  }, [onVisible]);

  return (
    <div ref={containerRef}>
      <FastImage
        imagePath={imagePath}
        alt={alt}
        onClick={onClick}
        priority={priority}
        width={300}
        height={300}
      />
    </div>
  );
});

FastImageWithIntersection.displayName = "FastImageWithIntersection";

const VirtualImageGrid: React.FC<VirtualImageGridProps> = memo(({
  images = [],
  imageSize,
  onImageClick,
  isLoadingImages: _isLoadingImages = false,
  onLoadMore: _onLoadMore,
  hasMore: _hasMore = false,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 100 }); // Default render first 100

  // Safety check
  if (!images || images.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, imageSize || 4);

  // Calculate which images should be rendered based on viewport
  const renderedImages = useMemo(() => {
    if (images.length <= 100) {
      // Small collections: render all
      return { items: images, startIndex: 0 };
    }

    // Large collections: render only visible range + buffer
    const buffer = 20; // Smaller buffer for better performance
    const start = Math.max(0, visibleRange.start - buffer);
    const end = Math.min(images.length, visibleRange.end + buffer);

    return {
      items: images.slice(start, end),
      startIndex: start
    };
  }, [images, visibleRange]);

  // Update visible range based on scroll position
  const updateVisibleRange = useCallback(() => {
    if (!gridRef.current) return;

    const container = gridRef.current;
    const itemHeight = container.offsetWidth / columnCount;
    const visibleHeight = window.innerHeight;
    const scrollTop = window.scrollY;

    // Calculate which rows are visible
    const startRow = Math.floor(scrollTop / itemHeight);
    const endRow = Math.floor((scrollTop + visibleHeight) / itemHeight);

    // Convert rows to image indices
    const startIndex = startRow * columnCount;
    const endIndex = (endRow + 1) * columnCount;

    setVisibleRange({
      start: Math.max(0, startIndex),
      end: Math.min(images.length, endIndex + columnCount * 2) // Add buffer
    });
  }, [columnCount, images.length]);

  // Listen for scroll events (throttled)
  useEffect(() => {
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          updateVisibleRange();
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    updateVisibleRange(); // Initial calculation

    return () => window.removeEventListener('scroll', handleScroll);
  }, [updateVisibleRange]);

  // Note: Preloading is now handled by FastImage component with caching

  // Memoize expensive calculations
  const itemHeight = useMemo(() => {
    if (!gridRef.current) return 100; // Default fallback
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

    return Math.abs(itemCenter - viewportCenter) / window.innerHeight; // Distance in viewport heights
  }, [columnCount, itemHeight]);

  // Trigger onLoadMore when approaching end (disabled for static collections)
  const handleImageVisible = useCallback((_index: number) => {
    // For static collections, we don't need load more functionality
    // This prevents unnecessary processing for large image sets
    return;
  }, []);

  return (
    <Box
      ref={gridRef}
      sx={{
        width: "100%",
        padding: 1,
        boxSizing: "border-box",
      }}
    >
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
          gap: 1,
          width: "100%",
        }}
      >
        {renderedImages.items.map((imagePath, renderIndex) => {
          const actualIndex = renderedImages.startIndex + renderIndex;
          const distance = calculateDistanceFromViewport(actualIndex);

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
                contentVisibility: "auto",
              }}
            >
              <FastImageWithIntersection
                imagePath={imagePath}
                alt={imagePath.split("/").pop() || `Image ${actualIndex + 1}`}
                onClick={() => onImageClick?.(imagePath)}
                onVisible={() => handleImageVisible(actualIndex)}
                distance={distance}
              />
            </Box>
          );
        })}
      </Box>

      {/* Loading indicator at bottom */}
      {_hasMore && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            py: 2,
            mt: 2,
          }}
        >
          <CircularProgress size={24} />
          <Box sx={{ ml: 1, color: "text.secondary", fontSize: "0.875rem" }}>
            Loading more images...
          </Box>
        </Box>
      )}
    </Box>
  );
});

VirtualImageGrid.displayName = "VirtualImageGrid";

export default VirtualImageGrid;
