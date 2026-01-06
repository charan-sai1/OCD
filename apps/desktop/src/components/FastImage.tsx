// Fast, memory-efficient image component using client-side preview generation
import React, { useState, useEffect, memo } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { generateImagePreview, cleanupPreviewUrl } from '../utils/previewGenerator';
import { previewCache } from '../utils/previewCache';
import { getImageUrl } from '../utils/imageUrlUtils';

interface FastImageProps {
  imagePath: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onLoad?: () => void;
  onError?: (error: string) => void;
  width?: number;
  height?: number;
  priority?: 'high' | 'normal' | 'low';
  progressiveLoading?: boolean; // Enable progressive loading with blur-to-sharp
}

const FastImage: React.FC<FastImageProps> = memo(({
  imagePath,
  alt = '',
  className = '',
  style = {},
  onClick,
  onLoad,
  onError,
  width,
  height,
  priority = 'normal',
  progressiveLoading = true
}) => {
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [lowQualityUrl, setLowQualityUrl] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isProgressiveLoading, setIsProgressiveLoading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    let currentUrl: string | null = null;

    const loadPreview = async () => {
      try {
        // Progressive loading for high-priority images when enabled
        if (priority === 'high' && progressiveLoading) {
          setIsProgressiveLoading(true);

          // First, try to load low-quality version (smaller size)
          try {
            const lowQualityCached = await previewCache.get(imagePath);
            if (lowQualityCached && isMounted) {
              setLowQualityUrl(lowQualityCached);
            }
          } catch (lowQualityError) {
            console.warn('Low quality preview failed, continuing with high quality');
          }
        }

        // Check for high-quality cached version
        const cachedUrl = await previewCache.get(imagePath);
        if (cachedUrl && isMounted) {
          setPreviewUrl(cachedUrl);
          setIsLoading(false);
          setIsProgressiveLoading(false);
          onLoad?.();
          return;
        }

        // Generate new preview
        const newUrl = await generateImagePreview(imagePath, {
          maxWidth: width || 300,
          maxHeight: height || 300,
          quality: 0.7,
          format: 'jpeg'
        });

        if (isMounted) {
          currentUrl = newUrl;
          setPreviewUrl(newUrl);
          setIsLoading(false);
          onLoad?.();

          // Cache the preview (but we need the blob, not the URL)
          // For now, we'll cache on-demand when we have the blob
        }
      } catch (err) {
        if (isMounted) {
          const errorMessage = err instanceof Error ? err.message : 'Failed to load image';
          setError(errorMessage);
          setIsLoading(false);
          onError?.(errorMessage);
        }
      }
    };

    // Add small delay based on priority to prevent all images loading at once
    const delay = priority === 'high' ? 0 : priority === 'normal' ? 10 : 50;
    const timeoutId = setTimeout(loadPreview, delay);

    // Cleanup function
    return () => {
      isMounted = false;
      clearTimeout(timeoutId);
      if (currentUrl) {
        cleanupPreviewUrl(currentUrl);
      }
    };
  }, [imagePath, width, height, priority, onLoad, onError]);

  // Loading state
  if (isLoading) {
    return (
      <Box
        className={`fast-image-loading ${className}`}
        style={{
          width: width || 300,
          height: height || 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a1a',
          borderRadius: 8,
          ...style
        }}
        onClick={onClick}
      >
        <CircularProgress size={20} sx={{ color: 'white' }} />
      </Box>
    );
  }

  // Error state
  if (error) {
    return (
      <Box
        className={`fast-image-error ${className}`}
        style={{
          width: width || 300,
          height: height || 300,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#f44336',
          borderRadius: 8,
          color: 'white',
          fontSize: '0.7rem',
          textAlign: 'center',
          padding: 4,
          ...style
        }}
        onClick={onClick}
      >
        <div>Failed to load</div>
        <div style={{ fontSize: '0.6rem', marginTop: 2, wordBreak: 'break-all' }}>
          {imagePath.split('/').pop()}
        </div>
      </Box>
    );
  }

  // Progressive loading with blur-to-sharp transition
  if (isProgressiveLoading && lowQualityUrl && !previewUrl) {
    return (
      <Box
        className={`fast-image-progressive ${className}`}
        style={{
          position: 'relative',
          width: width || 300,
          height: height || 300,
          borderRadius: 8,
          overflow: 'hidden',
          cursor: onClick ? 'pointer' : 'default',
          ...style
        }}
        onClick={onClick}
      >
        {/* Low quality background */}
        <img
          src={lowQualityUrl}
          alt={alt}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            filter: 'blur(2px)',
            transform: 'scale(1.1)', // Slight scale to hide blur edges
            opacity: 0.8,
          }}
        />
        {/* High quality overlay (when available) */}
        {previewUrl && (
          <img
            src={previewUrl}
            alt={alt}
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              borderRadius: 8,
              opacity: 1,
              transition: 'opacity 0.3s ease-in-out',
            }}
          />
        )}
      </Box>
    );
  }

  // Standard image loading
  return (
    <img
      src={previewUrl || undefined}
      alt={alt}
      className={`fast-image ${className}`}
      style={{
        width: width || 300,
        height: height || 300,
        objectFit: 'cover',
        borderRadius: 8,
        display: 'block',
        cursor: onClick ? 'pointer' : 'default',
        // Smooth transition for progressive loading
        transition: isProgressiveLoading ? 'filter 0.3s ease-in-out' : 'none',
        filter: isProgressiveLoading && lowQualityUrl ? 'none' : undefined,
        ...style
      }}
      onClick={onClick}
      loading="lazy"
      decoding="async"
      onError={(e) => {
        console.error(`Image load error for ${imagePath}`);
        const img = e.currentTarget as HTMLImageElement;

        // Fallback to direct image loading
        img.src = getImageUrl(imagePath);
      }}
    />
  );
});

FastImage.displayName = 'FastImage';

export default FastImage;