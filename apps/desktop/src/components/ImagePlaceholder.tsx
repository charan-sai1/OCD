import React, { memo } from 'react';
import { Box, CircularProgress, Skeleton } from '@mui/material';

interface ImagePlaceholderProps {
  width?: number;
  height?: number;
  aspectRatio?: number;
  showLoadingIndicator?: boolean;
  variant?: 'skeleton' | 'shimmer' | 'simple';
}

const ImagePlaceholder: React.FC<ImagePlaceholderProps> = memo(({
  aspectRatio = 1,
  showLoadingIndicator = true,
  variant = 'shimmer'
}) => {
  if (variant === 'skeleton') {
    return (
      <Skeleton
        variant="rectangular"
        width="100%"
        sx={{
          aspectRatio: aspectRatio.toString(),
          borderRadius: 2,
          bgcolor: 'grey.100'
        }}
      />
    );
  }

  if (variant === 'shimmer') {
    return (
      <Box
        sx={{
          width: '100%',
          aspectRatio: aspectRatio.toString(),
          background: 'linear-gradient(90deg, #f0f0f0 25%, #e0e0e0 50%, #f0f0f0 75%)',
          backgroundSize: '200% 100%',
          animation: 'shimmer 1.5s infinite',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          '@keyframes shimmer': {
            '0%': { backgroundPosition: '-200% 0' },
            '100%': { backgroundPosition: '200% 0' }
          }
        }}
      >
        {showLoadingIndicator && (
          <CircularProgress
            size={24}
            sx={{
              color: 'grey.400',
              opacity: 0.7
            }}
          />
        )}
      </Box>
    );
  }

  // Simple variant
  return (
    <Box
      sx={{
        width: '100%',
        aspectRatio: aspectRatio.toString(),
        backgroundColor: '#f5f5f5',
        borderRadius: 2,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: '1px solid #e0e0e0'
      }}
    >
      {showLoadingIndicator && (
        <CircularProgress
          size={20}
          sx={{ color: 'grey.400' }}
        />
      )}
    </Box>
  );
});

ImagePlaceholder.displayName = 'ImagePlaceholder';

export default ImagePlaceholder;