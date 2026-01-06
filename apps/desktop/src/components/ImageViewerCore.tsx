import React, { useCallback } from 'react';
import { Box, Typography, Paper } from '@mui/material';

interface CachedImage {
  url: string;
  loadedAt: number;
  size: number; // estimated size in bytes
}

interface TransitionState {
  isTransitioning: boolean;
  direction: 'left' | 'right' | null;
  progress: number; // 0-1
  startIndex: number;
  targetIndex: number;
}

interface ImageViewerCoreProps {
  currentIndex: number;
  isImmersiveMode: boolean;
  onToggleImmersiveMode: () => void;
  zoomLevel: number;
  transitionState: TransitionState;
  displayImage: CachedImage | undefined;
  imageName: string;
  isCurrentLoading: boolean;
}

const ImageViewerCore: React.FC<ImageViewerCoreProps> = React.memo(({
  currentIndex,
  isImmersiveMode,
  onToggleImmersiveMode,
  zoomLevel,
  transitionState,
  displayImage,
  imageName,
  isCurrentLoading
}) => {
  // Pan state for zoomed images
  const [panPosition, setPanPosition] = React.useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = React.useState(false);
  const [dragStart, setDragStart] = React.useState({ x: 0, y: 0 });
  // Calculate transition transform
  const getTransitionTransform = useCallback(() => {
    if (!transitionState.isTransitioning) return 'translateX(0)';

    const { direction, progress } = transitionState;
    const offset = direction === 'left' ? -progress * 100 : progress * 100;
    return `translateX(${offset}%)`;
  }, [transitionState]);

  const handleImageClick = useCallback(() => {
    onToggleImmersiveMode();
  }, [onToggleImmersiveMode]);

  // Pan functionality for zoomed images
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (zoomLevel <= 1) return;

    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - panPosition.x, y: e.clientY - panPosition.y });
  }, [zoomLevel, panPosition]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isDragging || zoomLevel <= 1) return;

    const newX = e.clientX - dragStart.x;
    const newY = e.clientY - dragStart.y;
    setPanPosition({ x: newX, y: newY });
  }, [isDragging, zoomLevel, dragStart]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  // Reset pan position when zoom changes or image changes
  React.useEffect(() => {
    setPanPosition({ x: 0, y: 0 });
  }, [zoomLevel, currentIndex]);

  // Touch pan support
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (zoomLevel <= 1 || e.touches.length !== 1) return;

    const touch = e.touches[0];
    setIsDragging(true);
    setDragStart({ x: touch.clientX - panPosition.x, y: touch.clientY - panPosition.y });
  }, [zoomLevel, panPosition]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!isDragging || zoomLevel <= 1 || e.touches.length !== 1) return;

    e.preventDefault();
    const touch = e.touches[0];
    const newX = touch.clientX - dragStart.x;
    const newY = touch.clientY - dragStart.y;
    setPanPosition({ x: newX, y: newY });
  }, [isDragging, zoomLevel, dragStart]);

  const handleTouchEnd = useCallback(() => {
    setIsDragging(false);
  }, []);

  return (
    <>





      {/* Image container with smooth transitions - Full viewport usage */}
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: zoomLevel > 1 ? 'grab' : 'default',
          // GPU acceleration for smooth transitions
          transform: 'translateZ(0)',
          willChange: 'transform',
          '&::before': transitionState.isTransitioning ? {
            content: '""',
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(0, 0, 0, 0.05)',
            zIndex: 1,
            pointerEvents: 'none'
          } : {}
        }}
      >
        {/* Loading indicator */}
        {isCurrentLoading && (
          <Paper
            sx={{
              p: 4,
              backgroundColor: 'rgba(0, 0, 0, 0.8)',
              color: 'white',
              textAlign: 'center',
              borderRadius: 2,
              zIndex: 2,
              position: 'relative'
            }}
          >
            <Typography variant="h6" gutterBottom>
              Loading image...
            </Typography>
            <Typography variant="body2" sx={{ opacity: 0.7 }}>
              {imageName}
            </Typography>
          </Paper>
        )}

        {/* Main image with smooth transitions */}
        <Box
          onClick={zoomLevel > 1 ? undefined : handleImageClick}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              if (zoomLevel <= 1) handleImageClick();
            }
          }}
          onContextMenu={(e) => {
            e.preventDefault();
            if (isImmersiveMode) {
              onToggleImmersiveMode();
            }
          }}
          onMouseDown={zoomLevel > 1 ? handleMouseDown : undefined}
          onMouseMove={zoomLevel > 1 ? handleMouseMove : undefined}
          onMouseUp={zoomLevel > 1 ? handleMouseUp : undefined}
          onMouseLeave={zoomLevel > 1 ? handleMouseUp : undefined}
          onTouchStart={zoomLevel > 1 ? handleTouchStart : undefined}
          onTouchMove={zoomLevel > 1 ? handleTouchMove : undefined}
          onTouchEnd={zoomLevel > 1 ? handleTouchEnd : undefined}
          tabIndex={0}
          role="button"
          aria-label={zoomLevel > 1 ? "Pan image" : (isImmersiveMode ? "Exit immersive mode" : "Enter immersive mode")}
            sx={{
            position: 'relative',
            width: '100%',
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            transform: getTransitionTransform(),
            transition: transitionState.isTransitioning
              ? `transform 350ms cubic-bezier(0.25, 0.46, 0.45, 0.94)`
              : 'none',
            willChange: 'transform',
            cursor: zoomLevel > 1 ? (isDragging ? 'grabbing' : 'grab') : (isImmersiveMode ? 'none' : 'pointer'),
            outline: 'none',
            userSelect: 'none',
            '&:focus-visible': {
              outline: '2px solid white',
              outlineOffset: 2
            }
          }}
        >
          {displayImage ? (
             <img
               src={displayImage.url}
               alt={imageName}
               style={{
                 width: zoomLevel > 1 ? `${100 * zoomLevel}vw` : '100vw',
                 height: zoomLevel > 1 ? `${100 * zoomLevel}vh` : '100vh',
                 objectFit: zoomLevel > 1 ? 'none' : 'contain',
                 borderRadius: zoomLevel > 1 ? 0 : 8,
                 boxShadow: zoomLevel > 1 ? 'none' : '0 8px 32px rgba(0, 0, 0, 0.3)',
                 transition: zoomLevel === 1 ? 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                 cursor: zoomLevel > 1 ? 'grab' : 'default',
                 // Performance optimizations with pan support
                 transform: `translateZ(0) translate(${panPosition.x}px, ${panPosition.y}px)`,
                 backfaceVisibility: 'hidden',
                 WebkitBackfaceVisibility: 'hidden',
                 // Proper sizing for zoom levels
                 transformOrigin: 'center center',
                 // Ensure image fills viewport when not zoomed
                 minWidth: zoomLevel === 1 ? '100vw' : 'auto',
                 minHeight: zoomLevel === 1 ? '100vh' : 'auto',
                 maxWidth: zoomLevel === 1 ? '100vw' : 'none',
                 maxHeight: zoomLevel === 1 ? '100vh' : 'none'
               }}
             />
          ) : (
            <Paper
              sx={{
                p: 4,
                backgroundColor: 'rgba(0, 0, 0, 0.8)',
                color: 'white',
                textAlign: 'center',
                borderRadius: 2
              }}
            >
              <Typography variant="h6" gutterBottom>
                Image not available
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                {imageName}
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.5, mt: 2, fontSize: '0.875rem' }}>
                Check console for details
              </Typography>
            </Paper>
          )}
        </Box>
      </Box>
    </>
  );
});

ImageViewerCore.displayName = 'ImageViewerCore';

export default ImageViewerCore;