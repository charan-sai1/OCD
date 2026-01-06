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
  priority = 'normal'
}) => {
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const containerRef = useRef<HTMLDivElement>(null);
  const hasBeenVisible = useRef(false);

  // Intersection Observer for lazy loading
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (process.env.NODE_ENV === 'development') {
            console.log('LazyImage intersection:', {
              imagePath: imagePath.split('/').pop(),
              isIntersecting: entry.isIntersecting,
              hasBeenVisible: hasBeenVisible.current
            });
          }

          if (entry.isIntersecting && !hasBeenVisible.current) {
            hasBeenVisible.current = true;
            setLoadingState('loading');

            if (process.env.NODE_ENV === 'development') {
              console.log('LazyImage: Starting load for', imagePath.split('/').pop());
            }
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
    if (process.env.NODE_ENV === 'development') {
      console.log('LazyImage: Image loaded successfully', imagePath.split('/').pop());
    }

    setLoadingState('loaded');
    onLoad?.();
  }, [onLoad, imagePath]);

  // Handle image load error
  const handleImageError = useCallback((error: string) => {
    if (process.env.NODE_ENV === 'development') {
      console.error('LazyImage: Image load failed', imagePath.split('/').pop(), error);
    }

    setLoadingState('error');
    onError?.(error);
  }, [onError, imagePath]);

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
        overflow: 'hidden',
        border: '2px solid transparent',
        '&:hover': {
          borderColor: 'primary.main'
        }
      }}
    >
      {/* Show placeholder initially */}
      {loadingState !== 'loaded' && (
        <ImagePlaceholder
          aspectRatio={aspectRatio}
          showLoadingIndicator={loadingState === 'loading'}
          variant={loadingState === 'error' ? 'simple' : placeholderVariant}
        />
      )}

      {/* Show actual image when loaded */}
      {loadingState === 'loaded' && (
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
      )}

      {/* Debug info */}
      {process.env.NODE_ENV === 'development' && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            fontSize: '0.6rem',
            padding: '2px 4px',
            borderRadius: 1,
            zIndex: 10
          }}
        >
          {loadingState}
        </Box>
      )}
    </Box>
  );
});

LazyImageContainer.displayName = 'LazyImageContainer';

export default LazyImageContainer;