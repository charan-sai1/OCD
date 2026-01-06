import React, { useState, useEffect, useCallback, useRef, useMemo, Suspense } from 'react';
import {
  Modal,
  Box,
  Fade,
  Backdrop
} from '@mui/material';
import { errorHandler } from '../utils/errorHandler';
import useTouchGestures from '../hooks/useTouchGestures';

import ImageViewerCore from './ImageViewerCore';
import ImageViewerControls from './ImageViewerControls';

const PreviewStrip = React.lazy(() => import('./ImageViewerPreviewStrip').catch(() => ({ default: () => null })));

interface ImageViewerModalProps {
  open: boolean;
  onClose: () => void;
  images: string[];
  currentImageIndex: number;
  onImageChange?: (index: number) => void;
}

interface TransitionState {
  isTransitioning: boolean;
  direction: 'left' | 'right' | null;
  progress: number; // 0-1
  startIndex: number;
  targetIndex: number;
}

interface CachedImage {
  url: string;
  loadedAt: number;
  size: number;
}

const ImageViewerModal: React.FC<ImageViewerModalProps> = ({
  open,
  onClose,
  images,
  currentImageIndex,
  onImageChange
}) => {
  // Core state
  const [currentIndex, setCurrentIndex] = useState(currentImageIndex);
   const [zoomLevel, setZoomLevel] = useState(1);
  const [previewUrls, setPreviewUrls] = useState<Record<number, string>>({});
  const [isImmersiveMode, setIsImmersiveMode] = useState(false);
  const [isSlideshowActive, setIsSlideshowActive] = useState(false);
  const slideshowInterval = 3000;

  const [previousFocusElement, setPreviousFocusElement] = useState<HTMLElement | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);

  const [transitionState, setTransitionState] = useState<TransitionState>({
    isTransitioning: false,
    direction: null,
    progress: 0,
    startIndex: currentImageIndex,
    targetIndex: currentImageIndex
  });

  const [imageCache, setImageCache] = useState<Record<number, CachedImage>>({});
  const [loadingStates, setLoadingStates] = useState<Record<number, boolean>>({});
  const previewStripRef = useRef<HTMLDivElement>(null);
  const preloadedIndices = useRef<Set<number>>(new Set());

  const TRANSITION_DURATION = 300;



  const loadImage = useCallback(async (index: number) => {
    if (!images[index] || imageCache[index] || loadingStates[index]) return;

    setLoadingStates(prev => ({ ...prev, [index]: true }));

    try {
      const imagePath = images[index];
      console.log(`[ImageViewerModal] Loading image at index ${index}: ${imagePath}`);

      const { getDirectImageUrl } = await import('../utils/imageUrlUtils');
      const imageUrl = await getDirectImageUrl(imagePath);

      console.log(`[ImageViewerModal] Got image URL: ${imageUrl}`);

      setImageCache(prev => ({
        ...prev,
        [index]: {
          url: imageUrl,
          loadedAt: Date.now(),
          size: 0
        }
      }));

      console.log(`[ImageViewerModal] Successfully cached image ${index}`);
    } catch (error) {
      console.error(`[ImageViewerModal] Failed to load image ${index}:`, error);
      errorHandler.handleImageLoadError(images[index], error, {
        component: 'ImageViewerModal',
        width: 1920,
        height: 1080
      });
    } finally {
      setLoadingStates(prev => ({ ...prev, [index]: false }));
    }
  }, [images, imageCache, loadingStates]);

  const preloadAdjacentImages = useCallback(() => {
    if (!open || images.length === 0 || transitionState.isTransitioning) return;

    const indicesToLoad = [currentIndex];
    if (currentIndex + 1 < images.length) indicesToLoad.push(currentIndex + 1);
    if (currentIndex - 1 >= 0) indicesToLoad.push(currentIndex - 1);

    indicesToLoad.forEach(index => {
      if (!imageCache[index] && !loadingStates[index] && !preloadedIndices.current.has(index)) {
        preloadedIndices.current.add(index);
        setTimeout(() => loadImage(index), 0);
      }
    });
  }, [open, images, currentIndex, imageCache, loadImage, transitionState.isTransitioning, loadingStates]);

  // Lightweight CSS-only transition system (Apple-style)
  const startTransition = useCallback((direction: 'left' | 'right') => {
    if (transitionState.isTransitioning) return;

    const newIndex = direction === 'left'
      ? (currentIndex < images.length - 1 ? currentIndex + 1 : 0)
      : (currentIndex > 0 ? currentIndex - 1 : images.length - 1);

    if (newIndex === currentIndex) return;

    // Set transition state for CSS animation
    setTransitionState({
      isTransitioning: true,
      direction,
      progress: 0,
      startIndex: currentIndex,
      targetIndex: newIndex
    });

    // Use CSS transition instead of JavaScript animation for better performance
    setTimeout(() => {
      setTransitionState(prev => ({ ...prev, progress: 1 }));
    }, 16); // Next frame

    // Complete transition after CSS animation duration
       setTimeout(() => {
         onImageChange?.(newIndex);
         setTransitionState({
           isTransitioning: false,
           direction: null,
           progress: 0,
           startIndex: newIndex,
           targetIndex: newIndex
         });
         // Reset zoom for new image
         setZoomLevel(1);
       }, TRANSITION_DURATION);
  }, [currentIndex, images.length, transitionState.isTransitioning, onImageChange]);

  // Update current index when prop changes
  useEffect(() => {
    setCurrentIndex(currentImageIndex);
    setTransitionState(prev => ({
      ...prev,
      startIndex: currentImageIndex,
      targetIndex: currentImageIndex
    }));
  }, [currentImageIndex]);

  // Load current image immediately when modal opens or index changes
  useEffect(() => {
    if (open && currentIndex >= 0 && currentIndex < images.length) {
      console.log(`[ImageViewerModal] Modal open, loading image at index ${currentIndex}`);
      loadImage(currentIndex);
    }
  }, [open, currentIndex, images.length]);

  // Viewport meta tag management for fullscreen mode
  useEffect(() => {
    if (open) {
      // Store original viewport meta tag
      const originalViewport = document.querySelector('meta[name="viewport"]');
      const originalContent = originalViewport?.getAttribute('content') || '';

      // Set fullscreen viewport to prevent unwanted zooming
      const fullscreenViewport = document.createElement('meta');
      fullscreenViewport.name = 'viewport';
      fullscreenViewport.content = 'width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover';
      document.head.appendChild(fullscreenViewport);

      return () => {
        // Restore original viewport
        fullscreenViewport.remove();
        if (originalViewport) {
          originalViewport.setAttribute('content', originalContent);
        }
      };
    }
  }, [open]);

  // Focus management
  useEffect(() => {
    if (open) {
      // Store the currently focused element
      setPreviousFocusElement(document.activeElement as HTMLElement);

      // Focus the main image area after a short delay to ensure modal is rendered
      const timer = setTimeout(() => {
        if (modalRef.current) {
          const focusableElement = modalRef.current.querySelector('[role="button"], button:not([disabled])') as HTMLElement;
          if (focusableElement) {
            focusableElement.focus();
          }
        }
      }, 100);

      return () => clearTimeout(timer);
    } else {
      // Restore focus when closing
      if (previousFocusElement && typeof previousFocusElement.focus === 'function') {
        previousFocusElement.focus();
      }
    }
  }, [open, previousFocusElement]);

  // Focus trap
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Tab') return;

      if (!modalRef.current) return;

      const focusableElements = modalRef.current.querySelectorAll(
        'button:not([disabled]), [href], input, select, textarea, [tabindex]:not([tabindex="-1"]), [role="button"]:not([aria-disabled="true"])'
      );

      const firstElement = focusableElements[0] as HTMLElement;
      const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

      if (e.shiftKey) {
        // Shift + Tab
        if (document.activeElement === firstElement) {
          e.preventDefault();
          lastElement.focus();
        }
      } else {
        // Tab
        if (document.activeElement === lastElement) {
          e.preventDefault();
          firstElement.focus();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open]);

  // Preload adjacent images after current image loads
  useEffect(() => {
    if (open && !loadingStates[currentIndex] && imageCache[currentIndex]) {
      preloadAdjacentImages();
    }
  }, [open, currentIndex, loadingStates, imageCache, preloadAdjacentImages]);

  useEffect(() => {
    if (!open || images.length === 0) return;

    let isCancelled = false;

    const loadPreview = async (index: number) => {
      if (isCancelled || previewUrls[index]) return;

      try {
        const { getDirectImageUrl } = await import('../utils/imageUrlUtils');
        const previewUrl = await getDirectImageUrl(images[index]);

        if (previewUrl && !isCancelled) {
          setPreviewUrls(prev => ({ ...prev, [index]: previewUrl }));
        }
      } catch (error) {
        console.warn(`Failed to load preview for image ${index}:`, error);
      }
    };

    const indicesToLoad = [currentIndex];
    if (currentIndex + 1 < images.length) indicesToLoad.push(currentIndex + 1);
    if (currentIndex - 1 >= 0) indicesToLoad.push(currentIndex - 1);

    indicesToLoad.forEach(index => {
      setTimeout(() => loadPreview(index), 0);
    });

    return () => {
      isCancelled = true;
    };
  }, [images, open, currentIndex]);

  // Scroll preview strip to center current image - optimized to prevent layout thrashing
  useEffect(() => {
    if (!previewStripRef.current || images.length <= 1) return;

    // Debounce the scroll to prevent excessive DOM measurements during transitions
    const timeoutId = setTimeout(() => {
      const container = previewStripRef.current;
      if (!container) return;

      // Use cached measurements when possible
      const thumbnailWidth = 64;
      const containerWidth = container.clientWidth || container.offsetWidth;
      const scrollLeft = (currentIndex * thumbnailWidth) - (containerWidth / 2) + (thumbnailWidth / 2);

      container.scrollTo({
        left: Math.max(0, scrollLeft),
        behavior: 'smooth'
      });
    }, transitionState.isTransitioning ? 50 : 0); // Delay during transitions

    return () => clearTimeout(timeoutId);
  }, [currentIndex, images.length, transitionState.isTransitioning]);

  // Touch gesture integration with pinch support
  useTouchGestures({
    onSwipeLeft: () => startTransition('left'),
    onSwipeRight: () => startTransition('right'),
    onPinch: (scale) => {
      // Convert pinch scale to zoom level (relative to current zoom)
      const zoomFactor = scale > 1 ? 1.1 : 0.9;
      const newZoom = Math.min(Math.max(zoomLevel * zoomFactor, 0.5), 5);
      setZoomLevel(newZoom);
    },
    swipeThreshold: 80,
    pinchThreshold: 0.05,
    preventBrowserGestures: true
  });

  const handlePrevious = useCallback(() => startTransition('right'), [startTransition]);
  const handleNext = useCallback(() => startTransition('left'), [startTransition]);

  const handleZoomIn = useCallback(() => {
    setZoomLevel(prev => {
      const newZoom = Math.min(prev * 1.2, 5); // Max zoom 5x
      // Provide haptic feedback-like visual feedback
      if (newZoom !== prev) {
        // Could add visual feedback here if needed
      }
      return newZoom;
    });
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoomLevel(prev => {
      const newZoom = Math.max(prev / 1.2, 0.5); // Min zoom 0.5x
      // Provide haptic feedback-like visual feedback
      if (newZoom !== prev) {
        // Could add visual feedback here if needed
      }
      return newZoom;
    });
  }, []);



   const handleShare = useCallback(async () => {
    const currentImage = images[currentIndex];
    const cachedImage = imageCache[currentIndex];
    if (!cachedImage) return;

    const imageName = currentImage ? currentImage.split('/').pop() || 'Unknown' : 'No image';

    try {
      if (navigator.share && cachedImage.url.startsWith('blob:')) {
        const file = await fetch(cachedImage.url).then(r => r.blob());
        const shareData = {
          title: imageName,
          text: `Check out this image: ${imageName}`,
          files: [new File([file], imageName, { type: 'image/jpeg' })]
        };
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(cachedImage.url);
        console.log('Image URL copied to clipboard');
      }
    } catch (error) {
      console.error('Sharing failed:', error);
    }
  }, [images, currentIndex, imageCache]);

  const handleDownload = useCallback(async () => {
    const currentImage = images[currentIndex];
    const cachedImage = imageCache[currentIndex];
    if (!cachedImage) return;

    const imageName = currentImage ? currentImage.split('/').pop() || 'Unknown' : 'No image';

    try {
      const link = document.createElement('a');
      link.href = cachedImage.url;
      link.download = imageName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
    } catch (error) {
      console.error('Download failed:', error);
    }
  }, [images, currentIndex, imageCache]);

  const handleToggleSlideshow = useCallback(() => {
    setIsSlideshowActive(prev => !prev);
  }, []);

  // Slideshow logic with battery awareness
  useEffect(() => {
    if (!isSlideshowActive || images.length <= 1) return;

    // Check battery status and adjust interval
    const getBatteryAwareInterval = async () => {
      try {
        if ('getBattery' in navigator) {
          const battery = await (navigator as any).getBattery();
          if (battery.level < 0.2 || battery.charging === false) {
            // Extend interval on low battery
            return slideshowInterval * 2;
          }
        }
      } catch (error) {
        // Battery API not available
      }
      return slideshowInterval;
    };

    const runSlideshow = async () => {
      const interval = await getBatteryAwareInterval();
      const timer = setTimeout(() => {
        const nextIndex = (currentIndex + 1) % images.length;
        onImageChange?.(nextIndex);
      }, interval);

      return timer;
    };

    const timerPromise = runSlideshow();

    return () => {
      timerPromise.then(timer => clearTimeout(timer));
    };
  }, [isSlideshowActive, currentIndex, images.length, onImageChange, slideshowInterval]);

  // Pause slideshow during transitions
  useEffect(() => {
    if (transitionState.isTransitioning && isSlideshowActive) {
      // Could add a brief pause here if needed
    }
  }, [transitionState.isTransitioning, isSlideshowActive]);



   const handleImageSelect = useCallback(async (index: number) => {
      if (index === currentIndex || transitionState.isTransitioning) return;

      if (!imageCache[index] && !loadingStates[index]) {
        loadImage(index);
      }

      const direction = index > currentIndex ? 'left' : 'right';

      setTransitionState({
        isTransitioning: true,
        direction,
        progress: 0,
        startIndex: currentIndex,
        targetIndex: index
      });

      setTimeout(() => {
        setTransitionState(prev => ({ ...prev, progress: 1 }));
      }, 16);

      setTimeout(() => {
        onImageChange?.(index);
        setTransitionState({
          isTransitioning: false,
          direction: null,
          progress: 0,
          startIndex: index,
          targetIndex: index
        });
         setZoomLevel(1);
      }, TRANSITION_DURATION);
    }, [currentIndex, transitionState.isTransitioning, onImageChange, imageCache, loadingStates, loadImage]);

  const handleKeyPress = useCallback((event: KeyboardEvent) => {
    if (!open || transitionState.isTransitioning) return;

    switch (event.key) {
      case 'ArrowLeft':
        handlePrevious();
        break;
      case 'ArrowRight':
        handleNext();
        break;
      case 'Escape':
        onClose();
        break;
      case '+':
      case '=':
        handleZoomIn();
        break;
      case '-':
        handleZoomOut();
        break;
      case '0':
        setZoomLevel(1);
        break;
    }
  }, [open, transitionState.isTransitioning, handlePrevious, handleNext, onClose, handleZoomIn, handleZoomOut]);

  const handleWheel = useCallback((event: WheelEvent) => {
    if (!open) return;

    event.preventDefault();
    if (event.deltaY < 0) {
      handleZoomIn();
    } else {
      handleZoomOut();
    }
  }, [open, handleZoomIn, handleZoomOut]);

  // Add keyboard and wheel event listeners with proper cleanup
  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyPress);
      document.addEventListener('wheel', handleWheel, { passive: false });

      return () => {
        document.removeEventListener('keydown', handleKeyPress);
        document.removeEventListener('wheel', handleWheel);
      };
    }

    // Cleanup when modal closes
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('wheel', handleWheel);
    };
  }, [open, handleKeyPress, handleWheel]);

  useEffect(() => {
    return () => {
      Object.values(imageCache).forEach(image => {
        if (image.url.startsWith('blob:')) {
          URL.revokeObjectURL(image.url);
        }
      });
    };
  }, [imageCache]);

  const currentImage = images[currentIndex];
  const imageName = currentImage ? currentImage.split('/').pop() || 'Unknown' : 'No image';

  // Get current display image (accounts for transitions)
  const displayImage = useMemo(() => {
    return imageCache[currentIndex];
  }, [currentIndex, imageCache]);

  const isCurrentLoading = loadingStates[currentIndex] && !imageCache[currentIndex];

  // Extract image metadata
  const [imageMetadata, setImageMetadata] = useState<{[key: number]: any}>({});

  useEffect(() => {
    if (!displayImage || !displayImage.url) return;

    const extractMetadata = async () => {
      try {
        const img = new Image();
        img.onload = () => {
          const format = imageName.split('.').pop()?.toLowerCase() || 'unknown';
          setImageMetadata(prev => ({
            ...prev,
            [currentIndex]: {
              dimensions: { width: img.naturalWidth, height: img.naturalHeight },
              format,
              // Note: File size and last modified would need server-side support
            }
          }));
        };
        img.src = displayImage.url;
      } catch (error) {
        console.warn('Failed to extract image metadata:', error);
      }
    };

    if (!imageMetadata[currentIndex]) {
      extractMetadata();
    }
  }, [displayImage, currentIndex, imageName, imageMetadata]);

  return (
    <Modal
      open={open}
      onClose={onClose}
      closeAfterTransition
      BackdropComponent={Backdrop}
      BackdropProps={{
        timeout: 500,
        sx: { backgroundColor: 'rgba(0, 0, 0, 0.9)' }
      }}
    >
      <Fade in={open}>
        <Box
          ref={modalRef}
          data-modal-image-viewer
          role="dialog"
          aria-modal="true"
          aria-labelledby="image-viewer-title"
          aria-describedby="image-viewer-description"
          sx={{
            position: 'absolute',
            top: '50%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
            overflow: 'hidden'
          }}
        >
          {/* Core image viewer functionality */}
          <ImageViewerCore
             currentIndex={currentIndex}
             isImmersiveMode={isImmersiveMode}
             onToggleImmersiveMode={() => setIsImmersiveMode(prev => !prev)}
             zoomLevel={zoomLevel}
             transitionState={transitionState}
             displayImage={displayImage}
             imageName={imageName}
             isCurrentLoading={isCurrentLoading}
           />

          {/* Zoom and rotation controls */}
          <ImageViewerControls
            zoomLevel={zoomLevel}
            onZoomIn={handleZoomIn}
            onZoomOut={handleZoomOut}
            onResetZoom={() => setZoomLevel(1)}
            onShare={handleShare}
            onDownload={handleDownload}
            onToggleSlideshow={handleToggleSlideshow}
            onClose={onClose}
            isSlideshowActive={isSlideshowActive}
            isTransitioning={transitionState.isTransitioning}
            isImmersiveMode={isImmersiveMode}
            displayImage={displayImage}
          />

          {/* Lazy-loaded preview strip */}
          <Suspense fallback={null}>
            <PreviewStrip
              images={images}
              currentIndex={currentIndex}
              previewUrls={previewUrls}
              loadingStates={loadingStates}
              onImageSelect={handleImageSelect}
              isImmersiveMode={isImmersiveMode}
              isTransitioning={transitionState.isTransitioning}
            />
          </Suspense>

          {/* Screen reader announcements for image changes */}
          <Box
            role="status"
            aria-live="polite"
            aria-atomic="true"
            sx={{
              position: 'absolute',
              left: '-10000px',
              top: 'auto',
              width: '1px',
              height: '1px',
              overflow: 'hidden'
            }}
          >
            {transitionState.isTransitioning ? `Loading image ${transitionState.targetIndex + 1} of ${images.length}` : `Viewing image ${currentIndex + 1} of ${images.length}: ${imageName}`}
          </Box>
        </Box>
      </Fade>
    </Modal>
  );
};

export default ImageViewerModal;