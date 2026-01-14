import React, { memo, useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import LazyImageContainer from "./LazyImageContainer";
import { userBehaviorPredictor } from "../utils/userBehaviorPredictor";

interface ResponsivePhotoGridProps {
  images: string[];
  onImageClick?: (imagePath: string) => void;
  gap?: number; // Gap between items
}

const ResponsivePhotoGrid: React.FC<ResponsivePhotoGridProps> = memo(({
  images = [],
  onImageClick,
  gap = 8
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });

  // Simplified visible range calculation for CSS Grid
  const updateVisibleRange = useCallback(() => {
    const scrollTop = window.scrollY;
    const viewportHeight = window.innerHeight;

    // Rough estimation for grid layout (120px min size + 8px gap ≈ 128px per item)
    const estimatedItemSize = 128; // approximate item height including gap
    const estimatedCols = Math.max(1, Math.floor(window.innerWidth / 128));
    const estimatedRows = Math.ceil(viewportHeight / estimatedItemSize);

    // Add buffer for smooth scrolling
    const bufferRows = 4;
    const startRow = Math.max(0, Math.floor(scrollTop / estimatedItemSize) - bufferRows);
    const endRow = startRow + estimatedRows + (bufferRows * 2);

    const startIndex = startRow * estimatedCols;
    const endIndex = Math.min(endRow * estimatedCols, images.length);

    setVisibleRange({ start: startIndex, end: endIndex });
  }, [images.length]);

  // Update visible range on scroll (removed resize listener for performance)
  useEffect(() => {
    updateVisibleRange();
    window.addEventListener('scroll', updateVisibleRange, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateVisibleRange);
    };
  }, [updateVisibleRange]);

  // Initialize user behavior tracking
  useEffect(() => {
    userBehaviorPredictor.startSession();
  }, []);

  // Handle image clicks
  const handleImageClick = useCallback((imagePath: string) => {
    onImageClick?.(imagePath);
  }, [onImageClick]);

  // Safety check
  if (!images || images.length === 0) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        color: 'text.secondary'
      }}>
        No images to display
      </Box>
    );
  }

  return (
    <Box
      ref={gridRef}
      sx={{
        width: '100%',
        minHeight: '100vh',
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: `${gap}px`,
        // Let content flow naturally - no fixed height container needed
      }}
    >
      {/* Render only visible images in natural grid flow */}
      {images.slice(visibleRange.start, visibleRange.end).map((imagePath, index) => {
        const priority =
          index < 12 ? 'high' :  // First 12 items
          index < 24 ? 'normal' : // Next 12 items
          'low'; // Rest

        return (
          <Box
            key={`${imagePath}-${visibleRange.start + index}`}
            sx={{
              aspectRatio: '1',
              cursor: onImageClick ? 'pointer' : 'default',
              // CSS Grid handles positioning automatically
            }}
            onClick={() => handleImageClick(imagePath)}
          >
            <LazyImageContainer
              imagePath={imagePath}
              onClick={() => handleImageClick(imagePath)}
              placeholderVariant="shimmer"
              priority={priority}
            />
          </Box>
        );
      })}
    </Box>
  );
});

ResponsivePhotoGrid.displayName = "ResponsivePhotoGrid";

export default ResponsivePhotoGrid;