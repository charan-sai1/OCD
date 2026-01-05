import React, { memo, useCallback, useEffect, useRef } from "react";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import { asyncScheduler } from "../utils/requestIdleCallbackPolyfill";
import { LoadingPriority } from "../utils/progressiveImagePreloader";
import ProgressiveImage from "./ProgressiveImage";

interface VirtualImageGridProps {
  images: string[];
  imageSize: number;
  onImageClick?: (imagePath: string) => void;
  isLoadingImages?: boolean;
  onLoadMore?: () => void;
  hasMore?: boolean;
}

// Progressive image component with intersection-based loading priority
const ProgressiveImageWithIntersection: React.FC<{
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
  const getLoadingPriority = useCallback((distance: number): LoadingPriority => {
    if (distance <= 0.5) return LoadingPriority.IMMEDIATE; // In viewport
    if (distance <= 1) return LoadingPriority.HIGH;       // Near viewport
    if (distance <= 2) return LoadingPriority.NORMAL;     // Medium distance
    if (distance <= 3) return LoadingPriority.LOW;        // Far distance
    return LoadingPriority.IDLE;                          // Very far
  }, []);

  const priority = getLoadingPriority(distance);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            onVisible?.();
            observer.unobserve(container);
          }
        });
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
      <ProgressiveImage
        imagePath={imagePath}
        alt={alt}
        onClick={onClick}
        priority={priority}
        enableTransitions={true}
        transitionDuration={300}
      />
    </div>
  );
});

ProgressiveImageWithIntersection.displayName = "ProgressiveImageWithIntersection";

const VirtualImageGrid: React.FC<VirtualImageGridProps> = memo(({
  images = [],
  imageSize,
  onImageClick,
  isLoadingImages = false,
  onLoadMore,
  hasMore = false,
}) => {
  const gridRef = useRef<HTMLDivElement>(null);

  // Safety check
  if (!images || images.length === 0) {
    return null;
  }

  const columnCount = Math.max(1, imageSize || 4);

  // Calculate distance from viewport center for loading priority
  const calculateDistanceFromViewport = useCallback((index: number): number => {
    if (!gridRef.current) return Infinity;

    const gridRect = gridRef.current.getBoundingClientRect();
    const viewportCenter = window.innerHeight / 2;
    const itemHeight = gridRect.width / columnCount; // Approximate item height (square aspect ratio)
    const row = Math.floor(index / columnCount);
    const itemTop = gridRect.top + (row * itemHeight);
    const itemCenter = itemTop + (itemHeight / 2);

    return Math.abs(itemCenter - viewportCenter) / window.innerHeight; // Distance in viewport heights
  }, [columnCount]);

  // Trigger onLoadMore when approaching end
  const handleImageVisible = useCallback((index: number) => {
    if (onLoadMore && !isLoadingImages && images.length > 0) {
      const preloadThreshold = Math.max(0, images.length - 50); // Reduced threshold for better UX
      if (index >= preloadThreshold) {
        asyncScheduler.schedule(() => onLoadMore());
      }
    }
  }, [onLoadMore, isLoadingImages, images.length]);

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
        {images.map((imagePath, index) => {
          const distance = calculateDistanceFromViewport(index);

          return (
            <Box
              key={`${imagePath}-${index}`}
              sx={{
                aspectRatio: "1",
                width: "100%",
                maxWidth: "100%",
                contain: "layout style paint",
                transform: "translateZ(0)",
                willChange: "transform",
              }}
            >
              <ProgressiveImageWithIntersection
                imagePath={imagePath}
                alt={imagePath.split("/").pop() || `Image ${index + 1}`}
                onClick={() => onImageClick?.(imagePath)}
                onVisible={() => handleImageVisible(index)}
                distance={distance}
              />
            </Box>
          );
        })}
      </Box>

      {/* Loading indicator at bottom */}
      {hasMore && (
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
