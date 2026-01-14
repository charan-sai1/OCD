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
  onDoubleTap?: () => void;
  placeholderVariant?: 'skeleton' | 'shimmer' | 'wave' | 'simple';
  imageAnimation?: 'scale' | 'slide' | 'fade' | 'bounce';
  priority?: 'high' | 'normal' | 'low';
  enableTouchGestures?: boolean;
}

const LazyImageContainer: React.FC<LazyImageContainerProps> = memo(({
  imagePath,
  aspectRatio = 1,
  onClick,
  onLoad,
  onError,
  placeholderVariant = 'skeleton',
  imageAnimation = 'scale',
}) => {
  type LoadingState = 'idle' | 'loading' | 'loaded' | 'error';
  const [loadingState, setLoadingState] = useState<LoadingState>('idle');
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const hasBeenVisible = useRef(false);
  const loadTimeoutRef = useRef<NodeJS.Timeout>();

  // Async image loading function with proper error handling
  const loadImageAsync = useCallback(async (imagePath: string): Promise<void> => {
    try {
      // Simple approach: use convertFileSrc directly
      const { convertFileSrc } = await import('@tauri-apps/api/core');
      const imageUrl = convertFileSrc(imagePath);

      setImageUrl(imageUrl);
      setLoadingState('loaded');
      onLoad?.();

    } catch (error) {
      console.error('LazyImage: Failed to generate URL for', imagePath, error);
      setLoadingState('error');
      onError?.(error instanceof Error ? error.message : 'Failed to load image');
    }
  }, [onLoad, onError, imagePath]);

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
          if (entry.isIntersecting && !hasBeenVisible.current) {
            hasBeenVisible.current = true;
            setLoadingState('loading');
            startLoadingTimeout();



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

    console.log(`[Image Loading] Image loaded successfully: ${imagePath.split('/').pop()}`);

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
            zIndex: 2,
            boxShadow: loadingState === 'loaded' ? '0 4px 12px rgba(0,0,0,0.1)' : 'none',
            // Dynamic animation based on type
            ...(imageAnimation === 'scale' && {
              opacity: loadingState === 'loaded' ? 1 : 0,
              transform: loadingState === 'loaded' ? 'scale(1) translateY(0)' : 'scale(0.95) translateY(8px)',
              transition: 'all 0.5s cubic-bezier(0.25, 0.46, 0.45, 0.94)',
              filter: loadingState === 'loaded' ? 'none' : 'blur(2px)'
            }),
            ...(imageAnimation === 'slide' && {
              opacity: loadingState === 'loaded' ? 1 : 0,
              transform: loadingState === 'loaded' ? 'translateY(0)' : 'translateY(20px)',
              transition: 'all 0.6s cubic-bezier(0.25, 0.46, 0.45, 0.94)'
            }),
            ...(imageAnimation === 'fade' && {
              opacity: loadingState === 'loaded' ? 1 : 0,
              transition: 'opacity 0.4s ease-out'
            }),
            ...(imageAnimation === 'bounce' && {
              opacity: loadingState === 'loaded' ? 1 : 0,
              transform: loadingState === 'loaded' ? 'scale(1)' : 'scale(0.8)',
              transition: 'all 0.7s cubic-bezier(0.68, -0.55, 0.265, 1.55)',
              filter: loadingState === 'loaded' ? 'none' : 'brightness(0.8)'
            })
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