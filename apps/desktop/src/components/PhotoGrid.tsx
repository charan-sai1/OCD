import React, { memo } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { useTheme } from "@mui/material/styles";
import ResponsivePhotoGrid from "./ResponsivePhotoGrid";
import "../styles/animations.css";

interface PhotoGridProps {
  images: string[];
  directoryPaths: string[];
  imageSize: number; // Kept for backward compatibility, not used in new responsive grid
  isLoadingImages?: boolean;
  onImageClick?: (imagePath: string) => void;
}

const PhotoGrid: React.FC<PhotoGridProps> = memo(({
  images,
  directoryPaths,
  imageSize,
  isLoadingImages = false,
  onImageClick,
}) => {
  const theme = useTheme();

  // Keep imageSize for backward compatibility (not used in responsive grid)
  void imageSize;

  const renderLoading = () => (
    <Box
      className="anim-fade-in"
      sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px'
      }}
    >
      <Typography variant="body1" sx={{ color: 'text.secondary' }}>
        Loading images...
      </Typography>
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
    // Use responsive virtualized grid for better performance and responsive layout
    return (
      <Box className="anim-fade-in-up" sx={{ height: '100%' }}>
        <ResponsivePhotoGrid
          images={images}
          onImageClick={onImageClick}
          thumbnailSize={64} // Fixed 64px as user requested
          gap={8}
        />
      </Box>
    );
  };

  return (
    <Box sx={{
      minHeight: '100%',
      width: '100%',
      overflow: 'visible'
    }}>
      {renderContent()}
    </Box>
  );
});

PhotoGrid.displayName = 'PhotoGrid';

export default PhotoGrid;
