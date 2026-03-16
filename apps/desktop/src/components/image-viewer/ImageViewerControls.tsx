import React, { useMemo, useState, useEffect, useRef, useCallback } from 'react';
import { Box } from '@mui/material';
import {
  ZoomIn,
  ZoomOut,
  RotateCw,
  Maximize,
  Share,
  Download,
  Play,
  Pause,
  X
} from 'lucide-react';







interface ImageViewerControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  onRotate: () => void;
  onZoomToFit: () => void;
  onShare: () => void;
  onDownload: () => void;
  onToggleSlideshow: () => void;
  onClose: () => void;
  isSlideshowActive: boolean;
  isTransitioning: boolean;
  isImmersiveMode: boolean;
  displayImage?: { url: string; loadedAt: number; size: number } | null;
  canZoomIn?: boolean;
  canZoomOut?: boolean;
}

const ImageViewerControls: React.FC<ImageViewerControlsProps> = React.memo(({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom: _onResetZoom,
  onRotate,
  onZoomToFit,
  onShare,
  onDownload,
  onToggleSlideshow,
  onClose,
  isSlideshowActive,
  isTransitioning,
  isImmersiveMode,
  displayImage,
  canZoomIn = true,
  canZoomOut = true
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
        width: 300,
        height: 200 // Top-left area for zoom controls - increased
      };

      const bottomArea = {
        x: 0,
        y: window.innerHeight - 200, // Bottom area for action controls - increased
        width: window.innerWidth,
        height: 200
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
        width: 48,
        height: 48,
        borderRadius: '50%',
        backdropFilter: 'blur(25px) saturate(200%) contrast(120%) brightness(110%)',
        border: '2px solid rgba(255, 255, 255, 0.3)',
        backgroundColor: isLightBackground ? 'rgba(0, 0, 0, 0.9)' : 'rgba(255, 255, 255, 0.1)',
        color: '#ffffff',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.15), inset 0 -1px 0 rgba(0, 0, 0, 0.1)',
        position: 'relative',
        fontSize: '20px',
        userSelect: 'none',
        '& svg': {
          strokeWidth: 2.5,
        },

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
          pointerEvents: 'none', // Allow clicks to pass through decorative overlay
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
          pointerEvents: 'none', // Allow clicks to pass through decorative overlay
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
          zIndex: 1, // Relative to parent container
          display: 'flex',
          flexDirection: 'row',
          gap: 2,
          alignItems: 'center',
          opacity: isTransitioning ? 0.5 : 1,
          transform: isTransitioning ? 'translateY(-10px)' : 'translateY(0)',
          transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
          pointerEvents: 'auto', // Always allow pointer events
          '& > *': {
            animation: 'fadeInUp 0.6s ease-out forwards',
            animationDelay: 'calc(var(--index) * 0.1s)',
          }
        }}
      >
        {/* Close button - separated from zoom controls */}
        <Box
            onClick={(e) => {
              console.log('🖱️ Close button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onClose();
              }
            }}
          sx={{
            ...controlStyles.button,
            width: 56,
            height: 56,
            opacity: isTransitioning ? 0.5 : 1,
            cursor: isTransitioning ? 'not-allowed' : 'pointer',
            backgroundColor: 'rgba(244, 67, 54, 0.2)',
            '&:hover': {
              backgroundColor: 'rgba(244, 67, 54, 0.3)',
              transform: 'scale(1.05)',
              boxShadow: '0 14px 44px rgba(0, 0, 0, 0.3)',
            },
            fontSize: '24px'
          }}
          aria-label="Close image viewer"
          role="button"
          tabIndex={0}
        >
          <X />
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
            pointerEvents: 'auto', // Ensure container allows clicks
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
              pointerEvents: 'none', // Don't block clicks
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
              pointerEvents: 'none', // Don't block clicks
            }
          }}
        >
          {/* Zoom out */}
          <Box
            onClick={(e) => {
              console.log('🔍 Zoom out button clicked');
              e.stopPropagation();
              if (!isTransitioning && canZoomOut) {
                onZoomOut();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: !canZoomOut || isTransitioning ? 0.4 : 1,
              cursor: !canZoomOut || isTransitioning ? 'not-allowed' : 'pointer'
              // Removed pointerEvents: 'none' - buttons should always be clickable for debugging
            }}
            aria-label="Zoom out"
            role="button"
            tabIndex={0}
          >
            <ZoomOut size={20} />
          </Box>



          {/* Zoom in */}
          <Box
            onClick={(e) => {
              console.log('🔍 Zoom in button clicked');
              e.stopPropagation();
              if (!isTransitioning && canZoomIn) {
                onZoomIn();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: !canZoomIn || isTransitioning ? 0.4 : 1,
              cursor: !canZoomIn || isTransitioning ? 'not-allowed' : 'pointer'
              // Removed pointerEvents: 'none' - buttons should always be clickable for debugging
            }}
            aria-label="Zoom in"
            role="button"
            tabIndex={0}
          >
            <ZoomIn size={20} />
          </Box>

          {/* Zoom to fit button */}
          <Box
            onClick={(e) => {
              console.log('🔍 Zoom to fit button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onZoomToFit();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: isTransitioning ? 0.4 : 1,
              cursor: isTransitioning ? 'not-allowed' : 'pointer',
              ml: 1 // Add margin-left for separation
            }}
            aria-label="Zoom to fit image in viewport"
            role="button"
            tabIndex={0}
          >
            <Maximize size={20} />
          </Box>

          {/* Rotate button */}
          <Box
            onClick={(e) => {
              console.log('🔄 Rotate button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onRotate();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: isTransitioning ? 0.4 : 1,
              cursor: isTransitioning ? 'not-allowed' : 'pointer',
              ml: 1 // Add margin-left for separation
            }}
            aria-label="Rotate image 90 degrees"
            role="button"
            tabIndex={0}
          >
            <RotateCw size={20} />
          </Box>

          {/* Slideshow toggle - moved from bottom controls */}
          <Box
            onClick={(e) => {
              console.log('▶️ Slideshow toggle button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onToggleSlideshow();
              }
            }}
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
            {isSlideshowActive ? <Pause size={20} /> : <Play size={20} />}
          </Box>
        </Box>
      </Box>

      {/* Bottom action controls - above navigation pane */}
      {/* Bottom action controls - above navigation pane */}
      {!isImmersiveMode && (
        <Box
          onMouseEnter={handleBottomMouseEnter}
          onMouseLeave={handleBottomMouseLeave}
          sx={{
            position: 'fixed', // Changed from absolute to fixed
            bottom: 125, // Now relative to viewport
            right: '9%',
            transform: isTransitioning ? 'translateX(-50%) translateY(10px)' : 'translateX(-50%) translateY(0)',
            zIndex: 10001, // Higher than controls overlay
            opacity: isTransitioning ? 0 : 1,
            transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
            pointerEvents: 'auto', // Always allow pointer events
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
              pointerEvents: 'none', // Allow clicks to pass through decorative overlay
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
              pointerEvents: 'none', // Allow clicks to pass through decorative overlay
            }
          }}
        >
          {/* Share */}
          <Box
            onClick={(e) => {
              console.log('📤 Share button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onShare();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: isTransitioning ? 0.4 : 1,
              cursor: isTransitioning ? 'not-allowed' : 'pointer'
            }}
            aria-label="Share image"
            role="button"
            tabIndex={0}
          >
            <Share size={20} />
          </Box>

          {/* Download */}
          <Box
            onClick={(e) => {
              console.log('⬇️ Download button clicked');
              e.stopPropagation();
              if (!isTransitioning) {
                onDownload();
              }
            }}
            sx={{
              ...controlStyles.button,
              opacity: isTransitioning ? 0.4 : 1,
              cursor: isTransitioning ? 'not-allowed' : 'pointer'
            }}
            aria-label="Download image"
            role="button"
            tabIndex={0}
          >
            <Download size={20} />
          </Box>


        </Box>
      </Box        >
      )}
    </>
  );
});

ImageViewerControls.displayName = 'ImageViewerControls';

export default ImageViewerControls;