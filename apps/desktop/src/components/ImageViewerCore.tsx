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
  panPosition: { x: number, y: number };
  isZoomed: boolean;
  handlePan: (event: React.MouseEvent | React.TouchEvent) => void;
  handleDoubleClick: (event: React.MouseEvent) => void;
  transitionState: TransitionState;
  displayImage: CachedImage | undefined;
  imageName: string;
  isCurrentLoading: boolean;
}

const ImageViewerCore: React.FC<ImageViewerCoreProps> = React.memo(({
  isImmersiveMode,
  onToggleImmersiveMode,
  zoomLevel,
  panPosition,
  isZoomed,
  handlePan,
  handleDoubleClick,
  transitionState,
  displayImage,
  imageName,
  isCurrentLoading
}) => {

  const getTransitionTransform = useCallback(() => {
    if (!transitionState.isTransitioning) return 'translateX(0)';

    const { direction, progress } = transitionState;
    const offset = direction === 'left' ? -progress * 100 : progress * 100;
    return `translateX(${offset}%)`;
  }, [transitionState]);

  const handleImageClick = useCallback(() => {
    onToggleImmersiveMode();
  }, [onToggleImmersiveMode]);



  return (
    <>
      <Box
        sx={{
          width: '100vw',
          height: '100vh',
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
          cursor: isZoomed ? 'grab' : 'default',
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
        <Box
          onClick={isZoomed ? undefined : handleImageClick}
          onDoubleClick={handleDoubleClick}
          onMouseDown={handlePan}
          onMouseMove={handlePan}
          onMouseUp={handlePan}
          onMouseLeave={handlePan}
          onTouchStart={handlePan}
          onTouchMove={handlePan}
          onTouchEnd={handlePan}
          onDragStart={(e) => e.preventDefault()}
          onDrag={(e) => e.preventDefault()}
          onDragEnd={(e) => e.preventDefault()}
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
            cursor: zoomLevel > 1 ? 'grabbing' : (isImmersiveMode ? 'none' : 'pointer'),
            outline: 'none',
            userSelect: 'none',
            '&:focus-visible': {
              outline: '2px solid white',
              outlineOffset: 2
            },
            overflow: zoomLevel > 1 ? 'visible' : 'hidden'
          }}
        >
          {displayImage ? (
            <Box
              sx={{
                position: 'relative',
                width: '100%',
                height: '100%',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                overflow: zoomLevel > 1 ? 'visible' : 'hidden'
              }}
            >
              <img
                src={displayImage.url}
                alt={imageName}
                draggable={false}
                onDragStart={(e) => e.preventDefault()}
                style={{
                  width: '100%',
                  height: '100%',
                  objectFit: 'contain',
                  transition: transitionState.isTransitioning ? 'none' : 'transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                  transform: zoomLevel === 1 ? 'none' : `scale(${zoomLevel}) translate(${panPosition.x / zoomLevel}px, ${panPosition.y / zoomLevel}px)`,
                  cursor: zoomLevel === 1 ? 'default' : 'grab',
                  backfaceVisibility: 'hidden',
                  WebkitBackfaceVisibility: 'hidden',
                  transformOrigin: 'center center',
                  position: 'relative',
                }}
              />
            </Box>
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