import React from 'react';
import { Box } from '@mui/material';

interface LoadingIndicatorProps {
  isCurrentLoading: boolean;
  isTransitioning: boolean;
}

const LoadingIndicator: React.FC<LoadingIndicatorProps> = ({
  isCurrentLoading,
  isTransitioning
}) => {
  if (!isCurrentLoading && !isTransitioning) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        top: 16,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 1400,
        width: 180,
        opacity: 0.9,
        pointerEvents: 'none'
      }}
    >
      <Box
        sx={{
          height: 3,
          borderRadius: 2,
          backgroundColor: 'rgba(255, 255, 255, 0.2)',
          overflow: 'hidden',
          position: 'relative'
        }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: 0,
            left: 0,
            height: '100%',
            width: isTransitioning ? '60%' : '100%',
            backgroundColor: 'white',
            borderRadius: 2,
            animation: isTransitioning
              ? 'shimmer 1.5s ease-in-out infinite'
              : 'progress 2s ease-in-out infinite',
            transformOrigin: 'left'
          }}
        />
      </Box>

      {/* Subtle loading text */}
      <Box
        sx={{
          mt: 1,
          textAlign: 'center',
          opacity: 0.7
        }}
      >
        <span
          style={{
            color: 'white',
            fontSize: '0.75rem',
            fontWeight: 500,
            letterSpacing: '0.025em'
          }}
        >
          {isTransitioning ? 'Transitioning...' : 'Loading...'}
        </span>
      </Box>
    </Box>
  );
};

// Add CSS animations
const style = document.createElement('style');
style.textContent = `
  @keyframes progress {
    0% { transform: translateX(-100%); }
    50% { transform: translateX(0%); }
    100% { transform: translateX(100%); }
  }

  @keyframes shimmer {
    0% { transform: translateX(-100%); }
    100% { transform: translateX(100%); }
  }
`;
document.head.appendChild(style);

export default LoadingIndicator;