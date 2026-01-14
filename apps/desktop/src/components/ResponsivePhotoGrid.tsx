import React, { memo, useCallback, useEffect, useRef, useState, useMemo } from "react";
import Box from "@mui/material/Box";
import LazyImageContainer from "./LazyImageContainer";
import { userBehaviorPredictor } from "../utils/userBehaviorPredictor";

interface ResponsivePhotoGridProps {
  images: string[];
  onImageClick?: (imagePath: string) => void;
  thumbnailSize?: number; // Default 64px as user requested
  gap?: number; // Gap between items
}

const ResponsivePhotoGrid: React.FC<ResponsivePhotoGridProps> = memo(({
  images = [],
  onImageClick,
  thumbnailSize = 64,
  gap = 8
}) => {
  const gridRef = useRef<HTMLDivElement>(null);
  const [visibleRange, setVisibleRange] = useState({ start: 0, end: 50 });
  const [containerWidth, setContainerWidth] = useState(0);

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

  // Calculate how many items fit per row based on container width
  const itemsPerRow = useMemo(() => {
    if (containerWidth === 0) return 4; // Default fallback
    return Math.max(1, Math.floor((containerWidth + gap) / (thumbnailSize + gap)));
  }, [containerWidth, thumbnailSize, gap]);

  // Update container width on resize
  useEffect(() => {
    const updateWidth = () => {
      if (gridRef.current) {
        setContainerWidth(gridRef.current.offsetWidth);
      }
    };

    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  // Calculate visible range for virtualization
  const updateVisibleRange = useCallback(() => {
    if (!gridRef.current) return;

    const container = gridRef.current;
    const scrollTop = container.scrollTop || window.scrollY;
    const containerHeight = container.offsetHeight || window.innerHeight;

    // Calculate which rows are visible
    const rowHeight = thumbnailSize + gap;
    const startRow = Math.max(0, Math.floor(scrollTop / rowHeight) - 2); // Buffer
    const visibleRows = Math.ceil(containerHeight / rowHeight) + 4; // Extra buffer
    const endRow = startRow + visibleRows;

    // Convert rows to item indices
    const startIndex = Math.max(0, startRow * itemsPerRow);
    const endIndex = Math.min(images.length, endRow * itemsPerRow);

    setVisibleRange({ start: startIndex, end: endIndex });
  }, [itemsPerRow, thumbnailSize, gap, images.length]);

  // Update visible range on scroll and resize
  useEffect(() => {
    updateVisibleRange();
    window.addEventListener('scroll', updateVisibleRange, { passive: true });
    window.addEventListener('resize', updateVisibleRange, { passive: true });

    return () => {
      window.removeEventListener('scroll', updateVisibleRange);
      window.removeEventListener('resize', updateVisibleRange);
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

  // Calculate total height for smooth scrolling
  const totalHeight = useMemo(() => {
    const totalRows = Math.ceil(images.length / itemsPerRow);
    return totalRows * (thumbnailSize + gap) - gap; // Subtract last gap
  }, [images.length, itemsPerRow, thumbnailSize, gap]);

  return (
    <Box
      ref={gridRef}
      sx={{
        width: '100%',
        height: '100%',
        overflow: 'auto',
        position: 'relative'
      }}
    >
      {/* Virtual container with calculated height */}
      <Box
        sx={{
          width: '100%',
          height: `${totalHeight}px`,
          position: 'relative'
        }}
      >
        {/* Render only visible images */}
        {images.slice(visibleRange.start, visibleRange.end).map((imagePath, index) => {
          const actualIndex = visibleRange.start + index;
          const row = Math.floor(actualIndex / itemsPerRow);
          const col = actualIndex % itemsPerRow;

          const top = row * (thumbnailSize + gap);
          const left = col * (thumbnailSize + gap);

          return (
            <Box
              key={`${imagePath}-${actualIndex}`}
              sx={{
                position: 'absolute',
                top: `${top}px`,
                left: `${left}px`,
                width: `${thumbnailSize}px`,
                height: `${thumbnailSize}px`,
                cursor: onImageClick ? 'pointer' : 'default'
              }}
              onClick={() => handleImageClick(imagePath)}
            >
              <LazyImageContainer
                imagePath={imagePath}
                width={thumbnailSize}
                height={thumbnailSize}
                aspectRatio={1}
                onClick={() => handleImageClick(imagePath)}
                placeholderVariant="shimmer"
                priority={
                  index < 12 ? 'high' :  // First 12 items
                  index < 24 ? 'normal' : // Next 12 items
                  'low' // Rest
                }
              />
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

ResponsivePhotoGrid.displayName = "ResponsivePhotoGrid";

export default ResponsivePhotoGrid;