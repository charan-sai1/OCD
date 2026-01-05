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
  onLoad?: (quality: ImageQuality) => void;
  onError?: (error: string) => void;
  priority?: LoadingPriority;
  enableTransitions?: boolean;
  transitionDuration?: number;
}

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

  const imageStates = useRef<ImageState>({
    [ImageQuality.THUMBNAIL]: null,
    [ImageQuality.PREVIEW]: null,
    [ImageQuality.FULL]: null,
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const transitionTimeoutRef = useRef<NodeJS.Timeout>();

  // Load progressive image
  useEffect(() => {
    if (!imagePath) return;

    setIsLoading(true);
    setError(null);

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
        // Update image state for this quality
        imageStates.current[quality] = data;

        // Determine if we should display this quality
        const shouldDisplay = shouldDisplayQuality(quality, currentQuality);

        if (shouldDisplay) {
          transitionToQuality(quality, data);
        }
      },
      onComplete: (result) => {
        setIsLoading(false);
        if (result.error) {
          setError(result.error);
          onError?.(result.error);
        }
      },
      onError: (error) => {
        setIsLoading(false);
        setError(error);
        onError?.(error);
      }
    });

    // Cleanup function
    return () => {
      if (transitionTimeoutRef.current) {
        clearTimeout(transitionTimeoutRef.current);
      }
    };
  }, [imagePath, priority]);

  // Determine if a quality level should be displayed
  const shouldDisplayQuality = useCallback((newQuality: ImageQuality, currentQuality: ImageQuality | null): boolean => {
    if (!currentQuality) return true; // No current quality, display first available

    // Quality hierarchy: thumbnail -> preview -> full
    const qualityOrder = {
      [ImageQuality.THUMBNAIL]: 1,
      [ImageQuality.PREVIEW]: 2,
      [ImageQuality.FULL]: 3,
    };

    return qualityOrder[newQuality] > qualityOrder[currentQuality];
  }, []);

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
          backgroundColor: '#1a1a1a',
          borderRadius: 8,
          color: '#f44336',
          fontSize: '0.75rem',
          textAlign: 'center',
          padding: 8,
          ...style
        }}
        onClick={handleClick}
      >
        Failed to load image
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
          onError={(e) => {
            console.error(`Progressive image error for ${imagePath}:`, e);
            // Fallback to original loading method
            const img = e.currentTarget as HTMLImageElement;
            img.src = getImageUrl(imagePath);
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
            fontSize: '0.7rem',
            fontWeight: 'bold',
          }}
        >
          {currentQuality.toUpperCase()}
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