import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Box, Typography } from '@mui/material';

interface PreviewStripProps {
  images: string[];
  currentIndex: number;
  previewUrls: Record<number, string>;
  loadingStates: Record<number, boolean>;
  onImageSelect: (index: number) => void;
  isImmersiveMode: boolean;
  isTransitioning: boolean;
}

const PreviewStrip: React.FC<PreviewStripProps> = React.memo(({
  images,
  currentIndex,
  previewUrls,
  loadingStates,
  onImageSelect,
  isImmersiveMode,
  isTransitioning
}) => {
  const stripRef = useRef<HTMLDivElement>(null);
  const [scrollLeft, setScrollLeft] = useState(0);
  const [containerWidth, setContainerWidth] = useState(800);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);

  // Responsive thumbnail sizing
  const responsiveSizing = useMemo(() => {
    const screenWidth = window.innerWidth;
    const maxStripWidth = screenWidth * 0.9; // 90% of screen
    const availableSpace = maxStripWidth / images.length;

    // Calculate optimal size (between 40px and 80px)
    const optimalSize = Math.min(80, Math.max(40, availableSpace - 4));

    return {
      size: optimalSize,
      gap: Math.max(2, optimalSize * 0.1), // 10% of size as gap
      borderRadius: optimalSize * 0.17 // 17% of size for rounded corners
    };
  }, [images.length]);

  // Virtualization constants
  const THUMBNAIL_WIDTH = responsiveSizing.size + responsiveSizing.gap;
  const BUFFER_SIZE = 5; // Render extra thumbnails outside viewport

  // Calculate visible range for virtualization
  const visibleRange = useMemo(() => {
    const start = Math.max(0, Math.floor(scrollLeft / THUMBNAIL_WIDTH) - BUFFER_SIZE);
    const end = Math.min(images.length, Math.ceil((scrollLeft + containerWidth) / THUMBNAIL_WIDTH) + BUFFER_SIZE);
    return { start, end };
  }, [scrollLeft, containerWidth, images.length]);

  // Handle scroll events for virtualization
  const handleScroll = useCallback((e: React.UIEvent<HTMLDivElement>) => {
    setScrollLeft(e.currentTarget.scrollLeft);
  }, []);

  // Update container width on resize
  useEffect(() => {
    const updateContainerWidth = () => {
      if (stripRef.current) {
        setContainerWidth(stripRef.current.clientWidth || 800);
      }
    };

    updateContainerWidth();
    window.addEventListener('resize', updateContainerWidth);
    return () => window.removeEventListener('resize', updateContainerWidth);
  }, []);

  // Touch gesture support for mobile/tablet
  const touchStart = useRef<{ x: number; y: number } | null>(null);

  // Hover handlers for preview tooltips
  const handleMouseEnter = (index: number) => {
    if (!isTransitioning) {
      setHoveredIndex(index);
    }
  };

  const handleMouseLeave = () => {
    setHoveredIndex(null);
  };

  // Preview tooltip component
  const PreviewTooltip = ({ index }: { index: number }) => {
    if (hoveredIndex !== index || !previewUrls[index]) return null;

    // Get image filename from path
    const imageName = images[index].split('/').pop() || `Image ${index + 1}`;

    return (
      <Box
        sx={{
          position: 'absolute',
          bottom: responsiveSizing.size + 10,
          left: '50%',
          transform: 'translateX(-50%)',
          bgcolor: 'rgba(0, 0, 0, 0.9)',
          backdropFilter: 'blur(10px)',
          borderRadius: 2,
          px: 2,
          py: 1,
          border: '1px solid rgba(255, 255, 255, 0.2)',
          boxShadow: '0 8px 24px rgba(0, 0, 0, 0.4)',
          zIndex: 1400,
          pointerEvents: 'none',
          maxWidth: 200,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}
      >
        <Typography
          variant="caption"
          sx={{
            color: 'white',
            fontSize: '0.75rem',
            fontWeight: 500
          }}
        >
          {imageName}
        </Typography>
      </Box>
    );
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (!touchStart.current) return;

    const deltaX = e.changedTouches[0].clientX - touchStart.current.x;
    const deltaY = e.changedTouches[0].clientY - touchStart.current.y;

    // Horizontal swipe for navigation (more than 50px horizontal, less than 50px vertical)
    if (Math.abs(deltaX) > 50 && Math.abs(deltaY) < 50) {
      if (deltaX > 0 && currentIndex > 0) {
        // Swipe right = previous image
        onImageSelect(currentIndex - 1);
      } else if (deltaX < 0 && currentIndex < images.length - 1) {
        // Swipe left = next image
        onImageSelect(currentIndex + 1);
      }
    }

    touchStart.current = null;
  };

  // Smooth scroll to center current image
  useEffect(() => {
    if (!stripRef.current || images.length <= 1 || isImmersiveMode) return;

    const container = stripRef.current;
    const thumbnailWidth = 64;
    const containerWidth = container.clientWidth;
    const scrollLeft = (currentIndex * thumbnailWidth) - (containerWidth / 2) + (thumbnailWidth / 2);

    container.scrollTo({
      left: Math.max(0, scrollLeft),
      behavior: 'smooth'
    });
  }, [currentIndex, images.length, isImmersiveMode]);

  const thumbnailStyles = useMemo(() => ({
    container: {
      flexShrink: 0,
      width: responsiveSizing.size,
      height: responsiveSizing.size,
      borderRadius: `${responsiveSizing.borderRadius}px`,
      overflow: 'hidden',
      cursor: isTransitioning ? 'default' : 'pointer',
      border: '2px solid rgba(255, 255, 255, 0.2)',
      opacity: 0.8,
      transform: 'scale(1)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      position: 'relative' as const,
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      backdropFilter: 'blur(10px) saturate(150%)',
      boxShadow: '0 4px 12px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
      '&::before': {
        content: '""',
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        borderRadius: `${responsiveSizing.borderRadius}px`,
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.15) 0%, rgba(255, 255, 255, 0.08) 50%, rgba(255, 255, 255, 0.03) 100%)',
        opacity: 0,
        transition: 'opacity 0.3s ease',
        zIndex: 1,
      }
    },
    active: {
      opacity: 1,
      transform: 'scale(1.15)',
      border: '3px solid rgba(255, 255, 255, 0.9)',
      boxShadow: '0 8px 24px rgba(0, 0, 0, 0.3), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
      '&::before': {
        opacity: 1,
      }
    },
    transitioning: {
      opacity: 0.9,
      transform: 'scale(1.08)'
    },
    hover: {
      opacity: 1,
      transform: 'scale(1.2)',
      boxShadow: '0 12px 32px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(255, 255, 255, 0.2)',
      border: '2px solid rgba(255, 255, 255, 0.4)',
      '&::before': {
        opacity: 0.8,
      }
    },

    pulse: {
      position: 'absolute' as const,
      top: 3,
      right: 3,
      width: 8,
      height: 8,
      borderRadius: '50%',
      backgroundColor: 'rgba(33, 150, 243, 0.8)',
      backdropFilter: 'blur(4px)',
      border: '1px solid rgba(255, 255, 255, 0.3)',
      boxShadow: '0 2px 8px rgba(33, 150, 243, 0.4)',
      animation: 'pulse 1.5s ease-in-out infinite',
      zIndex: 2,
    }
  }), [isTransitioning, isImmersiveMode]);

  // Hide in immersive mode for true full-screen experience
  if (images.length <= 1 || isImmersiveMode) return null;

  // Calculate total width for virtual scrolling
  const totalWidth = images.length * THUMBNAIL_WIDTH;

  // Progress indicator component
  const ProgressIndicator = () => (
    <Box
      sx={{
        position: 'absolute',
        top: -25,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '80%',
        height: 4,
        bgcolor: 'rgba(255, 255, 255, 0.2)',
        borderRadius: 2,
        overflow: 'hidden',
        zIndex: 1301
      }}
    >
      <Box
        sx={{
          width: `${((currentIndex + 1) / images.length) * 100}%`,
          height: '100%',
          bgcolor: 'white',
          borderRadius: 2,
          transition: 'width 0.3s cubic-bezier(0.4, 0, 0.2, 1)'
        }}
      />
    </Box>
  );

  // Skeleton loading component
  const ThumbnailSkeleton = () => (
    <Box
      sx={{
        width: '100%',
        height: '100%',
        bgcolor: 'rgba(255, 255, 255, 0.1)',
        borderRadius: `${responsiveSizing.borderRadius}px`,
        backdropFilter: 'blur(5px)',
        position: 'relative',
        overflow: 'hidden',
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: '-100%',
          width: '100%',
          height: '100%',
          background: 'linear-gradient(90deg, transparent, rgba(255, 255, 255, 0.2), transparent)',
          animation: 'shimmer 1.5s infinite',
        },
        '@keyframes shimmer': {
          '0%': { left: '-100%' },
          '100%': { left: '100%' }
        }
      }}
    />
  );

  // Image counter component
  const ImageCounter = () => (
    <Box
      sx={{
        position: 'absolute',
        top: -30,
        right: 16,
        bgcolor: 'rgba(0, 0, 0, 0.7)',
        backdropFilter: 'blur(10px)',
        borderRadius: 2,
        px: 2,
        py: 0.5,
        border: '1px solid rgba(255, 255, 255, 0.2)',
        zIndex: 1301
      }}
    >
      <Typography
        variant="caption"
        sx={{
          color: 'white',
          fontWeight: 600,
          fontSize: '0.75rem'
        }}
      >
        {currentIndex + 1} / {images.length}
      </Typography>
    </Box>
  );

  return (
    <>
      <ProgressIndicator />
      <ImageCounter />
      <Box
        ref={stripRef}
        onScroll={handleScroll}
        onTouchStart={handleTouchStart}
        onTouchEnd={handleTouchEnd}
        sx={{
        position: 'fixed',
        bottom: 30,
        left: '50%',
        transform: 'translateX(-50%)',
        width: '90vw',
        maxWidth: 1200,
        height: 85,
        backgroundColor: 'rgba(255, 255, 255, 0.08)',
        backdropFilter: 'blur(25px) saturate(180%)',
        borderRadius: 35,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        px: 2,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: 'rgba(255, 255, 255, 0.3) rgba(255, 255, 255, 0.1)',
        border: '1px solid rgba(255, 255, 255, 0.2)',
        boxShadow: '0 12px 40px rgba(0, 0, 0, 0.2), inset 0 1px 0 rgba(255, 255, 255, 0.1)',
        transition: 'all 0.4s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: isTransitioning ? 0.7 : 0.95,
        zIndex: 1300,
        '&::before': {
          content: '""',
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          borderRadius: 35,
          background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.1) 0%, rgba(255, 255, 255, 0.05) 50%, rgba(255, 255, 255, 0.02) 100%)',
          opacity: 0.8,
          pointerEvents: 'none',
        },
        '&::-webkit-scrollbar': {
          height: 6
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(255, 255, 255, 0.1)',
          borderRadius: 3
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.3)',
          borderRadius: 3,
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.5)'
          }
        }
      }}
    >
      {/* Virtualized container */}
        <Box
          sx={{
            position: 'relative',
            width: totalWidth,
            height: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: `${responsiveSizing.gap}px`
          }}
        >
        {Array.from({ length: visibleRange.end - visibleRange.start }, (_, i) => {
          const index = visibleRange.start + i;
          const isActive = index === currentIndex;
          const isLoading = loadingStates[index];
          const hasPreview = previewUrls[index];

          return (
            <Box
              key={index}
              onClick={() => !isTransitioning && onImageSelect(index)}
              onMouseEnter={() => handleMouseEnter(index)}
              onMouseLeave={handleMouseLeave}
              sx={{
                ...thumbnailStyles.container,
                ...(isActive && thumbnailStyles.active),
                ...(isTransitioning && thumbnailStyles.transitioning),
                '&:hover': !isTransitioning ? thumbnailStyles.hover : {}
              }}
            >
              {hasPreview ? (
                <img
                  src={previewUrls[index]}
                  alt={`Preview ${index + 1}`}
                  style={{
                    width: '100%',
                    height: '100%',
                    objectFit: 'cover',
                    borderRadius: '10px',
                    filter: isActive ? 'brightness(1.2) contrast(1.1) saturate(1.1)' : 'brightness(0.9) contrast(0.95)',
                    transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
                    transform: isActive ? 'scale(1.05)' : 'scale(1)',
                  }}
                />
              ) : (
                <ThumbnailSkeleton />
              )}

              {/* Loading indicator for cached images */}
              {isLoading && !hasPreview && (
                <Box sx={thumbnailStyles.pulse} />
              )}

              {/* Preview tooltip on hover */}
              <PreviewTooltip index={index} />
            </Box>
          );
        })}
      </Box>
    </Box>
    </>
  );
});

PreviewStrip.displayName = 'PreviewStrip';

export default PreviewStrip;