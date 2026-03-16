import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  LinearProgress,
  Typography,
  Box,
  IconButton,
  Collapse,
} from '@mui/material';
import CloseIcon from '@mui/icons-material/Close';
import MinimizeIcon from '@mui/icons-material/Minimize';

interface OptimizationState {
  isScanning: boolean;
  isGenerating: boolean;
  scanProgress: number;
  generationProgress: number;
  totalImages: number;
  processedImages: number;
  currentFile?: string;
  estimatedTimeRemaining?: number;
  canMinimize: boolean;
  isMinimized?: boolean;
}

interface OptimizationProgressProps {
  state: OptimizationState;
  onSkip: () => void;
  onBackground: () => void;
  onCancel: () => void;
  onMinimize?: () => void;
}

const OptimizationProgress: React.FC<OptimizationProgressProps> = ({
  state,
  onSkip,
  onBackground,
  onCancel,
  onMinimize,
}) => {
  const totalProgress = state.isScanning
    ? state.scanProgress * 0.3
    : (state.scanProgress * 0.3) + (state.generationProgress * 0.7);

  const formatTimeRemaining = (seconds?: number): string => {
    if (!seconds) return '';
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = Math.floor(seconds % 60);
    return `${minutes}:${remainingSeconds.toString().padStart(2, '0')}`;
  };

  return (
    <Dialog
      open={state.isScanning || state.isGenerating}
      fullWidth
      maxWidth="sm"
      PaperProps={{
        sx: {
          borderRadius: 2,
          minWidth: 400,
        },
      }}
    >
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          pb: 1,
        }}
      >
        <Typography variant="h6" component="div">
          {state.isScanning ? 'Scanning Folders...' : 'Optimizing Images...'}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1 }}>
          {onMinimize && state.canMinimize && (
            <IconButton size="small" onClick={onMinimize}>
              <MinimizeIcon />
            </IconButton>
          )}
          <IconButton size="small" onClick={onCancel}>
            <CloseIcon />
          </IconButton>
        </Box>
      </DialogTitle>

      <DialogContent>
        {/* Progress bar */}
        <Box sx={{ mb: 2 }}>
          <LinearProgress
            variant="determinate"
            value={Math.min(totalProgress, 100)}
            sx={{
              height: 8,
              borderRadius: 4,
              mb: 1,
              '& .MuiLinearProgress-bar': {
                borderRadius: 4,
              },
            }}
          />
          <Typography variant="body2" align="center" color="text.secondary">
            {Math.round(totalProgress)}% complete
          </Typography>
        </Box>

        {/* Phase-specific content */}
        <Collapse in={state.isScanning}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Discovering images in selected folders...
            </Typography>
            {state.currentFile && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Scanning: {state.currentFile.split('/').pop()}
              </Typography>
            )}
          </Box>
        </Collapse>

        <Collapse in={state.isGenerating}>
          <Box sx={{ mb: 2 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Generating optimized thumbnails for instant loading...
            </Typography>
            {state.currentFile && (
              <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                Processing: {state.currentFile.split('/').pop()}
              </Typography>
            )}
          </Box>
        </Collapse>

        {/* Stats */}
        <Box sx={{ display: 'flex', justifyContent: 'space-between', mb: 2 }}>
          <Typography variant="body2">
            Images found: {state.totalImages}
          </Typography>
          {state.processedImages > 0 && (
            <Typography variant="body2">
              Optimized: {state.processedImages}
            </Typography>
          )}
        </Box>

        {/* Time remaining */}
        {state.estimatedTimeRemaining && state.estimatedTimeRemaining > 0 && (
          <Typography variant="body2" color="text.secondary" align="center" sx={{ mb: 2 }}>
            Estimated time remaining: {formatTimeRemaining(state.estimatedTimeRemaining)}
          </Typography>
        )}

        {/* Performance hint */}
        <Typography variant="caption" color="text.secondary" align="center" sx={{ display: 'block' }}>
          {state.isScanning
            ? "This scan happens quickly and helps us optimize loading performance"
            : "Thumbnails are cached for instant loading on future visits"
          }
        </Typography>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 2, gap: 1 }}>
        <Button
          onClick={onCancel}
          color="error"
          variant="outlined"
          size="small"
        >
          Cancel
        </Button>
        <Button
          onClick={onSkip}
          color="secondary"
          variant="outlined"
          size="small"
        >
          Skip Optimization
        </Button>
        {state.canMinimize && (
          <Button
            onClick={onBackground}
            variant="outlined"
            size="small"
            startIcon={<MinimizeIcon />}
          >
            Continue in Background
          </Button>
        )}
        <Button
          variant="contained"
          size="small"
          disabled // Keep optimizing is the default action
        >
          Keep Optimizing
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default OptimizationProgress;
export type { OptimizationState };