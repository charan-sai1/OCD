// apps/desktop/src/components/FacesPage.tsx
// Main faces page with improved UI and layout

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  CircularProgress,
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
  Badge,
  Avatar,
  Tooltip,
  IconButton,
  useTheme,
  alpha,
  Container,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions
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
  Notifications as NotificationIcon,
  Person as PersonIcon,
  PhotoCamera as CameraIcon,
  Refresh as RefreshIcon
} from '@mui/icons-material';
import { useFaceRecognition, ProcessingMode, PersonGroup, ProcessingStage } from '../hooks/useFaceRecognition';

const FacesPage: React.FC = () => {
  const theme = useTheme();
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
  const [selectedPerson, setSelectedPerson] = useState<string | null>(null);

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
    if (!isInitialized) {
      initialize();
    }
  }, [isInitialized, initialize]);

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

  const getPersonSampleImages = (person: PersonGroup) => {
    // For now, return placeholder face images based on faceIds
    // In a real implementation, you would fetch actual face images using these IDs
    return person.faceIds.slice(0, 4).map((id, index) => ({
      id,
      imagePath: `/placeholder-face-${index % 3 + 1}.jpg`, // Placeholder paths
      timestamp: person.createdAt
    }));
  };

  // Header component
  const PageHeader = () => (
    <Box sx={{ mb: 4, mt: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            sx={{
              width: 56,
              height: 56,
              bgcolor: 'primary.main',
              boxShadow: theme.shadows[4]
            }}
          >
            <FaceIcon sx={{ fontSize: 32 }} />
          </Avatar>
          <Box>
            <Typography variant="h4" fontWeight={600} color="text.primary">
              Faces
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Manage and organize people detected in your photos
            </Typography>
          </Box>
        </Box>
        <Box sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
          {!isInitialized ? (
            <Button
              variant="contained"
              size="large"
              onClick={initialize}
              disabled={isLoading}
              startIcon={isLoading ? <CircularProgress size={20} /> : <FaceIcon />}
              sx={{ minWidth: 150 }}
            >
              {isLoading ? 'Initializing...' : 'Initialize'}
            </Button>
          ) : (
            <Button
              variant="contained"
              size="large"
              onClick={handleClusterFaces}
              disabled={isLoading}
              startIcon={isLoading ? <CircularProgress size={20} /> : <GroupIcon />}
              sx={{ minWidth: 150 }}
            >
              {isLoading ? 'Clustering...' : 'Cluster Faces'}
            </Button>
          )}
          <Tooltip title="Refresh faces">
            <IconButton onClick={handleClusterFaces} disabled={isLoading}>
              <RefreshIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      {/* Stats Cards */}
      <Grid container spacing={2}>
        <Grid item xs={12} sm={4}>
          <Card sx={{ bgcolor: alpha(theme.palette.primary.main, 0.1), border: `1px solid ${alpha(theme.palette.primary.main, 0.2)}` }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <PeopleIcon color="primary" sx={{ fontSize: 32, mb: 1 }} />
              <Typography variant="h5" fontWeight={600} color="primary.main">
                {people.length}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                People Detected
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ bgcolor: alpha(theme.palette.success.main, 0.1), border: `1px solid ${alpha(theme.palette.success.main, 0.2)}` }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <FaceIcon color="success" sx={{ fontSize: 32, mb: 1 }} />
              <Typography variant="h5" fontWeight={600} color="success.main">
                {processingStatus?.facesDetected || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Total Faces Found
              </Typography>
            </CardContent>
          </Card>
        </Grid>
        <Grid item xs={12} sm={4}>
          <Card sx={{ bgcolor: alpha(theme.palette.info.main, 0.1), border: `1px solid ${alpha(theme.palette.info.main, 0.2)}` }}>
            <CardContent sx={{ textAlign: 'center', py: 2 }}>
              <CameraIcon color="info" sx={{ fontSize: 32, mb: 1 }} />
              <Typography variant="h5" fontWeight={600} color="info.main">
                {processingStatus?.processedImages || 0}
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Images Processed
              </Typography>
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );

  // Processing Configuration Component
  const ProcessingConfig = () => (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <SettingsIcon color="primary" />
          <Typography variant="h6" fontWeight={600}>
            Processing Configuration
          </Typography>
        </Box>

        <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
          Choose the balance between speed and accuracy based on your hardware.
        </Typography>

        {/* Hardware Info */}
        {capabilities && (
          <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
            <Typography variant="subtitle2" gutterBottom>
              System Information
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>CPU:</strong> {capabilities.cpuCores} cores
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>Memory:</strong> {capabilities.memoryGB}GB RAM
            </Typography>
            <Typography variant="body2" color="text.secondary">
              <strong>GPU:</strong> {capabilities.hasGPU ? 'Available' : 'Not detected'}
            </Typography>
          </Paper>
        )}

        {/* Processing Modes */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            Processing Mode
          </Typography>
          {Object.values(ProcessingMode).map((mode) => (
            <Paper
              key={mode}
              sx={{
                p: 2,
                mb: 1,
                cursor: 'pointer',
                border: selectedMode === mode ? 2 : 1,
                borderColor: selectedMode === mode ? 'primary.main' : 'divider',
                bgcolor: selectedMode === mode ? alpha(theme.palette.primary.main, 0.1) : 'background.paper',
                transition: 'all 0.2s ease',
                '&:hover': {
                  bgcolor: alpha(theme.palette.primary.main, 0.05),
                  transform: 'translateX(4px)'
                }
              }}
              onClick={() => setSelectedMode(mode)}
            >
              <Typography variant="subtitle2" sx={{ textTransform: 'capitalize', mb: 0.5 }}>
                {mode}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {getModeDescription(mode)}
              </Typography>
            </Paper>
          ))}
        </Box>
      </CardContent>
    </Card>
  );

  // Processing Status Component
  const ProcessingStatus = () => (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <ProcessIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              AI Processing Status
            </Typography>
          </Box>
          {processingStatus && (
            <Button
              size="small"
              variant={showDetailedProgress ? 'contained' : 'outlined'}
              onClick={() => setShowDetailedProgress(!showDetailedProgress)}
            >
              {showDetailedProgress ? 'Simple' : 'Detailed'}
            </Button>
          )}
        </Box>

        {!processingStatus ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <Typography variant="body2" color="text.secondary">
              No processing in progress
            </Typography>
          </Box>
        ) : (
          <>
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
              </Box>
            )}

            {/* Detailed Progress */}
            {showDetailedProgress && (
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
                        <Typography variant="caption" color="text.secondary">
                          Estimated: {step.estimatedTime}
                        </Typography>
                      </StepContent>
                    </Step>
                  );
                })}
              </Stepper>
            )}

            {/* Control Buttons */}
            <Box sx={{ display: 'flex', gap: 1, mt: 2 }}>
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
            </Box>
          </>
        )}
      </CardContent>
    </Card>
  );

  // People Grid Component
  const PeopleGrid = () => (
    <Card sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <CardContent sx={{ flexGrow: 1 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <PeopleIcon color="primary" />
            <Typography variant="h6" fontWeight={600}>
              People ({people.length})
            </Typography>
          </Box>
        </Box>

        {people.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 6 }}>
            <Avatar sx={{ width: 80, height: 80, mx: 'auto', mb: 2, bgcolor: 'background.default' }}>
              <PersonIcon sx={{ fontSize: 40, color: 'text.secondary' }} />
            </Avatar>
            <Typography variant="h6" color="text.secondary" gutterBottom>
              No People Detected Yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Click "Cluster Faces" to analyze your photos and group similar faces together.
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
        ) : (
          <Grid container spacing={2}>
            {people.map((person) => {
              const sampleImages = getPersonSampleImages(person);
              return (
                <Grid item xs={12} sm={6} key={person.id}>
                  <Paper
                    sx={{
                      p: 2,
                      cursor: 'pointer',
                      border: selectedPerson === person.id ? 2 : 1,
                      borderColor: selectedPerson === person.id ? 'primary.main' : 'divider',
                      bgcolor: selectedPerson === person.id ? alpha(theme.palette.primary.main, 0.1) : 'background.paper',
                      transition: 'all 0.2s ease',
                      '&:hover': {
                        bgcolor: alpha(theme.palette.primary.main, 0.05),
                        transform: 'translateY(-2px)',
                        boxShadow: theme.shadows[4]
                      }
                    }}
                    onClick={() => setSelectedPerson(selectedPerson === person.id ? null : person.id)}
                  >
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      {/* Person Images Grid */}
                      <Box sx={{ position: 'relative', width: 80, height: 80 }}>
                        {sampleImages.length > 0 ? (
                          <Grid container spacing={0.5} sx={{ width: 80, height: 80 }}>
                            {sampleImages.slice(0, 4).map((face, idx) => (
                              <Grid item xs={6} key={idx} sx={{ position: 'relative' }}>
                                <Box
                                  component="img"
                                  src={face.imagePath}
                                  alt={`Face ${idx + 1}`}
                                  sx={{
                                    width: 38,
                                    height: 38,
                                    objectFit: 'cover',
                                    borderRadius: 1,
                                    border: '1px solid',
                                    borderColor: 'divider'
                                  }}
                                />
                              </Grid>
                            ))}
                          </Grid>
                        ) : (
                          <Avatar sx={{ width: 80, height: 80, bgcolor: 'background.default' }}>
                            <FaceIcon />
                          </Avatar>
                        )}
                        <Badge
                          badgeContent={person.faceIds.length}
                          color="primary"
                          sx={{
                            position: 'absolute',
                            top: -8,
                            right: -8,
                            '& .MuiBadge-badge': {
                              fontSize: '0.6rem',
                              height: 20,
                              minWidth: 20
                            }
                          }}
                        >
                          <Box />
                        </Badge>
                      </Box>

                      {/* Person Info */}
                      <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                        <Typography variant="subtitle1" fontWeight={600} noWrap>
                          {person.name || `Person ${person.id.split('_')[1]}`}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          {person.faceIds.length} face{person.faceIds.length !== 1 ? 's' : ''}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Created: {new Date(person.createdAt).toLocaleDateString()}
                        </Typography>
                      </Box>

                      {/* Edit Button */}
                      <IconButton
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditingPerson(person);
                          setPersonName(person.name || '');
                        }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Box>

                    {/* Expanded Content */}
                    {selectedPerson === person.id && (
                      <Box sx={{ mt: 2, pt: 2, borderTop: '1px solid', borderColor: 'divider' }}>
                        <Typography variant="subtitle2" gutterBottom>
                          Recent Photos
                        </Typography>
                        <Grid container spacing={1}>
                          {getPersonSampleImages(person).map((face, idx) => (
                            <Grid item xs={4} key={idx}>
                              <Box
                                component="img"
                                src={face.imagePath}
                                alt={`Face ${idx + 1}`}
                                sx={{
                                  width: '100%',
                                  aspectRatio: '1',
                                  objectFit: 'cover',
                                  borderRadius: 1,
                                  border: '1px solid',
                                  borderColor: 'divider',
                                  cursor: 'pointer',
                                  transition: 'transform 0.2s ease',
                                  '&:hover': {
                                    transform: 'scale(1.05)'
                                  }
                                }}
                              />
                            </Grid>
                          ))}
                        </Grid>
                        {person.faceIds.length > 4 && (
                          <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                            +{person.faceIds.length - 4} more photos
                          </Typography>
                        )}
                      </Box>
                    )}
                  </Paper>
                </Grid>
              );
            })}
          </Grid>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      {/* Success Alert */}
      <Collapse in={showSuccess}>
        <Alert
          icon={<SuccessIcon />}
          severity="success"
          sx={{ mb: 3 }}
          onClose={() => setShowSuccess(false)}
        >
          Faces successfully grouped into people!
        </Alert>
      </Collapse>

      {/* Page Header */}
      <PageHeader />

      {/* Main Content - 3 Column Layout */}
      {isInitialized && (
        <Grid container spacing={3}>
          {/* Left Column - Processing Configuration */}
          <Grid item xs={12} lg={4}>
            <ProcessingConfig />
          </Grid>

          {/* Middle Column - Processing Status */}
          <Grid item xs={12} lg={4}>
            <ProcessingStatus />
          </Grid>

          {/* Right Column - People Grid */}
          <Grid item xs={12} lg={4}>
            <PeopleGrid />
          </Grid>
        </Grid>
      )}

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
    </Container>
  );
};

export default FacesPage;