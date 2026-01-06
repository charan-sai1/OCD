import React, { useMemo } from 'react';
import { Box } from '@mui/material';

// Lightweight inline SVG icons
const ZoomInIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 13h-6v6h-2v-6H5v-2h6V5h2v6h6v2z" fill="currentColor"/>
  </svg>
);

const ZoomOutIcon = () => (
  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M19 13H5v-2h14v2z" fill="currentColor"/>
  </svg>
);

interface ZoomControlsProps {
  zoomLevel: number;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetZoom: () => void;
  isTransitioning: boolean;
}

const ZoomControls: React.FC<ZoomControlsProps> = ({
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetZoom,
  isTransitioning
}) => {
  const controlStyles = useMemo(() => ({
    button: {
      width: 40,
      height: 40,
      borderRadius: 2,
      backdropFilter: 'blur(10px)',
      border: '1px solid rgba(255, 255, 255, 0.15)',
      backgroundColor: zoomLevel > 0.5 && zoomLevel < 5
        ? 'rgba(0, 0, 0, 0.7)'
        : 'rgba(0, 0, 0, 0.4)',
      color: 'white',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      cursor: 'pointer',
      transition: 'all 0.2s cubic-bezier(0.4, 0, 0.2, 1)',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
      '&:hover': zoomLevel > 0.5 && zoomLevel < 5 ? {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        transform: 'scale(1.05)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
      } : {},
      '&:active': zoomLevel > 0.5 && zoomLevel < 5 ? {
        transform: 'scale(0.95)'
      } : {},
      '&:disabled': {
        opacity: 0.4,
        cursor: 'not-allowed'
      }
    },
    display: {
      backgroundColor: 'rgba(0, 0, 0, 0.7)',
      backdropFilter: 'blur(10px)',
      borderRadius: 2,
      px: 2,
      py: 0.5,
      border: '1px solid rgba(255, 255, 255, 0.15)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minWidth: 55,
      cursor: 'pointer',
      transition: 'all 0.2s ease',
      boxShadow: '0 2px 10px rgba(0, 0, 0, 0.3)',
      '&:hover': {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        transform: 'scale(1.02)',
        boxShadow: '0 4px 20px rgba(0, 0, 0, 0.5)'
      },
      '&:active': {
        transform: 'scale(0.98)'
      }
    },
    text: {
      color: 'white',
      fontWeight: 600,
      fontSize: '0.8rem',
      letterSpacing: '0.025em',
      userSelect: 'none' as const
    }
  }), [zoomLevel]);

  return (
    <Box
      sx={{
        position: 'absolute',
        top: 16,
        left: 16,
        zIndex: 1300,
        display: 'flex',
        gap: 0.5,
        opacity: isTransitioning ? 0.5 : 1,
        transition: 'all 0.3s ease',
        transform: 'scale(1)'
      }}
    >
      <Box
        onClick={!isTransitioning && zoomLevel > 0.5 ? onZoomOut : undefined}
        sx={{
          ...controlStyles.button,
          opacity: zoomLevel <= 0.5 || isTransitioning ? 0.4 : 1,
          cursor: zoomLevel <= 0.5 || isTransitioning ? 'not-allowed' : 'pointer'
        }}
      >
        <ZoomOutIcon />
      </Box>

      <Box
        onClick={!isTransitioning ? onResetZoom : undefined}
        sx={controlStyles.display}
      >
        <span style={controlStyles.text}>
          {Math.round(zoomLevel * 100)}%
        </span>
      </Box>

      <Box
        onClick={!isTransitioning && zoomLevel < 5 ? onZoomIn : undefined}
        sx={{
          ...controlStyles.button,
          opacity: zoomLevel >= 5 || isTransitioning ? 0.4 : 1,
          cursor: zoomLevel >= 5 || isTransitioning ? 'not-allowed' : 'pointer'
        }}
      >
        <ZoomInIcon />
      </Box>
    </Box>
  );
};

export default ZoomControls;