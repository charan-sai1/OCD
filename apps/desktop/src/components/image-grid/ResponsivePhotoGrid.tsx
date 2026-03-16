import React, { memo, useRef } from "react";
import Box from "@mui/material/Box";
import LazyImageContainer from "./LazyImageContainer";

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

  // For 571 images, virtual scrolling is unnecessary - just render all images
  // Modern browsers can handle this easily and CSS Grid will handle the layout



  // Handle image clicks
  const handleImageClick = (imagePath: string) => {
    onImageClick?.(imagePath);
  };

  // Safety check
  if (!images || images.length === 0) {
    console.log(`[Image Grid] No images available to display`);
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

  console.log(`[Image Grid] Rendering all ${images.length} images (no virtual scrolling)`);

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
      {/* Render all images - lazy loading will still handle actual image loading */}
      {images.map((imagePath, index) => {
        const priority =
          index < 12 ? 'high' :  // First 12 items get high priority
          index < 48 ? 'normal' : // Next items get normal priority
          'low'; // Rest get low priority

        return (
          <Box
            key={`${imagePath}-${index}`}
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