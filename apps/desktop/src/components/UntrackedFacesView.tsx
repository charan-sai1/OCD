// apps/desktop/src/components/UntrackedFacesView.tsx
// Shows all detected faces sorted by appearance frequency

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
  LinearProgress,
  Paper,
  Chip,
  Avatar,
  Badge,
  useTheme,
  Container,
  Alert
} from '@mui/material';
import {
  Face as FaceIcon,
  PlayArrow as ProcessIcon,
  PersonAdd as PersonAddIcon,
  Group as GroupIcon,
  PhotoLibrary as PhotoLibraryIcon,
  CheckCircle as SuccessIcon
} from '@mui/icons-material';
import { useFaceRecognition, ProcessingStage } from '../hooks/useFaceRecognition';

interface UntrackedFace {
  id: string;
  imagePath: string;
  bounds: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  confidence: number;
  appearanceCount: number; // How many times this face appears across all images
  qualityScore: number;
}

const UntrackedFacesView: React.FC = () => {
  const theme = useTheme();
  const {
    isInitialized,
    capabilities,
    processingStatus,
    isLoading,
    initialize
  } = useFaceRecognition();

  const [untrackedFaces, setUntrackedFaces] = useState<UntrackedFace[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  // Mock data for demonstration - in real implementation, this would come from the backend
  useEffect(() => {
    if (processingStatus?.currentStage === ProcessingStage.Completed) {
      // Generate mock untracked faces sorted by frequency
      const mockFaces: UntrackedFace[] = Array.from({ length: 24 }, (_, i) => ({
        id: `face_${i + 1}`,
        imagePath: `/mock-face-${(i % 6) + 1}.jpg`, // Cycle through 6 different face images
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        confidence: 0.85 + Math.random() * 0.1,
        appearanceCount: Math.floor(Math.random() * 20) + 1, // Random count 1-20
        qualityScore: 0.7 + Math.random() * 0.3
      })).sort((a, b) => b.appearanceCount - a.appearanceCount); // Sort by frequency descending

      setUntrackedFaces(mockFaces);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  }, [processingStatus?.currentStage]);

  const handleInitialize = async () => {
    try {
      await initialize();
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  };

  const handleAddAsPerson = (face: UntrackedFace) => {
    // TODO: Open person addition dialog with relationship selection
    console.log('Add face as person:', face);
  };

  const getProcessingStatusText = () => {
    if (!processingStatus) return 'Ready to process';

    if (processingStatus.isProcessing) {
      return `Processing: ${processingStatus.currentImage || 'Unknown'}`;
    }

    if (processingStatus.currentStage === ProcessingStage.Completed) {
      return `Processing complete! ${processingStatus.facesDetected || 0} faces found`;
    }

    return 'Processing paused';
  };

  const ProcessingPanel = () => (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <ProcessIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Face Processing
          </Typography>
        </Box>

        {!isInitialized ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PhotoLibraryIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Initialize Face Recognition
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Start processing your photos to detect and organize faces.
            </Typography>
            <Button
              variant="contained"
              size="large"
              onClick={handleInitialize}
              disabled={isLoading}
              startIcon={isLoading ? undefined : <FaceIcon />}
              fullWidth
            >
              {isLoading ? 'Initializing...' : 'Initialize & Process'}
            </Button>
          </Box>
        ) : (
          <Box>
            {/* Processing Status */}
            <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
              <Typography variant="subtitle2" gutterBottom>
                Status
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                {getProcessingStatusText()}
              </Typography>

              {processingStatus && processingStatus.progress > 0 && (
                <LinearProgress
                  variant="determinate"
                  value={processingStatus.progress}
                  sx={{ height: 8, borderRadius: 4, mb: 1 }}
                  color={
                    processingStatus.currentStage === ProcessingStage.Completed ? 'success' : 'primary'
                  }
                />
              )}

              {processingStatus && (
                <Box sx={{ display: 'flex', justifyContent: 'space-between', mt: 1 }}>
                  <Typography variant="caption" color="text.secondary">
                    {processingStatus.progress.toFixed(1)}% complete
                  </Typography>
                  {processingStatus.estimatedTimeRemaining && (
                    <Typography variant="caption" color="text.secondary">
                      ~{Math.ceil(processingStatus.estimatedTimeRemaining / 60)} min left
                    </Typography>
                  )}
                </Box>
              )}
            </Paper>

            {/* Hardware Info */}
            {capabilities && (
              <Paper sx={{ p: 2, mb: 3 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Hardware Detected
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  CPU: {capabilities.cpuCores} cores
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  RAM: {capabilities.memoryGB}GB
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  GPU: {capabilities.hasGPU ? 'Available' : 'Not available'}
                </Typography>
              </Paper>
            )}

            {/* Processing Stats */}
            {processingStatus && processingStatus.facesDetected !== undefined && (
              <Paper sx={{ p: 2 }}>
                <Typography variant="subtitle2" gutterBottom>
                  Results
                </Typography>
                <Grid container spacing={2}>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Images</Typography>
                    <Typography variant="h6" color="primary.main">
                      {processingStatus.processedImages || 0}
                    </Typography>
                  </Grid>
                  <Grid item xs={6}>
                    <Typography variant="body2" color="text.secondary">Faces</Typography>
                    <Typography variant="h6" color="success.main">
                      {processingStatus.facesDetected}
                    </Typography>
                  </Grid>
                </Grid>
              </Paper>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );

  const FacesGallery = () => (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'primary.main' }}>
            <FaceIcon />
          </Avatar>
          <Box>
            <Typography variant="h5" fontWeight={600}>
              Untracked Faces
            </Typography>
            <Typography variant="body1" color="text.secondary">
              {untrackedFaces.length} faces found, sorted by appearance frequency
            </Typography>
          </Box>
        </Box>
      </Box>

      {showSuccess && (
        <Alert
          icon={<SuccessIcon />}
          severity="success"
          sx={{ mb: 3 }}
          onClose={() => setShowSuccess(false)}
        >
          Face processing completed! {untrackedFaces.length} faces detected.
        </Alert>
      )}

      {untrackedFaces.length === 0 ? (
        <Box sx={{ textAlign: 'center', py: 8 }}>
          <FaceIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
          <Typography variant="h6" color="text.secondary" gutterBottom>
            No Faces Detected Yet
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Process your photos to start detecting and organizing faces.
          </Typography>
        </Box>
      ) : (
        <Grid container spacing={2}>
          {untrackedFaces.map((face, index) => (
            <Grid item xs={12} sm={6} md={4} lg={3} key={face.id}>
              <Card
                sx={{
                  position: 'relative',
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    transform: 'translateY(-4px)',
                    boxShadow: theme.shadows[8]
                  }
                }}
              >
                {/* Face Image */}
                <Box
                  sx={{
                    position: 'relative',
                    width: '100%',
                    height: 200,
                    overflow: 'hidden',
                    bgcolor: 'background.default'
                  }}
                >
                  <Box
                    component="img"
                    src={face.imagePath}
                    alt={`Face ${index + 1}`}
                    sx={{
                      width: '100%',
                      height: '100%',
                      objectFit: 'cover'
                    }}
                  />

                  {/* Appearance Count Badge */}
                  <Badge
                    badgeContent={`${face.appearanceCount}x`}
                    color="primary"
                    sx={{
                      position: 'absolute',
                      top: 8,
                      right: 8,
                      '& .MuiBadge-badge': {
                        fontSize: '0.7rem',
                        height: 24,
                        minWidth: 24
                      }
                    }}
                  />

                  {/* Confidence Chip */}
                  <Chip
                    label={`${(face.confidence * 100).toFixed(0)}%`}
                    size="small"
                    color={face.confidence > 0.8 ? 'success' : face.confidence > 0.6 ? 'warning' : 'error'}
                    sx={{
                      position: 'absolute',
                      bottom: 8,
                      left: 8,
                      fontSize: '0.7rem'
                    }}
                  />
                </Box>

                {/* Actions */}
                <CardContent sx={{ p: 2 }}>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    <Button
                      variant="contained"
                      size="small"
                      startIcon={<PersonAddIcon />}
                      onClick={() => handleAddAsPerson(face)}
                      fullWidth
                    >
                      Add Person
                    </Button>
                    <Button
                      variant="outlined"
                      size="small"
                      startIcon={<GroupIcon />}
                      onClick={() => console.log('Group similar faces')}
                    >
                      Group
                    </Button>
                  </Box>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      )}
    </Box>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      <Grid container spacing={3}>
        {/* Faces Gallery - Main Content */}
        <Grid item xs={12} lg={8}>
          <FacesGallery />
        </Grid>

        {/* Processing Panel - Sidebar */}
        <Grid item xs={12} lg={4}>
          <ProcessingPanel />
        </Grid>
      </Grid>
    </Container>
  );
};

export default UntrackedFacesView;