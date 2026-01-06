import React, { useRef, useEffect, useMemo, useState, useCallback } from 'react';
import { Box } from '@mui/material';

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

  // Virtualization constants
  const THUMBNAIL_WIDTH = 64;
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

  const thumbnailStyles = useMemo(() => ({
    container: {
      flexShrink: 0,
      width: 60,
      height: 60,
      borderRadius: '12px',
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
        borderRadius: '12px',
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
    loading: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%',
      backgroundColor: 'rgba(255, 255, 255, 0.1)',
      borderRadius: '10px',
      backdropFilter: 'blur(5px)',
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

  return (
    <Box
      ref={stripRef}
      onScroll={handleScroll}
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
          gap: 0.5
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
                <Box sx={thumbnailStyles.loading}>
                  {/* Minimal loading indicator */}
                  <Box
                    sx={{
                      width: 16,
                      height: 16,
                      border: '2px solid rgba(255, 255, 255, 0.3)',
                      borderTop: '2px solid white',
                      borderRadius: '50%',
                      animation: 'spin 1s linear infinite'
                    }}
                  />
                </Box>
              )}

              {/* Loading indicator for cached images */}
              {isLoading && !hasPreview && (
                <Box sx={thumbnailStyles.pulse} />
              )}
            </Box>
          );
        })}
      </Box>
    </Box>
  );
});

PreviewStrip.displayName = 'PreviewStrip';

export default PreviewStrip;