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
      width: isImmersiveMode ? 48 : 56,
      height: isImmersiveMode ? 48 : 56,
      borderRadius: 2,
      overflow: 'hidden',
      cursor: isTransitioning ? 'default' : 'pointer',
      border: '2px solid transparent',
      opacity: isImmersiveMode ? 0.5 : 0.6,
      transform: 'scale(1)',
      transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
      position: 'relative' as const,
      backgroundColor: 'rgba(255, 255, 255, 0.05)'
    },
    active: {
      opacity: 1,
      transform: isImmersiveMode ? 'scale(1.05)' : 'scale(1.1)',
      border: '2px solid white',
      boxShadow: isImmersiveMode ? '0 0 0 1px rgba(255, 255, 255, 0.2)' : '0 0 0 2px rgba(255, 255, 255, 0.3)'
    },
    transitioning: {
      opacity: isImmersiveMode ? 0.7 : 0.8,
      transform: isImmersiveMode ? 'scale(1.02)' : 'scale(1.05)'
    },
    hover: {
      opacity: 1,
      transform: isImmersiveMode ? 'scale(1.1)' : 'scale(1.15)',
      boxShadow: isImmersiveMode ? '0 2px 8px rgba(0, 0, 0, 0.3)' : '0 4px 12px rgba(0, 0, 0, 0.5)'
    },
    loading: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '100%',
      height: '100%'
    },
    pulse: {
      position: 'absolute' as const,
      top: 2,
      right: 2,
      width: 6,
      height: 6,
      borderRadius: '50%',
      backgroundColor: '#2196f3',
      animation: 'pulse 1.5s ease-in-out infinite'
    }
  }), [isTransitioning, isImmersiveMode]);

  // Show minimal navigation even in immersive mode
  if (images.length <= 1) return null;

  // Calculate total width for virtual scrolling
  const totalWidth = images.length * THUMBNAIL_WIDTH;

  return (
    <Box
      ref={stripRef}
      onScroll={handleScroll}
      sx={{
        position: 'fixed',
        bottom: isImmersiveMode ? 20 : 100,
        left: '50%',
        transform: 'translateX(-50%)',
        width: isImmersiveMode ? '95vw' : '90vw',
        maxWidth: isImmersiveMode ? 1200 : 800,
        height: isImmersiveMode ? 60 : 80,
        backgroundColor: isImmersiveMode ? 'rgba(0, 0, 0, 0.6)' : 'rgba(0, 0, 0, 0.9)',
        backdropFilter: isImmersiveMode ? 'blur(10px)' : 'blur(20px)',
        borderRadius: isImmersiveMode ? 2 : 3,
        display: 'flex',
        alignItems: 'center',
        px: 1,
        overflowX: 'auto',
        overflowY: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: isImmersiveMode ? 'rgba(255, 255, 255, 0.2) rgba(0, 0, 0, 0.2)' : 'rgba(255, 255, 255, 0.3) rgba(0, 0, 0, 0.3)',
        border: isImmersiveMode ? '1px solid rgba(255, 255, 255, 0.1)' : '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: isImmersiveMode ? '0 4px 16px rgba(0, 0, 0, 0.4)' : '0 8px 32px rgba(0, 0, 0, 0.6)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: isTransitioning ? 0.7 : (isImmersiveMode ? 0.8 : 1),
        zIndex: 1300,
        '&::-webkit-scrollbar': {
          height: 4
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'rgba(0, 0, 0, 0.4)',
          borderRadius: 2
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: 'rgba(255, 255, 255, 0.4)',
          borderRadius: 2,
          '&:hover': {
            backgroundColor: 'rgba(255, 255, 255, 0.6)'
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
                    filter: isActive ? 'brightness(1.1) contrast(1.1)' : 'none',
                    transition: 'filter 0.3s ease'
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