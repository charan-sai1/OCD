import React, { useState, useEffect, useRef, useCallback, memo } from 'react';
import Box from '@mui/material/Box';
import CircularProgress from '@mui/material/CircularProgress';
import { progressiveImagePreloader, ImageQuality, LoadingPriority } from '../utils/progressiveImagePreloader';
import { getImageUrl } from '../utils/imageUrlUtils';
import '../styles/animations.css';

interface ImageState {
  [ImageQuality.THUMBNAIL]: string | null;
  [ImageQuality.PREVIEW]: string | null;
  [ImageQuality.FULL]: string | null;
}

interface ProgressiveImageProps {
  imagePath: string;
  alt?: string;
  className?: string;
  style?: React.CSSProperties;
  onClick?: () => void;
  onLoad?: (quality: ImageQuality, source?: 'exif' | 'generated') => void;
  onError?: (error: string) => void;
  priority?: LoadingPriority;
  enableTransitions?: boolean;
  transitionDuration?: number;
}

// Helper function to validate data URLs
const isValidDataUrl = (url: string): boolean => {
  return url.startsWith('data:image/') &&
         url.includes('base64,') &&
         url.length > 'data:image/jpeg;base64,'.length;
};

const ProgressiveImage: React.FC<ProgressiveImageProps> = memo(({
  imagePath,
  alt = '',
  className = '',
  style = {},
  onClick,
  onLoad,
  onError,
  priority = LoadingPriority.NORMAL,
  enableTransitions = true,
  transitionDuration = 300
}) => {
  const [currentImage, setCurrentImage] = useState<string | null>(null);
  const [currentQuality, setCurrentQuality] = useState<ImageQuality | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [thumbnailSource, setThumbnailSource] = useState<'exif' | 'generated' | null>(null);

  const imageStates = useRef<ImageState>({
    [ImageQuality.THUMBNAIL]: null,
    [ImageQuality.PREVIEW]: null,
    [ImageQuality.FULL]: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const transitionTimeoutRef = useRef<NodeJS.Timeout>();

  // Reset state when imagePath changes
  useEffect(() => {
    setCurrentImage(null);
    setCurrentQuality(null);
    setIsLoading(true);
    setError(null);
    setThumbnailSource(null);
  }, [imagePath]);

  // Load progressive image
  useEffect(() => {
    if (!imagePath) return;

    // Define quality levels to load
    const qualities = {
      [ImageQuality.THUMBNAIL]: 150,  // Small thumbnail
      [ImageQuality.PREVIEW]: 400,    // Medium preview
      [ImageQuality.FULL]: true,      // Full resolution
    };

    // Load progressive image
    progressiveImagePreloader.loadProgressiveImage({
      imagePath,
      qualities,
      priority,
      onProgress: (quality, data) => {
        if (data && isValidDataUrl(data)) {
          // Define quality hierarchy for upgrades
          const qualityOrder = { [ImageQuality.THUMBNAIL]: 1, [ImageQuality.PREVIEW]: 2, [ImageQuality.FULL]: 3 };
          const currentOrder = currentQuality ? qualityOrder[currentQuality] : 0;
          const newOrder = qualityOrder[quality];

          // Update if: no current image, or new quality is higher/better
          const shouldUpdate = !currentImage || newOrder >= currentOrder;

          if (shouldUpdate) {
            setCurrentImage(data);
            setCurrentQuality(quality);

            // Hide loading spinner as soon as we have displayable content
            if (isLoading) {
              setIsLoading(false);
            }

            // Determine thumbnail source (simplified)
            if (quality === ImageQuality.THUMBNAIL) {
              setThumbnailSource('exif'); // Assume EXIF for now
            }

            onLoad?.(quality, quality === ImageQuality.THUMBNAIL ? 'exif' : 'generated');
          }
        } else {
          console.warn(`ProgressiveImage: Invalid data URL for ${imagePath} quality ${quality}`);
        }
      },
      onComplete: (result) => {
        // Only set loading to false if we don't already have content
        if (isLoading && !currentImage) {
          setIsLoading(false);
        }

        if (result.error) {
          console.error(`Failed to load image: ${imagePath} - ${result.error}`);
          setError(result.error);
          onError?.(result.error);
        } else if (!result.thumbnail && !result.preview && !result.full) {
          // No images were generated, try direct loading as fallback
          const directUrl = getImageUrl(imagePath);
          setCurrentImage(directUrl);
          setCurrentQuality(ImageQuality.FULL);
          setIsLoading(false);
          onLoad?.(ImageQuality.FULL, 'generated');
        }
      },
      onError: (error) => {
        setIsLoading(false);
        setError(error);

        // Fallback: try loading directly
        try {
          const directUrl = getImageUrl(imagePath);
          const img = new Image();
          img.onload = () => {
            setCurrentImage(directUrl);
            setCurrentQuality(ImageQuality.FULL);
            setError(null);
            onLoad?.(ImageQuality.FULL, 'generated');
          };
          img.onerror = () => {
            onError?.(error);
          };
          img.src = directUrl;

          // Timeout fallback loading
          setTimeout(() => {
            if (isLoading) {
              setIsLoading(false);
              onError?.('Image load timeout');
            }
          }, 3000);
        } catch (fallbackError) {
          onError?.(error);
        }
      }
    });

    // Cleanup function
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [imagePath, priority, currentImage]);



  // Smooth transition to new quality
  const transitionToQuality = useCallback((quality: ImageQuality, imageData: string) => {
    if (currentImage === imageData) return; // Same image, no transition needed

    setIsTransitioning(true);

    // Set new image immediately for smooth transition
    setCurrentImage(imageData);
    setCurrentQuality(quality);
    onLoad?.(quality);

    // Clear transition state after animation completes
    transitionTimeoutRef.current = setTimeout(() => {
      setIsTransitioning(false);
    }, transitionDuration);
  }, [currentImage, transitionDuration, onLoad]);

  // Handle click to upgrade to full quality
  const handleClick = useCallback(() => {
    if (currentQuality !== ImageQuality.FULL && imageStates.current[ImageQuality.FULL]) {
      // Full quality is already loaded, just transition
      transitionToQuality(ImageQuality.FULL, imageStates.current[ImageQuality.FULL]!);
    } else if (currentQuality !== ImageQuality.FULL) {
      // Load full quality on demand
      progressiveImagePreloader.loadProgressiveImage({
        imagePath,
        qualities: { [ImageQuality.FULL]: true },
        priority: LoadingPriority.IMMEDIATE,
        onProgress: (quality, data) => {
          if (quality === ImageQuality.FULL) {
            transitionToQuality(quality, data);
          }
        }
      });
    }

    onClick?.();
  }, [currentQuality, imagePath, transitionToQuality, onClick]);

  // Render loading state
  if (isLoading && !currentImage) {
    return (
      <Box
        ref={containerRef}
        className={`progressive-image-loading ${className}`}
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: '#1a1a1a',
          borderRadius: 8,
          ...style
        }}
        onClick={handleClick}
      >
        <CircularProgress size={24} sx={{ color: 'white' }} />
      </Box>
    );
  }

  // Render error state
  if (error && !currentImage) {
    return (
      <Box
        ref={containerRef}
        className={`progressive-image-error ${className}`}
        style={{
          width: '100%',
          height: '100%',
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
        onClick={handleClick}
      >
        <div>Error loading:</div>
        <div style={{ fontSize: '0.6rem', marginTop: 2, wordBreak: 'break-all' }}>
          {imagePath.split('/').pop()}
        </div>
      </Box>
    );
  }

  // Render image with smooth transitions
  return (
    <Box
      ref={containerRef}
      className={`progressive-image ${className}`}
      style={{
        width: '100%',
        height: '100%',
        position: 'relative',
        overflow: 'hidden',
        borderRadius: 8,
        cursor: onClick ? 'pointer' : 'default',
        ...style
      }}
      onClick={handleClick}
    >
      {currentImage && (
        <img
          src={currentImage}
          alt={alt}
          className={enableTransitions ? (isTransitioning ? 'quality-upgrade' : 'quality-stable') : ''}
          style={{
            width: '100%',
            height: '100%',
            objectFit: 'cover',
            borderRadius: 8,
            display: 'block',
            transition: enableTransitions ? `all ${transitionDuration}ms ease-out` : 'none',
            transform: isTransitioning ? 'scale(1.02)' : 'scale(1)',
            filter: isTransitioning ? 'brightness(1.1)' : 'brightness(1)',
          }}
          onLoad={() => {
            // Image loaded successfully
          }}
          onError={(e) => {
            console.error(`Image load failed: ${imagePath}`);

            // Try fallback to direct file loading
            if (currentQuality !== ImageQuality.FULL) {
              const img = e.currentTarget as HTMLImageElement;
              const directUrl = getImageUrl(imagePath);
              img.src = directUrl;
              setCurrentQuality(ImageQuality.FULL);
            } else {
              // Already tried fallback, show error
              setError(`Failed to load image: ${imagePath}`);
              onError?.(`Failed to load image: ${imagePath}`);
            }
          }}
        />
      )}

      {/* Quality indicator for debugging */}
      {process.env.NODE_ENV === 'development' && currentQuality && (
        <Box
          sx={{
            position: 'absolute',
            top: 4,
            right: 4,
            backgroundColor: 'rgba(0, 0, 0, 0.7)',
            color: 'white',
            padding: '2px 6px',
            borderRadius: 1,
            fontSize: '0.6rem',
            fontWeight: 'bold',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1px',
          }}
        >
          <div>{currentQuality.toUpperCase()}</div>
          {thumbnailSource && (
            <div style={{
              fontSize: '0.5rem',
              opacity: 0.8,
              backgroundColor: thumbnailSource === 'exif' ? '#4caf50' : '#ff9800',
              padding: '1px 3px',
              borderRadius: 1,
            }}>
              {thumbnailSource === 'exif' ? 'EXIF' : 'GEN'}
            </div>
          )}
        </Box>
      )}

      {/* Loading overlay for quality transitions */}
      {isTransitioning && (
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: 'rgba(255, 255, 255, 0.1)',
            borderRadius: 8,
            animation: 'pulse 1s ease-in-out infinite',
          }}
        />
      )}
    </Box>
  );
});

ProgressiveImage.displayName = 'ProgressiveImage';

export default ProgressiveImage;