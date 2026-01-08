import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import {
  Modal,
  Box,
  Fade,
  Backdrop
} from '@mui/material';
import { errorHandler } from '../utils/errorHandler';
import useTouchGestures from '../hooks/useTouchGestures';
import useZoom from '../hooks/useZoom';
import ImageViewerControls from './ImageViewerControls';
import ImageViewerInfo from './ImageViewerInfo';
import ImageViewerCore from './ImageViewerCore';
import PreviewStrip from './ImageViewerPreviewStrip';



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
   const {
     zoomLevel,
     panPosition,
     zoomIn,
     zoomOut,
     zoomToFit,
     resetZoom,
     handleWheel,
     handleDoubleClick,
     handlePan,
     isZoomed
   } = useZoom();

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

      const { getDirectImageUrl } = await import('../utils/imageUrlUtils');
      const imageUrl = await getDirectImageUrl(imagePath);

      setImageCache(prev => ({
        ...prev,
        [index]: {
          url: imageUrl,
          loadedAt: Date.now(),
          size: 0
        }
      }));
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
        resetZoom();
    }, TRANSITION_DURATION);
  }, [currentIndex, images.length, transitionState.isTransitioning, onImageChange, resetZoom]);

  // Update current index when prop changes
  useEffect(() => {
    setCurrentIndex(currentImageIndex);
    setTransitionState(prev => ({
      ...prev,
      startIndex: currentImageIndex,
      targetIndex: currentImageIndex
    }));
    // Reset zoom and rotation when changing images
            resetZoom();
  }, [currentImageIndex, resetZoom]);

  // Load current image immediately when modal opens or index changes
  useEffect(() => {
    if (open && currentIndex >= 0 && currentIndex < images.length) {
      loadImage(currentIndex);
    }
  }, [open, currentIndex, images.length, loadImage]);

  // Keyboard navigation for thumbnail strip
  useEffect(() => {
    if (!open) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle when not focused on input elements
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          if (currentIndex > 0) {
            onImageChange?.(currentIndex - 1);
          }
          break;
        case 'ArrowRight':
          e.preventDefault();
          if (currentIndex < images.length - 1) {
            onImageChange?.(currentIndex + 1);
          }
          break;
        case 'Home':
          e.preventDefault();
          onImageChange?.(0);
          break;
        case 'End':
          e.preventDefault();
          onImageChange?.(images.length - 1);
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, currentIndex, images.length, onImageChange]);

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
        const imageUrl = await getDirectImageUrl(images[index]);

        if (imageUrl && !isCancelled) {
          setPreviewUrls(prev => ({ ...prev, [index]: imageUrl }));
        }
      } catch (error) {
        console.warn(`Failed to load preview for image ${index}:`, error);
      }
    };

    // Smart loading strategy with priority-based loading
    const loadThumbnailsByPriority = async () => {
      if (isCancelled) return;



      const getVisibleIndices = () => {
        // For now, assume first 10 thumbnails are visible
        // This will be improved when virtualization is added
        return Array.from({ length: Math.min(10, images.length) }, (_, i) => i);
      };

      const getAdjacentIndices = () => {
        const adjacent = [];
        for (let i = Math.max(0, currentIndex - 3); i <= Math.min(images.length - 1, currentIndex + 3); i++) {
          if (i !== currentIndex) adjacent.push(i); // Don't duplicate current
        }
        return adjacent;
      };

      const getRecentIndices = () => {
        // For now, return empty array - can be enhanced later
        return [];
      };

      const getRemainingIndices = () => {
        const visible = getVisibleIndices();
        const adjacent = getAdjacentIndices();
        const recent = getRecentIndices();
        const usedIndices = new Set([...visible, ...adjacent, ...recent, currentIndex]);

        return Array.from({ length: images.length }, (_, i) => i)
          .filter(i => !usedIndices.has(i));
      };

      // Load each priority group with delays
      const priorityGroups = [
        { indices: getVisibleIndices(), delay: 0 },
        { indices: getAdjacentIndices(), delay: 200 },
        { indices: getRecentIndices(), delay: 500 },
        { indices: getRemainingIndices(), delay: 1000 }
      ];

      for (const group of priorityGroups) {
        if (isCancelled) break;

        setTimeout(() => {
          if (!isCancelled) {
            group.indices.forEach(index => {
              setTimeout(() => loadPreview(index), 0);
            });
          }
        }, group.delay);
      }
    };

    loadThumbnailsByPriority();

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

  // Touch gesture integration
  useTouchGestures({
    onSwipeLeft: () => startTransition('left'),
    onSwipeRight: () => startTransition('right'),
    onDoubleTap: () => handleDoubleClick({} as React.MouseEvent),
    swipeThreshold: 80,
    preventBrowserGestures: true
  });





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

  const handleImageSelect = useCallback((index: number) => {
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
      resetZoom();
    }, TRANSITION_DURATION);
  }, [currentIndex, transitionState.isTransitioning, onImageChange, imageCache, loadingStates, loadImage, resetZoom]);

  // Pause slideshow during transitions
  useEffect(() => {
    if (transitionState.isTransitioning && isSlideshowActive) {
      // Could add a brief pause here if needed
    }
  }, [transitionState.isTransitioning, isSlideshowActive]);

  const handlePrevious = useCallback(() => {
    console.log('⬅️ Previous navigation triggered');
    startTransition('right');
  }, [startTransition]);
  const handleNext = useCallback(() => {
    console.log('➡️ Next navigation triggered');
    startTransition('left');
  }, [startTransition]);

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
        zoomIn();
        break;
      case '-':
        zoomOut();
        break;
      case '0':
        resetZoom();
        break;

      case 'f':
      case 'F':
        handleZoomToFit();
        break;
    }
   }, [open, transitionState.isTransitioning, handlePrevious, handleNext, onClose, zoomIn, zoomOut, resetZoom]);

  const localHandleWheel = useCallback((event: WheelEvent) => {
    if (!open) return;
    handleWheel(event);
  }, [open, handleWheel]);

  // Add keyboard and wheel event listeners with proper cleanup
  useEffect(() => {
    if (open) {
      document.addEventListener('keydown', handleKeyPress);
      document.addEventListener('wheel', localHandleWheel, { passive: false });

      return () => {
        document.removeEventListener('keydown', handleKeyPress);
        document.removeEventListener('wheel', localHandleWheel);
      };
    }

    // Cleanup when modal closes
    return () => {
      document.removeEventListener('keydown', handleKeyPress);
      document.removeEventListener('wheel', localHandleWheel);
    };
  }, [open, handleKeyPress, localHandleWheel]);

  // Cleanup blob URLs when image cache changes (not just on unmount)
  const prevImageCacheRef = React.useRef<Record<number, CachedImage>>({});
  useEffect(() => {
    // Revoke blob URLs for images that are no longer in cache
    const prevUrls = Object.values(prevImageCacheRef.current)
      .map(img => img.url)
      .filter(url => url.startsWith('blob:'));

    const currentUrls = new Set(Object.values(imageCache).map(img => img.url));

    prevUrls.forEach(url => {
      if (!currentUrls.has(url)) {
        URL.revokeObjectURL(url);
      }
    });

    prevImageCacheRef.current = imageCache;
  }, [imageCache]);

  useEffect(() => {
    return () => {
      // Final cleanup on unmount
      Object.values(imageCache).forEach(image => {
        if (image.url.startsWith('blob:')) {
          URL.revokeObjectURL(image.url);
        }
      });
    };
  }, []); // Empty dependency array for unmount cleanup

  const currentImage = images[currentIndex];
  const imageName = currentImage ? currentImage.split('/').pop() || 'Unknown' : 'No image';

  // Get current display image (accounts for transitions)
  const displayImage = useMemo(() => {
    return imageCache[currentIndex];
  }, [currentIndex, imageCache]);

  const handleZoomToFit = useCallback(() => {
    if (!displayImage) {
      return;
    }

    const img = new Image();
    img.onload = () => {
      const viewportWidth = window.innerWidth;
      const viewportHeight = window.innerHeight;
      zoomToFit(img.naturalWidth, img.naturalHeight, viewportWidth, viewportHeight);
    };
    img.src = displayImage.url;
  }, [displayImage, zoomToFit]);



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
            position: 'fixed', // Changed from absolute to fixed
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            outline: 'none',
            overflow: 'visible' // Changed from hidden to visible
          }}
          >
            {/* Core image viewer functionality */}
            <ImageViewerCore
              currentIndex={currentIndex}
              isImmersiveMode={isImmersiveMode}
              onToggleImmersiveMode={() => setIsImmersiveMode((prev: boolean) => !prev)}
              zoomLevel={zoomLevel}
              panPosition={panPosition}
              isZoomed={isZoomed}
              handlePan={handlePan}
              handleDoubleClick={handleDoubleClick}
              transitionState={transitionState}
              displayImage={displayImage}
              imageName={imageName}
              isCurrentLoading={loadingStates[currentIndex]}
            />

            {/* Image details/info */}
            <ImageViewerInfo
              imageName={imageName}
              currentIndex={currentIndex}
              totalImages={images.length}
              metadata={imageMetadata[currentIndex]}
              isImmersiveMode={isImmersiveMode}
              isTransitioning={transitionState.isTransitioning}
              isZoomed={isZoomed}
            />

            {/* Navigation preview strip */}
            <PreviewStrip
              images={images}
              currentIndex={currentIndex}
              previewUrls={previewUrls}
              loadingStates={loadingStates}
              onImageSelect={handleImageSelect}
              isImmersiveMode={isImmersiveMode}
              isTransitioning={transitionState.isTransitioning}
            />

            {/* Full viewport overlay for controls */}
            <Box
              sx={{
                position: 'fixed',
                top: 0,
                left: 0,
                width: '100vw',
                height: '100vh',
                zIndex: 10000, // Higher than controls
                pointerEvents: 'none' // Allow clicks to pass through to controls
              }}
            >
              {/* Zoom and rotation controls */}
              <ImageViewerControls
             zoomLevel={zoomLevel}
             onZoomIn={zoomIn}
             onZoomOut={zoomOut}
             onResetZoom={resetZoom}
             onRotate={() => {}}
              onZoomToFit={handleZoomToFit}
              onShare={handleShare}
              onDownload={handleDownload}
              onToggleSlideshow={handleToggleSlideshow}
              onClose={onClose}
              isSlideshowActive={isSlideshowActive}
              isTransitioning={transitionState.isTransitioning}
              isImmersiveMode={isImmersiveMode}
              displayImage={displayImage}
               canZoomIn={zoomLevel < 8}
               canZoomOut={zoomLevel > 0.5}
              />
            </Box>
          </Box>
        </Fade>
     </Modal>
   );
};

export default ImageViewerModal;