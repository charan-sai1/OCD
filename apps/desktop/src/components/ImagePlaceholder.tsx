import React, { memo } from 'react';
import { Box, CircularProgress, Skeleton } from '@mui/material';

interface ImagePlaceholderProps {
  width?: number;
  height?: number;
  aspectRatio?: number;
  showLoadingIndicator?: boolean;
  variant?: 'skeleton' | 'shimmer' | 'wave' | 'simple';
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
          background: 'linear-gradient(-45deg, #f8f9fa, #e9ecef, #f8f9fa, #e9ecef)',
          backgroundSize: '400% 400%',
          animation: 'gentlePulse 2s ease-in-out infinite',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          border: '1px solid #e3e6ea',
          '@keyframes gentlePulse': {
            '0%': {
              backgroundPosition: '0% 50%',
              transform: 'scale(1)'
            },
            '50%': {
              backgroundPosition: '100% 50%',
              transform: 'scale(1.02)'
            },
            '100%': {
              backgroundPosition: '0% 50%',
              transform: 'scale(1)'
            }
          }
        }}
      >
        {showLoadingIndicator && (
          <Box
            sx={{
              width: 32,
              height: 32,
              border: '3px solid #e3e6ea',
              borderTop: '3px solid #007bff',
              borderRadius: '50%',
              animation: 'spin 1s linear infinite',
              '@keyframes spin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' }
              }
            }}
          />
        )}
      </Box>
    );
  }

  if (variant === 'wave') {
    return (
      <Box
        sx={{
          width: '100%',
          aspectRatio: aspectRatio.toString(),
          background: 'linear-gradient(90deg, #f8f9fa 0%, #e9ecef 50%, #f8f9fa 100%)',
          backgroundSize: '200% 100%',
          animation: 'waveFlow 2s ease-in-out infinite',
          borderRadius: 2,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          position: 'relative',
          overflow: 'hidden',
          '&::before': {
            content: '""',
            position: 'absolute',
            top: 0,
            left: '-100%',
            width: '100%',
            height: '100%',
            background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.4), transparent)',
            animation: 'waveShine 2s ease-in-out infinite'
          },
          '@keyframes waveFlow': {
            '0%': { backgroundPosition: '200% 0' },
            '100%': { backgroundPosition: '-200% 0' }
          },
          '@keyframes waveShine': {
            '0%': { left: '-100%' },
            '100%': { left: '100%' }
          }
        }}
      >
        {showLoadingIndicator && (
          <Box
            sx={{
              width: 28,
              height: 28,
              border: '2px solid rgba(0,123,255,0.3)',
              borderTop: '2px solid #007bff',
              borderRadius: '50%',
              animation: 'gentleSpin 1.2s linear infinite',
              '@keyframes gentleSpin': {
                '0%': { transform: 'rotate(0deg)' },
                '100%': { transform: 'rotate(360deg)' }
              }
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