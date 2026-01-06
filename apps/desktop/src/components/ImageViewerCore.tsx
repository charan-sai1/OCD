import React, { useCallback } from 'react';
import { Box, IconButton, Typography, Paper } from '@mui/material';

// Lightweight inline SVG icons (Apple-style)
const CloseIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
  </svg>
);

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
  onClose: () => void;
  isImmersiveMode: boolean;
  onToggleImmersiveMode: () => void;
  zoomLevel: number;
  rotation: number;
  transitionState: TransitionState;
  displayImage: CachedImage | undefined;
  imageName: string;
  isCurrentLoading: boolean;
}

const ImageViewerCore: React.FC<ImageViewerCoreProps> = React.memo(({
  currentIndex,
  onClose,
  isImmersiveMode,
  onToggleImmersiveMode,
  zoomLevel,
  rotation,
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
      {/* Close button and immersive mode indicator */}
      <Box sx={{ position: 'absolute', top: 16, right: 16, zIndex: 1300, display: 'flex', gap: 1 }}>
        {isImmersiveMode && (
          <Box
            sx={{
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              backdropFilter: 'blur(10px)',
              borderRadius: 2,
              px: 2,
              py: 0.5,
              border: '1px solid rgba(255, 255, 255, 0.2)',
              display: 'flex',
              alignItems: 'center',
              fontSize: '0.75rem',
              color: 'white',
              fontWeight: 500
            }}
            role="status"
            aria-live="polite"
          >
            Immersive Mode
          </Box>
        )}
        <IconButton
          onClick={onClose}
          disabled={transitionState.isTransitioning}
          aria-label="Close image viewer"
          sx={{
            backgroundColor: 'rgba(0, 0, 0, 0.5)',
            color: 'white',
            transition: 'all 0.2s ease',
            '&:hover': {
              backgroundColor: 'rgba(0, 0, 0, 0.7)',
              transform: 'scale(1.1)'
            },
            '&:disabled': {
              opacity: 0.5
            }
          }}
        >
          <CloseIcon />
        </IconButton>
      </Box>





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
                width: zoomLevel > 1 ? `${100 * zoomLevel}vw` : '100%',
                height: zoomLevel > 1 ? `${100 * zoomLevel}vh` : '100%',
                objectFit: zoomLevel > 1 ? 'none' : 'contain',
                borderRadius: zoomLevel > 1 ? 0 : 8,
                boxShadow: zoomLevel > 1 ? 'none' : '0 8px 32px rgba(0, 0, 0, 0.3)',
                transition: zoomLevel === 1 ? 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)' : 'none',
                cursor: zoomLevel > 1 ? 'grab' : 'default',
                // Performance optimizations and rotation with pan support
                transform: `translateZ(0) translate(${panPosition.x}px, ${panPosition.y}px) rotate(${rotation}deg)`,
                backfaceVisibility: 'hidden',
                WebkitBackfaceVisibility: 'hidden',
                // Proper sizing for zoom levels
                transformOrigin: 'center center',
                // Ensure image fills viewport when not zoomed
                minWidth: zoomLevel === 1 ? '100%' : 'auto',
                minHeight: zoomLevel === 1 ? '100%' : 'auto'
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