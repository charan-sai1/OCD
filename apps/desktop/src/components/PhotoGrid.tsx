import React, { useState, memo, useCallback } from "react";
import Box from "@mui/material/Box";
import ImageList from "@mui/material/ImageList";
import ImageListItem from "@mui/material/ImageListItem";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import EnhancedVirtualizedImageGrid from "./EnhancedVirtualizedImageGrid";
import SkeletonImageGrid from "./SkeletonImageGrid";
import FastImage from "./FastImage";
import "../styles/animations.css";

interface PhotoGridProps {
  images: string[];
  directoryPaths: string[];
  imageSize: number;
  isLoadingImages?: boolean;
}

// Fast image component for ImageList
const FastImageGridItem = memo(({
  imagePath,
  index,
  hoveredIndex,
  setHoveredIndex
}: {
  imagePath: string;
  index: number;
  hoveredIndex: number | null;
  setHoveredIndex: (index: number | null) => void;
}) => {
  const isHovered = hoveredIndex === index;
  const imageName = imagePath.split("/").pop() || `Image ${index + 1}`;

  return (
    <ImageListItem
      className="hover-scale"
      sx={{
        borderRadius: 2,
        overflow: "hidden",
        position: "relative",
        cursor: "pointer",
      }}
      onMouseEnter={() => setHoveredIndex(index)}
      onMouseLeave={() => setHoveredIndex(null)}
    >
      <FastImage
        imagePath={imagePath}
        alt={imageName}
        priority="normal"
        width={300}
        height={300}
        style={{
          borderRadius: 12,
          width: "100%",
          height: "100%",
          objectFit: "cover",
          transform: isHovered ? "scale(1.05)" : "scale(1)",
        }}
      />
      <Box
        sx={{
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          background: "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%)",
          opacity: isHovered ? 1 : 0,
          borderRadius: "0 0 12px 12px",
          transform: isHovered ? "translateY(0)" : "translateY(4px)",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          padding: "8px 12px",
          color: "white",
        }}
      >
        <Typography
          variant="body2"
          sx={{
            fontSize: "0.875rem",
            fontWeight: 500,
            lineHeight: 1.2,
          }}
        >
          {imageName}
        </Typography>
      </Box>
    </ImageListItem>
  );
});

FastImageGridItem.displayName = "FastImageGridItem";

const PhotoGrid: React.FC<PhotoGridProps> = memo(({
  images,
  directoryPaths,
  imageSize,
  isLoadingImages = false,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const theme = useTheme();

  const handleMouseEnter = useCallback((index: number | null) => setHoveredIndex(index), []);

  const renderLoading = () => (
    <Box className="anim-fade-in">
      <SkeletonImageGrid imageSize={imageSize} imageCount={20} />
    </Box>
  );

  const renderEmpty = () => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        textAlign: "center",
      }}
    >
      <Typography variant="h6" sx={{ color: theme.palette.text.secondary, marginBottom: 1 }}>
        No photos to show
      </Typography>
      <Typography variant="body2" sx={{ color: theme.palette.text.disabled, marginBottom: 3 }}>
        Select folders to start viewing your photos
      </Typography>
    </Box>
  );

  const renderNoImages = () => (
    <Box
      sx={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "40vh",
        textAlign: "center",
      }}
    >
      <Typography variant="body1" sx={{ color: theme.palette.text.secondary }}>
        No images found in selected folders
      </Typography>
    </Box>
  );

  const renderImageList = () => (
    <ImageList
      variant="masonry"
      cols={imageSize}
      gap={8}
      sx={{
        "& .MuiImageList-root": {
          margin: 0,
        },
      }}
    >
      {images.map((imagePath, index) => (
        <FastImageGridItem
          key={`${imagePath}-${index}`}
          imagePath={imagePath}
          index={index}
          hoveredIndex={hoveredIndex}
          setHoveredIndex={handleMouseEnter}
        />
      ))}
    </ImageList>
  );

  const renderContent = () => {
    if (images.length === 0 && directoryPaths.length > 0 && isLoadingImages) {
      return renderLoading();
    }
    if (images.length === 0 && directoryPaths.length === 0) {
      return renderEmpty();
    }
    if (images.length === 0 && directoryPaths.length > 0) {
      return renderNoImages();
    }
      // Use enhanced virtual scrolling with lazy loading for all collections
      // This provides instant grid appearance with smooth image loading
      if (images.length > 20) {
        return (
          <EnhancedVirtualizedImageGrid
            images={images}
            imageSize={imageSize}
            pagesToPreload={2}
            enableSmoothScroll={false}
            onImageClick={(imagePath) => {
              console.log('Image clicked:', imagePath);
            }}
          />
        );
      }
    return (
      <Box className="anim-fade-in-up">
        {renderImageList()}
      </Box>
    );
  };

  return <Box>{renderContent()}</Box>;
});

PhotoGrid.displayName = 'PhotoGrid';

export default PhotoGrid;
