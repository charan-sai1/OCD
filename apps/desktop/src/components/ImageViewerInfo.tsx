import React from 'react';
import { Box, Typography } from '@mui/material';

interface ImageMetadata {
  dimensions?: { width: number; height: number };
  fileSize?: number;
  format?: string;
  lastModified?: Date;
}

interface ImageViewerInfoProps {
  imageName: string;
  currentIndex: number;
  totalImages: number;
  metadata?: ImageMetadata;
  isImmersiveMode: boolean;
  isTransitioning: boolean;
}

const ImageViewerInfo: React.FC<ImageViewerInfoProps> = React.memo(({
  imageName,
  currentIndex,
  totalImages,
  metadata,
  isImmersiveMode,
  isTransitioning
}) => {
  if (isImmersiveMode) return null;

  return (
    <Box
      id="image-viewer-description"
      sx={{
        position: 'fixed',
        bottom: 200, // Above the preview strip
        left: '50%',
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        backdropFilter: 'blur(20px)',
        borderRadius: 3,
        px: 3,
        py: 1.5,
        zIndex: 1300,
        border: '1px solid rgba(255, 255, 255, 0.15)',
        boxShadow: '0 8px 32px rgba(0, 0, 0, 0.6)',
        transition: 'all 0.3s cubic-bezier(0.4, 0, 0.2, 1)',
        opacity: isTransitioning ? 0.7 : 1,
        transform: isTransitioning
          ? 'translateX(-50%) translateY(2px)'
          : 'translateX(-50%) translateY(0)'
      }}
    >
      <Typography
        id="image-viewer-title"
        variant="body2"
        sx={{
          color: 'white',
          textAlign: 'center',
          fontWeight: 500,
          letterSpacing: '0.025em'
        }}
      >
        {imageName}
      </Typography>
              <Typography
                variant="caption"
                sx={{
                  color: 'rgba(255, 255, 255, 0.7)',
                  textAlign: 'center',
                  display: 'block',
                  mt: 0.5,
                  fontSize: '0.75rem'
                }}
                aria-live="polite"
              >
                {currentIndex + 1} of {totalImages}
                {metadata?.dimensions && (
                  <span> • {metadata.dimensions.width}×{metadata.dimensions.height}</span>
                )}
                {metadata?.fileSize && (
                  <span> • {(metadata.fileSize / 1024 / 1024).toFixed(1)}MB</span>
                )}
                {metadata?.format && (
                  <span> • {metadata.format.toUpperCase()}</span>
                )}
              </Typography>
    </Box>
  );
});

ImageViewerInfo.displayName = 'ImageViewerInfo';

export default ImageViewerInfo;