import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Box } from '@mui/material';
import ImagePlaceholder from './ImagePlaceholder';
import FastImage from './FastImage';

interface LazyImageContainerProps {
  imagePath: string;
  width?: number;
  height?: number;
  aspectRatio?: number;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: (error: string) => void;
  placeholderVariant?: 'skeleton' | 'shimmer' | 'simple';
  transitionDuration?: number;
  priority?: 'high' | 'normal' | 'low';
}

type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';

const LazyImageContainer: React.FC<LazyImageContainerProps> = memo(({
  imagePath,
  width = 300,
  height = 300,
  aspectRatio = 1,
  onClick,
  onLoad,
  onError,
  placeholderVariant = 'shimmer',
  transitionDuration = 300,
  priority = 'normal'
}) => {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasBeenVisible = useRef(false);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting && !hasBeenVisible.current) {
            hasBeenVisible.current = true;
            setLoadingState('loading');
          }
        });
      },
      {
        rootMargin: '100px', // Start loading 100px before visible
        threshold: 0.1
      }
    );

    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, []);

  // Handle image load completion
  const handleImageLoad = useCallback(() => {
    setLoadingState('loaded');
    onLoad?.();

    // Smooth transition to hide placeholder
    setTimeout(() => {
      setShowPlaceholder(false);
    }, 50); // Small delay for smooth transition
  }, [onLoad]);

  // Handle image load error
  const handleImageError = useCallback((error: string) => {
    setLoadingState('error');
    onError?.(error);

    // Keep placeholder visible on error
    setShowPlaceholder(true);
  }, [onError]);

  return (
    <Box
      ref={containerRef}
      data-image-path={imagePath}
      onClick={onClick}
      sx={{
        position: 'relative',
        width: '100%',
        aspectRatio: aspectRatio.toString(),
        cursor: onClick ? 'pointer' : 'default',
        borderRadius: 2,
        overflow: 'hidden'
      }}
    >
      {/* Placeholder Layer */}
      <Box
        sx={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%',
          height: '100%',
          opacity: showPlaceholder ? 1 : 0,
          transition: `opacity ${transitionDuration}ms ease-out`,
          zIndex: 1
        }}
      >
        <ImagePlaceholder
          width={width}
          height={height}
          aspectRatio={aspectRatio}
          showLoadingIndicator={loadingState === 'loading'}
          variant={loadingState === 'error' ? 'simple' : placeholderVariant}
        />
      </Box>

      {/* Actual Image Layer */}
      {loadingState === 'loading' && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: showPlaceholder ? 0 : 1,
            transition: `opacity ${transitionDuration}ms ease-in`,
            zIndex: 2
          }}
        >
          <FastImage
            imagePath={imagePath}
            alt={`Image ${imagePath.split('/').pop()}`}
            width={width}
            height={height}
            priority={priority}
            onLoad={handleImageLoad}
            onError={handleImageError}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 8
            }}
          />
        </Box>
      )}

      {/* Error State Overlay */}
      {loadingState === 'error' && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: 2,
            zIndex: 3
          }}
        >
          <Box
            sx={{
              color: 'white',
              textAlign: 'center',
              fontSize: '0.75rem',
              px: 1
            }}
          >
            Failed to load
          </Box>
        </Box>
      )}
    </Box>
  );
});

LazyImageContainer.displayName = 'LazyImageContainer';

export default LazyImageContainer;