import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Box } from '@mui/material';

// Close icon
const CloseIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/>
  </svg>
);

// Lightweight inline SVG icons
const ZoomInIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M11 8v6m-3-3h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <circle cx="11" cy="11" r="8" stroke="currentColor" strokeWidth="2"/>
    <path d="m21 21-4.35-4.35" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
    <path d="M8 11h6" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
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
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onShare: () => void;
  onDownload: () => void;
  onToggleSlideshow: () => void;
  onClose: () => void;
  isSlideshowActive: boolean;
  isTransitioning: boolean;
  isImmersiveMode: boolean;
  displayImage?: { url: string; loadedAt: number; size: number } | null;
}

const ImageViewerControls: React.FC<ImageViewerControlsProps> = React.memo(({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  onShare,
  onDownload,
  onToggleSlideshow,
  onClose,
  isSlideshowActive,
  isTransitioning,
  isImmersiveMode,
  displayImage
}) => {
  const [controlsVisible, setControlsVisible] = useState(true);
  const [isLightBackground, setIsLightBackground] = useState(false);
  const hideTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const brightnessCheckInterval = useRef<NodeJS.Timeout | null>(null);

  // Function to detect image brightness
  const detectImageBrightness = useCallback(async () => {
    if (!displayImage?.url) return;

    try {
      // Create a temporary image to analyze
      const img = new Image();
      img.crossOrigin = 'anonymous';

      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = reject;
        img.src = displayImage.url;
      });

      // Create canvas to analyze the image
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      // Sample at a smaller size for performance
      const sampleSize = Math.min(100, Math.min(img.width, img.height));
      canvas.width = sampleSize;
      canvas.height = sampleSize;

      // Draw and analyze the image
      ctx.drawImage(img, 0, 0, sampleSize, sampleSize);
      const imageData = ctx.getImageData(0, 0, sampleSize, sampleSize);
      const data = imageData.data;

      let totalBrightness = 0;
      let pixelCount = 0;

      // Sample pixels in a grid pattern for performance
      const step = Math.max(1, Math.floor(sampleSize / 10));

      for (let y = 0; y < sampleSize; y += step) {
        for (let x = 0; x < sampleSize; x += step) {
          const index = (y * sampleSize + x) * 4;
          const r = data[index];
          const g = data[index + 1];
          const b = data[index + 2];

          // Calculate luminance (perceived brightness)
          const brightness = (r * 0.299 + g * 0.587 + b * 0.114) / 255;
          totalBrightness += brightness;
          pixelCount++;
        }
      }

      if (pixelCount > 0) {
        const averageBrightness = totalBrightness / pixelCount;
        setIsLightBackground(averageBrightness > 0.5); // Threshold for light/dark
      }
    } catch (error) {
      // Fallback to assuming dark background if detection fails
      console.warn('Failed to detect image brightness:', error);
      setIsLightBackground(false);
    }
  }, [displayImage?.url]);

  // Auto-hide controls in immersive mode after 3 seconds
  useEffect(() => {
    if (isImmersiveMode && !isTransitioning) {
      hideTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    } else {
      setControlsVisible(true);
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
        hideTimeoutRef.current = null;
      }
    }

    return () => {
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
    };
  }, [isImmersiveMode, isTransitioning]);

  // Detect image brightness when image changes or component mounts
  useEffect(() => {
    detectImageBrightness();
  }, [detectImageBrightness]);

  // Also check periodically for dynamic content
  useEffect(() => {
    brightnessCheckInterval.current = setInterval(() => {
      detectImageBrightness();
    }, 2000); // Check every 2 seconds

    return () => {
      if (brightnessCheckInterval.current) {
        clearInterval(brightnessCheckInterval.current);
      }
    };
  }, [detectImageBrightness]);

  // Show controls on mouse movement (throttled)
  useEffect(() => {
    if (!isImmersiveMode) return;

    let throttleTimer: NodeJS.Timeout | null = null;

    const handleMouseMove = (e: MouseEvent) => {
      // Check if mouse is in the top-left area (zoom controls) or bottom area (action controls)
      const topLeftArea = {
        x: 0,
        y: 0,
        width: 200,
        height: 120 // Top-left area for zoom controls
      };

      const bottomArea = {
        x: 0,
        y: window.innerHeight - 150, // Bottom area for action controls
        width: window.innerWidth,
        height: 150
      };

      const isInTopLeft = e.clientX <= topLeftArea.width && e.clientY <= topLeftArea.height;
      const isInBottom = e.clientY >= bottomArea.y;

      if (isInTopLeft || isInBottom) {
        if (!controlsVisible) {
          setControlsVisible(true);
        }

        // Reset auto-hide timer
        if (hideTimeoutRef.current) {
          clearTimeout(hideTimeoutRef.current);
        }
        hideTimeoutRef.current = setTimeout(() => {
          setControlsVisible(false);
        }, 3000);
      }
    };

    const throttledMouseMove = (e: MouseEvent) => {
      if (throttleTimer) return;

      throttleTimer = setTimeout(() => {
        handleMouseMove(e);
        throttleTimer = null;
      }, 100);
    };

    document.addEventListener('mousemove', throttledMouseMove);

    return () => {
      document.removeEventListener('mousemove', throttledMouseMove);
      if (throttleTimer) {
        clearTimeout(throttleTimer);
      }
    };
  }, [isImmersiveMode, controlsVisible]);

  // Show controls on hover (for top-right zoom controls)
  const handleMouseEnter = () => {
    if (isImmersiveMode && !controlsVisible) {
      setControlsVisible(true);
    }
  };

  const handleMouseLeave = () => {
    if (isImmersiveMode) {
      // Reset auto-hide timer
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  };

  // Handle mouse enter/leave for bottom action controls
  const handleBottomMouseEnter = () => {
    if (isImmersiveMode && !controlsVisible) {
      setControlsVisible(true);
    }
  };

  const handleBottomMouseLeave = () => {
    if (isImmersiveMode) {
      // Reset auto-hide timer
      if (hideTimeoutRef.current) {
        clearTimeout(hideTimeoutRef.current);
      }
      hideTimeoutRef.current = setTimeout(() => {
        setControlsVisible(false);
      }, 3000);
    }
  };
  const controlStyles = useMemo(() => {
    // Dynamic gradients based on background brightness
    const getTintGradients = (isLight: boolean) => {
      if (isLight) {
        // Light background - use dark tints for contrast
        return {
          primary: 'linear-gradient(135deg, rgba(10, 10, 10, 0.25) 0%, rgba(25, 25, 25, 0.2) 30%, rgba(40, 40, 40, 0.15) 60%, rgba(55, 55, 55, 0.08) 100%)',
          secondary: 'linear-gradient(45deg, rgba(5, 5, 5, 0.3) 0%, rgba(20, 20, 20, 0.18) 50%, rgba(35, 35, 35, 0.08) 100%)',
          primaryOpacity: 0.9,
          secondaryOpacity: 0.6,
          mixBlendMode: 'multiply' as const
        };
      } else {
        // Dark background - use light tints for visibility
        return {
          primary: 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.08) 30%, rgba(255, 255, 255, 0.05) 60%, rgba(255, 255, 255, 0.02) 100%)',
          secondary: 'linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 50%, rgba(200, 200, 200, 0.02) 100%)',
          primaryOpacity: 0.7,
          secondaryOpacity: 0.4,
          mixBlendMode: 'overlay' as const
        };
      }
    };

    const tintGradients = getTintGradients(isLightBackground);

    return {
      button: {
        width: 32,
        height: 32,
        borderRadius: '50%',
        backdropFilter: 'blur(25px) saturate(200%) contrast(120%) brightness(110%)',
        border: '1px solid rgba(255, 255, 255, 0.15)',
        backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.04)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 10px 36px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.05)',
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '12px',
          background: tintGradients.primary,
          opacity: tintGradients.primaryOpacity,
          mixBlendMode: tintGradients.mixBlendMode,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '12px',
          background: tintGradients.secondary,
          opacity: tintGradients.secondaryOpacity,
        },
        '&:hover': {
          backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.06)',
          transform: 'scale(1.03) translateY(-1px)',
          boxShadow: '0 14px 44px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.08)',
          '&::before': {
            opacity: 1,
          },
          '&::after': {
            opacity: 0.6,
          }
        },
        '&:active': {
          transform: 'scale(0.98)'
        }
      },
      display: {
        backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.8)' : 'rgba(255, 255, 255, 0.04)',
        backdropFilter: 'blur(25px) saturate(200%) contrast(120%) brightness(110%)',
        borderRadius: '12px',
        px: 2.5,
        py: 1,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 60,
        cursor: 'pointer',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 10px 36px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.05)',
        position: 'relative',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '12px',
          background: tintGradients.primary,
          opacity: tintGradients.primaryOpacity,
          mixBlendMode: tintGradients.mixBlendMode,
        },
        '&::after': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: '12px',
          background: tintGradients.secondary,
          opacity: tintGradients.secondaryOpacity,
        },
        '&:hover': {
          backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.06)',
          transform: 'scale(1.03) translateY(-1px)',
          boxShadow: '0 14px 44px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.12), inset 0 -1px 0 rgba(0, 0, 0, 0.08)',
          '&::before': {
            opacity: 1,
          },
          '&::after': {
            opacity: 0.6,
          }
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
    };
  }, [zoomLevel, isLightBackground]);

  // Always show minimal controls (zoom only) in immersive mode

  return (
    <>
      {/* Top-left zoom controls */}
      <Box
        ref={controlsRef}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        sx={{
          position: 'absolute',
          top: 16,
          left: "5%",
          zIndex: 1300,
          display: 'flex',
          flexDirection: 'row',
          gap: 2,
          alignItems: 'center',
          opacity: (isTransitioning || (isImmersiveMode && !controlsVisible)) ? 0 : (isImmersiveMode ? 0.7 : 1),
          transform: (isTransitioning || (isImmersiveMode && !controlsVisible)) ? 'translateY(-10px)' : 'translateY(0)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: (isTransitioning || (isImmersiveMode && !controlsVisible)) ? 'none' : 'auto',
          '& > *': {
            animation: 'fadeInUp 0.6s ease-out forwards',
            animationDelay: 'calc(var(--index) * 0.1s)',
          }
        }}
      >
        {/* Close button - separated from zoom controls */}
        <Box
          onClick={!isTransitioning ? onClose : undefined}
          sx={{
            ...controlStyles.button,
            width: 50,
            height: 50,
            opacity: isTransitioning ? 0.5 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer',
            backgroundColor: 'rgba(244, 67, 54, 0.2)',
            '&:hover': {
              backgroundColor: 'rgba(244, 67, 54, 0.3)',
            }
          }}
          aria-label="Close image viewer"
          role="button"
          tabIndex={0}
        >
          <CloseIcon />
        </Box>

        {/* Zoom controls - separate from close button */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(30px) saturate(200%) contrast(120%) brightness(110%)',
            borderRadius: '24px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            padding: '6px 8px',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.05)',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '24px',
              background: isLightBackground
                ? 'linear-gradient(135deg, rgba(10, 10, 10, 0.25) 0%, rgba(25, 25, 25, 0.2) 30%, rgba(40, 40, 40, 0.15) 60%, rgba(55, 55, 55, 0.08) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.08) 30%, rgba(255, 255, 255, 0.05) 60%, rgba(255, 255, 255, 0.02) 100%)',
              opacity: isLightBackground ? 0.9 : 0.7,
              mixBlendMode: isLightBackground ? 'multiply' : 'overlay',
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '24px',
              background: isLightBackground
                ? 'linear-gradient(45deg, rgba(5, 5, 5, 0.3) 0%, rgba(20, 20, 20, 0.18) 50%, rgba(35, 35, 35, 0.08) 100%)'
                : 'linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 50%, rgba(200, 200, 200, 0.02) 100%)',
              opacity: isLightBackground ? 0.6 : 0.4,
            }
          }}
        >
          {/* Zoom out */}
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

          {/* Zoom display */}
          <Box
            onClick={!isTransitioning ? onResetZoom : undefined}
            sx={{
              ...controlStyles.display,
              minWidth: 65,
              borderRadius: '15px',
              fontSize: '0.75rem',
              fontWeight: 700,
              letterSpacing: '0.02em'
            }}
            aria-label={`Current zoom: ${Math.round(zoomLevel * 100)}%`}
            role="button"
            tabIndex={0}
          >
            <span style={controlStyles.text}>
              {Math.round(zoomLevel * 100)}%
            </span>
          </Box>

          {/* Zoom in */}
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

          {/* Slideshow toggle - moved from bottom controls */}
          <Box
            onClick={!isTransitioning ? onToggleSlideshow : undefined}
            sx={{
              ...controlStyles.button,
              opacity: isTransitioning ? 0.4 : 1,
              cursor: isTransitioning ? 'not-allowed' : 'pointer',
              backgroundColor: isSlideshowActive
                ? 'rgba(33, 150, 243, 0.8)'
                : 'rgba(255, 255, 255, 0.04)',
              ml: 1 // Add margin-left for separation
            }}
            aria-label={isSlideshowActive ? "Stop slideshow" : "Start slideshow"}
            role="button"
            tabIndex={0}
          >
            {isSlideshowActive ? <PauseIcon /> : <PlayIcon />}
          </Box>
        </Box>
      </Box>

      {/* Bottom action controls - above navigation pane */}
      {!isImmersiveMode && (
        <Box
          onMouseEnter={handleBottomMouseEnter}
          onMouseLeave={handleBottomMouseLeave}
          sx={{
            position: 'fixed',
            bottom: 125, // Aligned with top edge of navigation pane (30px bottom + 85px height)
            right: '9%',
            transform: isTransitioning ? 'translateX(-50%) translateY(10px)' : 'translateX(-50%) translateY(0)',
            zIndex: 1300,
            opacity: isTransitioning ? 0 : 1,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: isTransitioning ? 'none' : 'auto',
            animation: 'fadeInUp 0.6s ease-out forwards',
          }}
        >
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 0.5,
            backgroundColor: 'rgba(255, 255, 255, 0.03)',
            backdropFilter: 'blur(30px) saturate(200%) contrast(120%) brightness(110%)',
            borderRadius: '24px',
            border: '1px solid rgba(255, 255, 255, 0.12)',
            padding: '6px 8px',
            boxShadow: '0 16px 48px rgba(0, 0, 0, 0.25), inset 0 1px 0 rgba(255, 255, 255, 0.08), inset 0 -1px 0 rgba(0, 0, 0, 0.05)',
            position: 'relative',
            '&::before': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '24px',
              background: isLightBackground
                ? 'linear-gradient(135deg, rgba(10, 10, 10, 0.25) 0%, rgba(25, 25, 25, 0.2) 30%, rgba(40, 40, 40, 0.15) 60%, rgba(55, 55, 55, 0.08) 100%)'
                : 'linear-gradient(135deg, rgba(255, 255, 255, 0.12) 0%, rgba(255, 255, 255, 0.08) 30%, rgba(255, 255, 255, 0.05) 60%, rgba(255, 255, 255, 0.02) 100%)',
              opacity: isLightBackground ? 0.9 : 0.7,
              mixBlendMode: isLightBackground ? 'multiply' : 'overlay',
            },
            '&::after': {
              content: '""',
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              borderRadius: '24px',
              background: isLightBackground
                ? 'linear-gradient(45deg, rgba(5, 5, 5, 0.3) 0%, rgba(20, 20, 20, 0.18) 50%, rgba(35, 35, 35, 0.08) 100%)'
                : 'linear-gradient(45deg, rgba(255, 255, 255, 0.08) 0%, rgba(255, 255, 255, 0.04) 50%, rgba(200, 200, 200, 0.02) 100%)',
              opacity: isLightBackground ? 0.6 : 0.4,
            }
          }}
        >
          {/* Share */}
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

          {/* Download */}
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


        </Box>
      </Box>
      )}
    </>
  );
});

ImageViewerControls.displayName = 'ImageViewerControls';

export default ImageViewerControls;