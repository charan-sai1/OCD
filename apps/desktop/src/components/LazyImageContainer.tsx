import React, { useState, useEffect, useRef, memo, useCallback } from 'react';
import { Box } from '@mui/material';
import ImagePlaceholder from './ImagePlaceholder';

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
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasBeenVisible = useRef(false);
  const loadTimeoutRef = useRef<NodeJS.Timeout>();

  // Debug logging
  if (process.env.NODE_ENV === 'development') {
    console.log('LazyImageContainer received imagePath:', imagePath);
  }

  // Async image loading function with proper error handling
  const loadImageAsync = useCallback(async (imagePath: string): Promise<void> => {
    try {
      // Import dependencies dynamically to avoid circular imports
      const { previewCache } = await import('../utils/previewCache');
      const { generateImagePreview } = await import('../utils/previewGenerator');

      // Step 1: Check cache first (fast operation)
      const cachedUrl = await previewCache.get(imagePath);
      if (cachedUrl) {
        setImageUrl(cachedUrl);
        setLoadingState('loaded');
        onLoad?.();
        return;
      }

      // Step 2: Generate preview if not cached (slower operation)
      const generatedUrl = await generateImagePreview(imagePath, {
        maxWidth: width,
        maxHeight: height,
        quality: priority === 'high' ? 0.8 : 0.7,
        format: 'jpeg'
      });

      setImageUrl(generatedUrl);
      setLoadingState('loaded');
      onLoad?.();

    } catch (error) {
      console.error('LazyImage: Async loading failed for', imagePath.split('/').pop(), error);
      setLoadingState('error');
      onError?.(error instanceof Error ? error.message : 'Unknown error');
    }
  }, [width, height, priority, onLoad, onError, imagePath]);

  // Loading timeout to prevent infinite loading states
  const startLoadingTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
    }

    loadTimeoutRef.current = setTimeout(() => {
      console.warn('LazyImage: Load timeout for', imagePath.split('/').pop());
      setLoadingState('error');
      onError?.('Load timeout');
    }, 15000); // 15 second timeout
  }, [imagePath, onError]);

  // Clear loading timeout
  const clearLoadingTimeout = useCallback(() => {
    if (loadTimeoutRef.current) {
      clearTimeout(loadTimeoutRef.current);
      loadTimeoutRef.current = undefined;
    }
  }, [imagePath, loadImageAsync, startLoadingTimeout]);

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
            startLoadingTimeout();

            if (process.env.NODE_ENV === 'development') {
              console.log('LazyImage: Starting async load for', imagePath.split('/').pop());
            }

            // Actually start the async loading
            loadImageAsync(imagePath).catch((error) => {
              console.error('LazyImage: Load failed in intersection handler:', error);
            });
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
  }, [imagePath, loadImageAsync, startLoadingTimeout]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearLoadingTimeout();
    };
  }, [clearLoadingTimeout]);

  // Handle image load completion
  const handleImageLoad = useCallback(() => {
    clearLoadingTimeout();
    if (process.env.NODE_ENV === 'development') {
      console.log('LazyImage: Image loaded successfully', imagePath.split('/').pop());
    }

    setLoadingState('loaded');
    onLoad?.();
  }, [onLoad, imagePath, clearLoadingTimeout]);

  // Handle image load error
  const handleImageError = useCallback((error: string) => {
    clearLoadingTimeout();
    if (process.env.NODE_ENV === 'development') {
      console.error('LazyImage: Image load failed', imagePath.split('/').pop(), error);
    }

    setLoadingState('error');
    onError?.(error);
  }, [onError, imagePath, clearLoadingTimeout]);

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
      {/* Show placeholder while idle or loading */}
      {(loadingState === 'idle' || loadingState === 'loading') && (
        <ImagePlaceholder
          aspectRatio={aspectRatio}
          showLoadingIndicator={loadingState === 'loading'}
          variant={placeholderVariant}
        />
      )}

      {/* Show actual image when loading has started (not just when loaded) */}
      {loadingState !== 'idle' && imageUrl && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '100%',
            height: '100%',
            opacity: loadingState === 'loaded' ? 1 : 0,
            transition: 'opacity 0.3s ease-in',
            zIndex: 2
          }}
        >
          <img
            src={imageUrl}
            alt={`Image ${imagePath.split('/').pop()}`}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 8
            }}
            onLoad={handleImageLoad}
            onError={() => handleImageError('Image failed to load')}
          />
        </Box>
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