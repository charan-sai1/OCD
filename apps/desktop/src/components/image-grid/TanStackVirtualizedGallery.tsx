import React, { memo, useCallback, useEffect, useRef, useMemo, useState } from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import Box from "@mui/material/Box";
import CircularProgress from "@mui/material/CircularProgress";
import LazyImageContainer from "../ui/LazyImageContainer";
import { lenisScrollManager } from "../../utils/scroll/lenisScrollManager";

interface GalleryProps {
  images: string[];
  columnCount: number;
  gap?: number;
  onImageClick?: (imagePath: string, index: number) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  isLoading?: boolean;
}

const TanStackVirtualizedGallery: React.FC<GalleryProps> = memo(({
  images = [],
  columnCount = 4,
  gap = 8,
  onImageClick,
  onLoadMore,
  hasMore = false,
  isLoading = false,
}) => {
  const parentRef = useRef<HTMLDivElement>(null);
  const [isLenisActive, setIsLenisActive] = useState(false);

  const itemSize = useMemo(() => {
    if (!parentRef.current) return 300;
    const containerWidth = parentRef.current.offsetWidth - 16;
    return (containerWidth - (columnCount + 1) * gap) / columnCount;
  }, [columnCount, gap]);

  const rowCount = useMemo(() => Math.ceil(images.length / columnCount), [images.length, columnCount]);

  const virtualizer = useVirtualizer({
    count: rowCount,
    getScrollElement: () => parentRef.current,
    estimateSize: useCallback(() => itemSize + gap, [itemSize, gap]),
    overscan: 5,
    gap,
  });

  useEffect(() => {
    const checkLenis = () => setIsLenisActive(lenisScrollManager.isActive());
    checkLenis();
    
    const interval = setInterval(checkLenis, 1000);
    return () => clearInterval(interval);
  }, []);

  const handleScroll = useCallback(() => {
    if (!parentRef.current || isLenisActive) return;
    
    const { scrollTop, scrollHeight, clientHeight } = parentRef.current;
    
    if (onLoadMore && hasMore && scrollTop + clientHeight > scrollHeight - 1000) {
      onLoadMore();
    }
  }, [onLoadMore, hasMore, isLenisActive]);

  useEffect(() => {
    const element = parentRef.current;
    if (!element || isLenisActive) return;

    let ticking = false;
    const handleScrollEvent = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          handleScroll();
          ticking = false;
        });
        ticking = true;
      }
    };

    element.addEventListener("scroll", handleScrollEvent, { passive: true });
    return () => element.removeEventListener("scroll", handleScrollEvent);
  }, [handleScroll, isLenisActive]);

  const getItemsForRow = useCallback((rowIndex: number) => {
    const start = rowIndex * columnCount;
    return images.slice(start, start + columnCount);
  }, [images, columnCount]);

  const handleImageClick = useCallback((imagePath: string, index: number) => {
    onImageClick?.(imagePath, index);
  }, [onImageClick]);

  const virtualItems = virtualizer.getVirtualItems();

  return (
    <Box
      ref={parentRef}
      sx={{
        width: "100%",
        height: "100%",
        overflow: "auto",
        contain: "strict",
      }}
    >
      <Box
        sx={{
          width: "100%",
          height: `${virtualizer.getTotalSize()}px`,
          position: "relative",
        }}
      >
        {virtualItems.map((virtualRow) => {
          const rowItems = getItemsForRow(virtualRow.index);
          
          return (
            <Box
              key={virtualRow.key}
              data-index={virtualRow.index}
              ref={virtualizer.measureElement}
              style={{
                position: "absolute",
                top: 0,
                left: 0,
                width: "100%",
                height: `${virtualRow.size}px`,
                transform: `translateY(${virtualRow.start}px)`,
                display: "grid",
                gridTemplateColumns: `repeat(${columnCount}, 1fr)`,
                gap: `${gap}px`,
                padding: `0 ${gap}px`,
                boxSizing: "border-box",
              }}
            >
              {rowItems.map((imagePath, colIndex) => {
                const actualIndex = virtualRow.index * columnCount + colIndex;
                
                return (
                  <Box
                    key={`${imagePath}-${actualIndex}`}
                    sx={{
                      aspectRatio: "1",
                      width: "100%",
                      contain: "layout style paint",
                      contentVisibility: "auto",
                    }}
                  >
                    <LazyImageContainer
                      imagePath={imagePath}
                      width={itemSize}
                      height={itemSize}
                      aspectRatio={1}
                      onClick={() => handleImageClick(imagePath, actualIndex)}
                      priority={virtualRow.index <= 2 ? "high" : "normal"}
                      placeholderVariant="shimmer"
                    />
                  </Box>
                );
              })}
            </Box>
          );
        })}
      </Box>

      {isLoading && (
        <Box
          sx={{
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            py: 2,
            mt: 2,
          }}
        >
          <CircularProgress size={24} />
        </Box>
      )}
    </Box>
  );
});

TanStackVirtualizedGallery.displayName = "TanStackVirtualizedGallery";

export default TanStackVirtualizedGallery;
