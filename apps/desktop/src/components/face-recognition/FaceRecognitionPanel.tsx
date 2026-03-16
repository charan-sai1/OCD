// apps/desktop/src/components/FaceRecognitionPanel.tsx
// UI component for face recognition features

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Grid,
  LinearProgress,
  Paper,
  TextField,
  Typography,
  Alert,
  Collapse,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  Badge
} from '@mui/material';
import {
  Face as FaceIcon,
  Group as GroupIcon,
  Settings as SettingsIcon,
  PlayArrow as ProcessIcon,
  People as PeopleIcon,
  Edit as EditIcon,
  CheckCircle as SuccessIcon,
  Memory as EmbeddingIcon,
  Search as DetectionIcon,
  Timeline as ClusteringIcon,
  Notifications as NotificationIcon
} from '@mui/icons-material';
import { useFaceRecognition, ProcessingMode, PersonGroup, ProcessingStage } from '../hooks/useFaceRecognition';

interface FaceRecognitionPanelProps {
  isVisible: boolean;
  onClose: () => void;
}

const FaceRecognitionPanel: React.FC<FaceRecognitionPanelProps> = ({
  isVisible,
  onClose
}) => {
  const {
    isInitialized,
    capabilities,
    processingStatus,
    people,
    isLoading,
    initialize,
    clusterFaces,
    updatePerson,
    setProcessingMode,
    processNextImage
  } = useFaceRecognition();

  const [selectedMode, setSelectedMode] = useState<ProcessingMode>(ProcessingMode.Balanced);
  const [editingPerson, setEditingPerson] = useState<PersonGroup | null>(null);
  const [personName, setPersonName] = useState('');
  const [showSuccess, setShowSuccess] = useState(false);
  const [activeStep, setActiveStep] = useState(0);
  const [showDetailedProgress, setShowDetailedProgress] = useState(false);

  // Processing stages for detailed progress
  const processingSteps = [
    {
      label: 'Face Detection',
      description: 'Finding faces in your photos using AI models',
      icon: DetectionIcon,
      stage: ProcessingStage.DetectingFaces,
      estimatedTime: '30-60 seconds per 100 images'
    },
    {
      label: 'Feature Extraction',
      description: 'Converting faces to numerical embeddings',
      icon: EmbeddingIcon,
      stage: ProcessingStage.ExtractingEmbeddings,
      estimatedTime: '20-40 seconds per 100 faces'
    },
    {
      label: 'Person Clustering',
      description: 'Grouping similar faces into people',
      icon: ClusteringIcon,
      stage: ProcessingStage.ClusteringFaces,
      estimatedTime: '5-15 seconds'
    }
  ];

  // Initialize on mount
  useEffect(() => {
    if (isVisible && !isInitialized) {
      initialize();
    }
  }, [isVisible, isInitialized, initialize]);

  // Update processing mode when selected
  useEffect(() => {
    if (isInitialized) {
      setProcessingMode(selectedMode);
    }
  }, [selectedMode, isInitialized, setProcessingMode]);

  // Update active step based on processing stage
  useEffect(() => {
    if (!processingStatus?.currentStage) {
      setActiveStep(0);
      return;
    }

    switch (processingStatus.currentStage) {
      case ProcessingStage.DetectingFaces:
        setActiveStep(0);
        break;
      case ProcessingStage.ExtractingEmbeddings:
        setActiveStep(1);
        break;
      case ProcessingStage.ClusteringFaces:
        setActiveStep(2);
        break;
      case ProcessingStage.Completed:
        setActiveStep(3);
        break;
      default:
        setActiveStep(0);
    }
  }, [processingStatus?.currentStage]);

  const handleClusterFaces = async () => {
    try {
      await clusterFaces();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    } catch (error) {
      console.error('Failed to cluster faces:', error);
    }
  };

  const handleUpdatePerson = async () => {
    if (!editingPerson) return;

    try {
      await updatePerson(editingPerson.id, personName);
      setEditingPerson(null);
      setPersonName('');
    } catch (error) {
      console.error('Failed to update person:', error);
    }
  };

  const getModeDescription = (mode: ProcessingMode) => {
    switch (mode) {
      case ProcessingMode.Fast:
        return 'Fast detection, lower accuracy, best for quick scanning';
      case ProcessingMode.Balanced:
        return 'Balanced speed and accuracy, recommended for most users';
      case ProcessingMode.HighAccuracy:
        return 'Highest accuracy, slower processing, best for important photos';
    }
  };



  if (!isVisible) return null;

  return (
    <Dialog
      open={isVisible}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          minHeight: '600px',
          bgcolor: 'background.paper'
        }
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <FaceIcon />
        Facial Recognition
      </DialogTitle>

      <DialogContent>
        <Collapse in={showSuccess}>
          <Alert
            icon={<SuccessIcon />}
            severity="success"
            sx={{ mb: 2 }}
            onClose={() => setShowSuccess(false)}
          >
            Faces successfully grouped into people!
          </Alert>
        </Collapse>

        {!isInitialized ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <FaceIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
            <Typography variant="h6" gutterBottom>
              Initialize Facial Recognition
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              This will enable face detection and grouping features for your photos.
            </Typography>
            <Button
              variant="contained"
              onClick={initialize}
              disabled={isLoading}
              startIcon={isLoading ? <CircularProgress size={20} /> : <FaceIcon />}
            >
              {isLoading ? 'Initializing...' : 'Initialize'}
            </Button>
          </Box>
        ) : (
          <Grid container spacing={3}>
            {/* Processing Mode Selection */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Typography variant="h6" gutterBottom sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <SettingsIcon />
                    Processing Mode
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
                    Choose the balance between speed and accuracy based on your hardware.
                  </Typography>

                  {capabilities && (
                    <Box sx={{ mb: 2 }}>
                      <Typography variant="body2">
                        <strong>Detected Hardware:</strong> {capabilities.cpuCores} CPU cores,
                        {capabilities.memoryGB}GB RAM
                        {capabilities.hasGPU && ', GPU available'}
                      </Typography>
                    </Box>
                  )}

                  <Grid container spacing={1}>
                    {Object.values(ProcessingMode).map((mode) => (
                      <Grid item xs={12} sm={4} key={mode}>
                        <Paper
                          sx={{
                            p: 2,
                            cursor: 'pointer',
                            border: selectedMode === mode ? 2 : 1,
                            borderColor: selectedMode === mode ? 'primary.main' : 'divider',
                            bgcolor: selectedMode === mode ? 'primary.light' : 'background.paper'
                          }}
                          onClick={() => setSelectedMode(mode)}
                        >
                          <Typography variant="subtitle2" sx={{ textTransform: 'capitalize' }}>
                            {mode}
                          </Typography>
                          <Typography variant="caption" color="text.secondary">
                            {getModeDescription(mode)}
                          </Typography>
                        </Paper>
                      </Grid>
                    ))}
                  </Grid>
                </CardContent>
              </Card>
            </Grid>

            {/* Processing Status */}
            {processingStatus && (
              <Grid item xs={12}>
                <Card>
                  <CardContent>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                      <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                        <ProcessIcon />
                        AI Processing Status
                      </Typography>
                      <Button
                        size="small"
                        onClick={() => setShowDetailedProgress(!showDetailedProgress)}
                      >
                        {showDetailedProgress ? 'Simple' : 'Detailed'}
                      </Button>
                    </Box>

                    {/* Simple Progress */}
                    {!showDetailedProgress && (
                      <Box sx={{ mb: 2 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, mb: 1 }}>
                          <Badge
                            badgeContent={processingStatus.queueLength}
                            color={processingStatus.queueLength > 0 ? 'primary' : 'default'}
                          >
                            <NotificationIcon />
                          </Badge>
                          <Typography variant="body2">
                            {processingStatus.isProcessing
                              ? `Processing: ${processingStatus.currentImage || 'Unknown'}`
                              : `Queue: ${processingStatus.queueLength} images`
                            }
                          </Typography>
                          {processingStatus.processingSpeed && (
                            <Typography variant="caption" color="text.secondary">
                              {processingStatus.processingSpeed.toFixed(1)} img/min
                            </Typography>
                          )}
                        </Box>

                        <LinearProgress
                          variant="determinate"
                          value={processingStatus.progress}
                          sx={{ height: 10, borderRadius: 5, mb: 1 }}
                          color={
                            processingStatus.currentStage === ProcessingStage.Error ? 'error' :
                            processingStatus.currentStage === ProcessingStage.Completed ? 'success' : 'primary'
                          }
                        />

                        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                          <Typography variant="caption" color="text.secondary">
                            {processingStatus.progress.toFixed(1)}% complete
                          </Typography>
                          {processingStatus.estimatedTimeRemaining && (
                            <Typography variant="caption" color="text.secondary">
                              ~{Math.ceil(processingStatus.estimatedTimeRemaining / 60)} min remaining
                            </Typography>
                          )}
                        </Box>

                        {processingStatus.facesDetected !== undefined && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            👤 {processingStatus.facesDetected} faces detected
                          </Typography>
                        )}
                      </Box>
                    )}

                    {/* Detailed Progress */}
                    {showDetailedProgress && (
                      <Box sx={{ mb: 2 }}>
                        <Stepper activeStep={activeStep} orientation="vertical">
                          {processingSteps.map((step, index) => {
                            const IconComponent = step.icon;
                            const isActive = processingStatus.currentStage === step.stage;
                            const isCompleted = index < activeStep;

                            return (
                              <Step key={step.label} completed={isCompleted}>
                                <StepLabel
                                  StepIconComponent={() => (
                                    <IconComponent
                                      color={
                                        isCompleted ? 'success' :
                                        isActive ? 'primary' :
                                        processingStatus.currentStage === ProcessingStage.Error ? 'error' : 'disabled'
                                      }
                                    />
                                  )}
                                >
                                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                    <Typography variant="subtitle2">{step.label}</Typography>
                                    {isActive && <CircularProgress size={16} />}
                                  </Box>
                                </StepLabel>
                                <StepContent>
                                  <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                                    {step.description}
                                  </Typography>

                                  {processingStatus.stageProgress && (
                                    <Box sx={{ mb: 2 }}>
                                      {step.stage === ProcessingStage.DetectingFaces && (
                                        <Box>
                                          <LinearProgress
                                            variant="determinate"
                                            value={(processingStatus.stageProgress.detection.completed / processingStatus.stageProgress.detection.total) * 100}
                                            sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
                                          />
                                          <Typography variant="caption">
                                            {processingStatus.stageProgress.detection.completed} / {processingStatus.stageProgress.detection.total} images
                                          </Typography>
                                        </Box>
                                      )}

                                      {step.stage === ProcessingStage.ExtractingEmbeddings && (
                                        <Box>
                                          <LinearProgress
                                            variant="determinate"
                                            value={(processingStatus.stageProgress.embedding.completed / processingStatus.stageProgress.embedding.total) * 100}
                                            sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
                                          />
                                          <Typography variant="caption">
                                            {processingStatus.stageProgress.embedding.completed} / {processingStatus.stageProgress.embedding.total} faces
                                          </Typography>
                                        </Box>
                                      )}

                                      {step.stage === ProcessingStage.ClusteringFaces && (
                                        <Box>
                                          <LinearProgress
                                            variant={processingStatus.stageProgress.clustering.completed ? "determinate" : "indeterminate"}
                                            value={processingStatus.stageProgress.clustering.completed ? 100 : undefined}
                                            sx={{ height: 6, borderRadius: 3, mb: 0.5 }}
                                          />
                                          <Typography variant="caption">
                                            Analyzing face similarities...
                                          </Typography>
                                        </Box>
                                      )}
                                    </Box>
                                  )}

                                  <Typography variant="caption" color="text.secondary">
                                    Estimated: {step.estimatedTime}
                                  </Typography>
                                </StepContent>
                              </Step>
                            );
                          })}
                        </Stepper>

                        {/* Processing Statistics */}
                        {processingStatus.processedImages && processingStatus.totalImages && (
                          <Box sx={{ mt: 2, p: 2, bgcolor: 'background.default', borderRadius: 1 }}>
                            <Typography variant="subtitle2" gutterBottom>
                              Processing Statistics
                            </Typography>
                            <Grid container spacing={2}>
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">Images</Typography>
                                <Typography variant="body2">
                                  {processingStatus.processedImages} / {processingStatus.totalImages}
                                </Typography>
                              </Grid>
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">Faces</Typography>
                                <Typography variant="body2">
                                  {processingStatus.facesDetected || 0}
                                </Typography>
                              </Grid>
                              <Grid item xs={4}>
                                <Typography variant="caption" color="text.secondary">Speed</Typography>
                                <Typography variant="body2">
                                  {processingStatus.processingSpeed?.toFixed(1) || 0} img/min
                                </Typography>
                              </Grid>
                            </Grid>
                          </Box>
                        )}
                      </Box>
                    )}

                    {/* Control Buttons */}
                    <Box sx={{ display: 'flex', gap: 1 }}>
                      {processingStatus.isProcessing && (
                        <Button
                          variant="outlined"
                          size="small"
                          onClick={processNextImage}
                          startIcon={<ProcessIcon />}
                        >
                          Process Next
                        </Button>
                      )}

                      {processingStatus.currentStage === ProcessingStage.Completed && (
                        <Alert severity="success" sx={{ mt: 1 }}>
                          <Typography variant="body2">
                            Processing completed! {processingStatus.facesDetected} faces grouped into {people.length} people.
                          </Typography>
                        </Alert>
                      )}

                      {processingStatus.currentStage === ProcessingStage.Error && (
                        <Alert severity="error" sx={{ mt: 1 }}>
                          <Typography variant="body2">
                            Processing failed. Please check the logs for details.
                          </Typography>
                        </Alert>
                      )}
                    </Box>
                  </CardContent>
                </Card>
              </Grid>
            )}

            {/* People Management */}
            <Grid item xs={12}>
              <Card>
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                    <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <PeopleIcon />
                      People ({people.length})
                    </Typography>
                    <Button
                      variant="contained"
                      onClick={handleClusterFaces}
                      disabled={isLoading}
                      startIcon={isLoading ? <CircularProgress size={16} /> : <GroupIcon />}
                    >
                      {isLoading ? 'Clustering...' : 'Cluster Faces'}
                    </Button>
                  </Box>

                  {people.length === 0 ? (
                    <Typography variant="body2" color="text.secondary">
                      No people detected yet. Click "Cluster Faces" to analyze your photos.
                    </Typography>
                  ) : (
                    <Grid container spacing={1}>
                      {people.map((person) => (
                        <Grid item key={person.id}>
                          <Chip
                            label={person.name || `Person ${person.id.split('_')[1]}`}
                            onClick={() => {
                              setEditingPerson(person);
                              setPersonName(person.name || '');
                            }}
                            variant={person.name ? 'filled' : 'outlined'}
                            icon={<FaceIcon />}
                            sx={{ minWidth: 120 }}
                          />
                        </Grid>
                      ))}
                    </Grid>
                  )}
                </CardContent>
              </Card>
            </Grid>
          </Grid>
        )}
      </DialogContent>

      <DialogActions>
        <Button onClick={onClose}>Close</Button>
      </DialogActions>

      {/* Edit Person Dialog */}
      <Dialog
        open={!!editingPerson}
        onClose={() => setEditingPerson(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <EditIcon />
          Edit Person
        </DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Name"
            fullWidth
            variant="outlined"
            value={personName}
            onChange={(e) => setPersonName(e.target.value)}
            onKeyPress={(e) => {
              if (e.key === 'Enter') {
                handleUpdatePerson();
              }
            }}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingPerson(null)}>Cancel</Button>
          <Button onClick={handleUpdatePerson} variant="contained">
            Save
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default FaceRecognitionPanel;