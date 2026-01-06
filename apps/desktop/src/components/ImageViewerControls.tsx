import React, { useMemo } from 'react';
import { Box } from '@mui/material';

// Lightweight inline SVG icons
const ZoomInIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 13H5v-2h14v2z" fill="currentColor"/>
  </svg>
);

const RotateLeftIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.11 8.53L5.7 7.11C4.8 8.27 4.24 9.61 4.07 11h2.02c.14-.87.49-1.72 1.02-2.47zM6.09 13H4.07c.17 1.39.72 2.73 1.62 3.89l1.41-1.42c-.52-.75-.87-1.6-1.01-2.47zm1.01 5.32l1.41 1.41c1.16-.89 2.5-1.45 3.89-1.62V18.5c-.87.14-1.72.49-2.47 1.02zM13 4.07v2.02c2.36.46 4.22 2.32 4.68 4.68h2.02c-.46-3.61-3.39-6.54-7-7zm-1 15.93v2.02c3.61-.46 6.54-3.39 7-7h-2.02c-.46 2.36-2.32 4.22-4.68 4.68z" fill="currentColor"/>
  </svg>
);

const RotateRightIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M16.89 8.53L18.3 7.11C19.2 8.27 19.76 9.61 19.93 11h-2.02c-.14-.87-.49-1.72-1.02-2.47zM17.91 13h2.02c-.17 1.39-.72 2.73-1.62 3.89l-1.41-1.42c.52-.75.87-1.6 1.01-2.47zm-1.01 5.32l-1.41 1.41c-1.16-.89-2.5-1.45-3.89-1.62V18.5c.87.14 1.72.49 2.47 1.02zM11 4.07v2.02c-2.36.46-4.22 2.32-4.68 4.68H4.3c.46-3.61 3.39-6.54 7-7zm1 15.93v2.02c-3.61-.46-6.54-3.39-7-7h2.02c.46 2.36 2.32 4.22 4.68 4.68z" fill="currentColor"/>
  </svg>
);

const ShareIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z" fill="currentColor"/>
  </svg>
);

const DownloadIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z" fill="currentColor"/>
  </svg>
);

const PlayIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M8 5v14l11-7z" fill="currentColor"/>
  </svg>
);

const PauseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z" fill="currentColor"/>
  </svg>
);

interface ImageViewerControlsProps {
  zoomLevel: number;
  rotation: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onRotateLeft: () => void;
  onRotateRight: () => void;
  onFitToScreen: () => void;
  onActualSize: () => void;
  onShare: () => void;
  onDownload: () => void;
  onToggleSlideshow: () => void;
  isSlideshowActive: boolean;
  isTransitioning: boolean;
  isImmersiveMode: boolean;
}

const ImageViewerControls: React.FC<ImageViewerControlsProps> = React.memo(({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onRotateLeft,
  onRotateRight,
  onFitToScreen,
  onActualSize,
  onShare,
  onDownload,
  onToggleSlideshow,
  isSlideshowActive,
  isTransitioning,
  isImmersiveMode
}) => {
  const controlStyles = useMemo(() => ({
    button: {
      width: 40,
      height: 40,
      borderRadius: 2,
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      backgroundColor: zoomLevel > 0.5 && zoomLevel < 5
        ? 'rgba(0, 0, 0, 0.7)'
        : 'rgba(0, 0, 0, 0.4)',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
      '&:hover': zoomLevel > 0.5 && zoomLevel < 5 ? {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        transform: 'scale(1.05)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
      } : {},
      '&:active': zoomLevel > 0.5 && zoomLevel < 5 ? {
        transform: 'scale(0.95)'
      } : {},
      '&:disabled': {
        opacity: 0.4,
        cursor: 'not-allowed'
      }
    },
    display: {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(10px)',
      borderRadius: 2,
      px: 2,
      py: 0.5,
      border: '1px solid rgba(255, 255, 255, 0.15)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 55,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
      '&:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        transform: 'scale(1.02)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
      },
      '&:active': {
        transform: 'scale(0.98)'
      }
    },
    text: {
      color: 'white',
      fontWeight: 600,
      fontSize: '0.8rem',
      letterSpacing: '0.025em',
      userSelect: 'none' as const
    }
  }), [zoomLevel]);

  if (isImmersiveMode) return null;

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1300,
        display: 'flex',
        flexDirection: 'column',
        gap: 0.5,
        opacity: isTransitioning ? 0.5 : 1,
        transition: 'all 0.3s ease',
        transform: 'scale(1)'
      }}
    >
      {/* Zoom controls */}
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Box
          onClick={!isTransitioning && zoomLevel > 0.5 ? onZoomOut : undefined}
          sx={{
            ...controlStyles.button,
            opacity: zoomLevel <= 0.5 || isTransitioning ? 0.4 : 1,
            cursor: zoomLevel <= 0.5 || isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Zoom out"
          role="button"
          tabIndex={0}
        >
          <ZoomOutIcon />
        </Box>

        <Box
          onClick={!isTransitioning ? onResetZoom : undefined}
          sx={controlStyles.display}
          aria-label={`Current zoom: ${Math.round(zoomLevel * 100)}%`}
          role="button"
          tabIndex={0}
        >
          <span style={controlStyles.text}>
            {Math.round(zoomLevel * 100)}%
          </span>
        </Box>

        <Box
          onClick={!isTransitioning && zoomLevel < 5 ? onZoomIn : undefined}
          sx={{
            ...controlStyles.button,
            opacity: zoomLevel >= 5 || isTransitioning ? 0.4 : 1,
            cursor: zoomLevel >= 5 || isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Zoom in"
          role="button"
          tabIndex={0}
        >
          <ZoomInIcon />
        </Box>
      </Box>

      {/* Rotation and fit controls */}
      <Box sx={{ display: 'flex', gap: 0.5 }}>
        <Box
          onClick={!isTransitioning ? onRotateLeft : undefined}
          sx={{
            ...controlStyles.button,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Rotate left"
          role="button"
          tabIndex={0}
        >
          <RotateLeftIcon />
        </Box>

        <Box
          onClick={!isTransitioning ? onFitToScreen : undefined}
          sx={{
            ...controlStyles.button,
            minWidth: 55,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Fit to screen"
          role="button"
          tabIndex={0}
        >
          <span style={{ ...controlStyles.text, fontSize: '0.7rem' }}>
            Fit
          </span>
        </Box>

        <Box
          onClick={!isTransitioning ? onActualSize : undefined}
          sx={{
            ...controlStyles.button,
            minWidth: 55,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Actual size"
          role="button"
          tabIndex={0}
        >
          <span style={{ ...controlStyles.text, fontSize: '0.7rem' }}>
            100%
          </span>
        </Box>

        <Box
          onClick={!isTransitioning ? onRotateRight : undefined}
          sx={{
            ...controlStyles.button,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Rotate right"
          role="button"
          tabIndex={0}
        >
          <RotateRightIcon />
        </Box>

        <Box
          onClick={!isTransitioning ? onShare : undefined}
          sx={{
            ...controlStyles.button,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Share image"
          role="button"
          tabIndex={0}
        >
          <ShareIcon />
        </Box>

        <Box
          onClick={!isTransitioning ? onDownload : undefined}
          sx={{
            ...controlStyles.button,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer'
          }}
          aria-label="Download image"
          role="button"
          tabIndex={0}
        >
          <DownloadIcon />
        </Box>

        <Box
          onClick={!isTransitioning ? onToggleSlideshow : undefined}
          sx={{
            ...controlStyles.button,
            opacity: isTransitioning ? 0.4 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer',
            backgroundColor: isSlideshowActive
              ? 'rgba(33, 150, 243, 0.8)'
              : 'rgba(0, 0, 0, 0.7)'
          }}
          aria-label={isSlideshowActive ? "Stop slideshow" : "Start slideshow"}
          role="button"
          tabIndex={0}
        >
          {isSlideshowActive ? <PauseIcon /> : <PlayIcon />}
        </Box>
      </Box>
    </Box>
  );
});

ImageViewerControls.displayName = 'ImageViewerControls';

export default ImageViewerControls;