import { useState, useCallback, useRef } from 'react';

export interface ZoomHook {
  zoomLevel: number;
  panPosition: { x: number; y: number };
  zoomIn: () => void;
  zoomOut: () => void;
  zoomToFit: (imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number) => void;
  resetZoom: () => void;
  handleWheel: (event: WheelEvent) => void;
  handleDoubleClick: (event: React.MouseEvent) => void;
  handlePan: (event: React.MouseEvent | React.TouchEvent) => void;
  isZoomed: boolean;
}

const useZoom = (minZoom = 0.5, maxZoom = 8): ZoomHook => {
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panPosition, setPanPosition] = useState({ x: 0, y: 0 });
  const isPanningRef = useRef(false);
  const lastPanPointRef = useRef({ x: 0, y: 0 });

  const zoomIn = useCallback(() => {
    setZoomLevel(prev => Math.min(prev * 1.5, maxZoom));
  }, [maxZoom]);

  const zoomOut = useCallback(() => {
    setZoomLevel(prev => Math.max(prev / 1.5, minZoom));
  }, [minZoom]);

  const zoomToFit = useCallback((imageWidth: number, imageHeight: number, viewportWidth: number, viewportHeight: number) => {
    if (imageWidth > 0 && imageHeight > 0) {
      const scaleX = viewportWidth / imageWidth;
      const scaleY = viewportHeight / imageHeight;
      setZoomLevel(Math.min(scaleX, scaleY, maxZoom));
      setPanPosition({ x: 0, y: 0 });
    }
  }, [maxZoom]);

  const resetZoom = useCallback(() => {
    setZoomLevel(1);
    setPanPosition({ x: 0, y: 0 });
  }, []);

  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const { deltaY, clientX, clientY } = event;

    setZoomLevel(prevZoom => {
      // Use smaller increments for smoother zoom (0.1 = 10% per wheel tick)
      const zoomIncrement = 0.1;
      const newZoom = deltaY < 0 ? prevZoom * (1 + zoomIncrement) : prevZoom / (1 + zoomIncrement);
      const clampedZoom = Math.max(minZoom, Math.min(newZoom, maxZoom));

      if (clampedZoom === prevZoom) {
        return prevZoom;
      }
      
      const zoomFactor = clampedZoom / prevZoom;

       setPanPosition(prevPan => {
         let newX = clientX - (clientX - prevPan.x) * zoomFactor;
         let newY = clientY - (clientY - prevPan.y) * zoomFactor;

         // Apply bounds checking for wheel zoom panning
        const scaledImageWidth = window.innerWidth * clampedZoom;
        const scaledImageHeight = window.innerHeight * clampedZoom;
        const maxPanX = Math.max(0, (scaledImageWidth - window.innerWidth) / 2);
        const maxPanY = Math.max(0, (scaledImageHeight - window.innerHeight) / 2);

         newX = Math.max(-maxPanX, Math.min(maxPanX, newX));
         newY = Math.max(-maxPanY, Math.min(maxPanY, newY));

         return { x: newX, y: newY };
       });

      return clampedZoom;
    });
  }, [minZoom, maxZoom]);

  const handleDoubleClick = useCallback((event: React.MouseEvent) => {
    event.preventDefault();
    if (zoomLevel > 1) {
      resetZoom();
    } else {
      setZoomLevel(3);
      // Reset pan position when zooming in
      setPanPosition({ x: 0, y: 0 });
    }
  }, [zoomLevel, resetZoom]);

  const handlePan = useCallback((event: React.MouseEvent | React.TouchEvent) => {
    if (zoomLevel <= 1) return;

    const isTouchEvent = 'touches' in event;
    const currentPoint = isTouchEvent ? event.touches[0] : event;

    switch (event.type) {
      case 'mousedown':
      case 'touchstart':
        isPanningRef.current = true;
        lastPanPointRef.current = { x: currentPoint.clientX, y: currentPoint.clientY };
        break;
      case 'mousemove':
      case 'touchmove':
        if (isPanningRef.current) {
          const deltaX = currentPoint.clientX - lastPanPointRef.current.x;
          const deltaY = currentPoint.clientY - lastPanPointRef.current.y;

          setPanPosition(prev => {
            // For zoomed images, allow panning within the scaled image bounds
            // The bounds ensure you can't pan beyond the edges of the zoomed image
            const scaledImageWidth = window.innerWidth * zoomLevel;
            const scaledImageHeight = window.innerHeight * zoomLevel;

            const maxPanX = Math.max(0, (scaledImageWidth - window.innerWidth) / 2);
            const maxPanY = Math.max(0, (scaledImageHeight - window.innerHeight) / 2);

            const newX = Math.max(-maxPanX, Math.min(maxPanX, prev.x + deltaX));
            const newY = Math.max(-maxPanY, Math.min(maxPanY, prev.y + deltaY));

            return { x: newX, y: newY };
          });

          lastPanPointRef.current = { x: currentPoint.clientX, y: currentPoint.clientY };
        }
        break;
      case 'mouseup':
      case 'mouseleave':
      case 'touchend':
        isPanningRef.current = false;
        break;
    }
  }, [zoomLevel]);

  return {
    zoomLevel,
    panPosition,
    zoomIn,
    zoomOut,
    zoomToFit,
    resetZoom,
    handleWheel,
    handleDoubleClick,
    handlePan,
    isZoomed: zoomLevel > 1,
  };
};

export default useZoom;
