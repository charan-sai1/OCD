// apps/desktop/src/components/PeoplePage.tsx
// Unified People page with all sections in one view

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
  alpha,
  Container,
  Alert,
  useMediaQuery
} from '@mui/material';
import {
  Face as FaceIcon,
  People as PeopleIcon,
  PhotoLibrary as PhotoLibraryIcon,
  CheckCircle as SuccessIcon,
  Person as PersonIcon,
  PlayArrow as ProcessIcon
} from '@mui/icons-material';
import { useFaceRecognition, PersonGroup } from '../hooks/useFaceRecognition';
import { RelationshipType } from '../../../../shared-backend/core/types';

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
  appearanceCount: number;
  qualityScore: number;
}

interface PersonWithRelationship extends PersonGroup {
  relationshipToAdmin?: RelationshipType;
  generation?: number;
  birthDate?: string;
  isAdmin?: boolean;
}

const PeoplePage: React.FC = () => {
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('md'));
  const {
    isInitialized,
    processingStatus,
    people,
    isLoading,
    initialize
  } = useFaceRecognition();

  const [untrackedFaces, setUntrackedFaces] = useState<UntrackedFace[]>([]);
  const [peopleWithRelationships, setPeopleWithRelationships] = useState<PersonWithRelationship[]>([]);
  const [showSuccess, setShowSuccess] = useState(false);

  // Mock data for demonstration
  useEffect(() => {
    if (processingStatus?.currentStage === 'completed') {
      const mockFaces: UntrackedFace[] = Array.from({ length: 24 }, (_, i) => ({
        id: `face_${i + 1}`,
        imagePath: `/mock-face-${(i % 6) + 1}.jpg`,
        bounds: { x: 100, y: 100, width: 200, height: 200 },
        confidence: 0.85 + Math.random() * 0.1,
        appearanceCount: Math.floor(Math.random() * 20) + 1,
        qualityScore: 0.7 + Math.random() * 0.3
      })).sort((a, b) => b.appearanceCount - a.appearanceCount);

      setUntrackedFaces(mockFaces);
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3000);
    }
  }, [processingStatus?.currentStage]);

  useEffect(() => {
    const mockRelationships: PersonWithRelationship[] = people.map((person, index) => ({
      ...person,
      relationshipToAdmin: index === 0 ? undefined : Object.values(RelationshipType)[index % Object.values(RelationshipType).length],
      generation: index === 0 ? 0 : Math.floor(index / 3) - 1,
      birthDate: index > 0 ? new Date(1990 + index * 2, index % 12, 15).toISOString() : undefined
    }));
    setPeopleWithRelationships(mockRelationships);
  }, [people]);

  const handleInitialize = async () => {
    try {
      await initialize();
    } catch (error) {
      console.error('Failed to initialize:', error);
    }
  };

  const handleAddAsPerson = (_face: UntrackedFace) => {
    // TODO: Implement add face as person functionality
  };

  const getRelationshipLabel = (relationship?: RelationshipType, generation?: number) => {
    if (!relationship) return 'Admin';
    const labels: Record<RelationshipType, string> = {
      [RelationshipType.PARENT]: 'Parent',
      [RelationshipType.CHILD]: 'Child',
      [RelationshipType.SIBLING]: 'Sibling',
      [RelationshipType.SPOUSE]: 'Spouse',
      [RelationshipType.GRANDPARENT]: 'Grandparent',
      [RelationshipType.GRANDCHILD]: 'Grandchild',
      [RelationshipType.AUNT_UNCLE]: 'Aunt/Uncle',
      [RelationshipType.NIECE_NEPHEW]: 'Niece/Nephew',
      [RelationshipType.COUSIN]: 'Cousin'
    };
    const label = labels[relationship];
    if (generation !== undefined && generation !== 0) {
      const genLabel = generation > 0 ? `Gen +${generation}` : `Gen ${generation}`;
      return `${label} (${genLabel})`;
    }
    return label;
  };

  const getRelationshipColor = (relationship?: RelationshipType): 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error' => {
    if (!relationship) return 'primary';
    const colors: Partial<Record<RelationshipType, 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error'>> = {
      [RelationshipType.PARENT]: 'info',
      [RelationshipType.CHILD]: 'success',
      [RelationshipType.SIBLING]: 'warning',
      [RelationshipType.SPOUSE]: 'error',
      [RelationshipType.GRANDPARENT]: 'secondary',
      [RelationshipType.GRANDCHILD]: 'success',
      [RelationshipType.AUNT_UNCLE]: 'info',
      [RelationshipType.NIECE_NEPHEW]: 'warning',
      [RelationshipType.COUSIN]: 'secondary'
    };
    return colors[relationship] || 'primary';
  };

  // Bento Grid Components
  const ProcessingProgressCard = () => (
    <Card sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gridColumn: isMobile ? '1 / -1' : 'span 1',
      gridRow: 'span 1'
    }}>
      <CardContent sx={{ flexGrow: 1, p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Avatar sx={{ bgcolor: 'primary.main', width: 32, height: 32 }}>
            <ProcessIcon sx={{ fontSize: 18 }} />
          </Avatar>
          <Typography variant="h6" fontWeight={600}>
            Processing Progress
          </Typography>
        </Box>

        {!isInitialized ? (
          <Box sx={{ textAlign: 'center', py: 3 }}>
            <PhotoLibraryIcon sx={{ fontSize: 36, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Ready to process images
            </Typography>
            <Button
              variant="contained"
              size="small"
              onClick={handleInitialize}
              disabled={isLoading}
              startIcon={isLoading ? undefined : <ProcessIcon />}
              sx={{ mt: 1 }}
            >
              {isLoading ? 'Initializing...' : 'Start Processing'}
            </Button>
          </Box>
        ) : (
          <Box>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              {processingStatus?.isProcessing
                ? `Processing: ${processingStatus.currentImage || 'Unknown'}`
                : `Complete! ${processingStatus?.facesDetected || 0} faces found`
              }
            </Typography>
            {processingStatus && processingStatus.progress > 0 && (
              <LinearProgress
                variant="determinate"
                value={processingStatus.progress}
                sx={{ height: 6, borderRadius: 3, mb: 1 }}
                color={processingStatus.currentStage === 'completed' ? 'success' : 'primary'}
              />
            )}
            <Typography variant="caption" color="text.secondary">
              {processingStatus?.progress.toFixed(1)}% complete
            </Typography>
          </Box>
        )}
      </CardContent>
    </Card>
  );

  const UntrackedFacesCard = () => (
    <Card sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gridColumn: isMobile ? '1 / -1' : 'span 2',
      gridRow: 'span 2'
    }}>
      <CardContent sx={{ flexGrow: 1, p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Avatar sx={{ bgcolor: 'warning.main', width: 32, height: 32 }}>
            <FaceIcon sx={{ fontSize: 18 }} />
          </Avatar>
          <Typography variant="h6" fontWeight={600}>
            Untracked Faces ({untrackedFaces.length})
          </Typography>
        </Box>

        {untrackedFaces.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <FaceIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No faces detected yet
            </Typography>
          </Box>
        ) : (
          <Grid container spacing={1}>
            {untrackedFaces.slice(0, 8).map((face, index) => (
              <Grid item xs={6} sm={3} key={face.id}>
                <Box
                  sx={{
                    position: 'relative',
                    width: '100%',
                    height: 80,
                    borderRadius: 1,
                    overflow: 'hidden',
                    bgcolor: 'background.default',
                    cursor: 'pointer',
                    '&:hover': { opacity: 0.8 }
                  }}
                  onClick={() => handleAddAsPerson(face)}
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
                  <Badge
                    badgeContent={`${face.appearanceCount}x`}
                    color="primary"
                    sx={{
                      position: 'absolute',
                      top: 2,
                      right: 2,
                      '& .MuiBadge-badge': {
                        fontSize: '0.6rem',
                        height: 16,
                        minWidth: 16
                      }
                    }}
                  />
                </Box>
              </Grid>
            ))}
            {untrackedFaces.length > 8 && (
              <Grid item xs={12}>
                <Typography variant="caption" color="text.secondary" align="center" sx={{ display: 'block', mt: 1 }}>
                  +{untrackedFaces.length - 8} more faces
                </Typography>
              </Grid>
            )}
          </Grid>
        )}
      </CardContent>
    </Card>
  );

  const AddedPeopleCard = () => (
    <Card sx={{
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      gridColumn: isMobile ? '1 / -1' : 'span 1',
      gridRow: 'span 2'
    }}>
      <CardContent sx={{ flexGrow: 1, p: 3 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
          <Avatar sx={{ bgcolor: 'success.main', width: 32, height: 32 }}>
            <PeopleIcon sx={{ fontSize: 18 }} />
          </Avatar>
          <Typography variant="h6" fontWeight={600}>
            Added People ({peopleWithRelationships.length})
          </Typography>
        </Box>

        {peopleWithRelationships.length === 0 ? (
          <Box sx={{ textAlign: 'center', py: 4 }}>
            <PersonIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 1 }} />
            <Typography variant="body2" color="text.secondary">
              No people added yet
            </Typography>
          </Box>
        ) : (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            {peopleWithRelationships.slice(0, 5).map((person) => (
              <Paper
                key={person.id}
                sx={{
                  p: 1.5,
                  cursor: 'pointer',
                  transition: 'all 0.2s ease',
                  '&:hover': {
                    bgcolor: alpha(theme.palette.primary.main, 0.05),
                    transform: 'translateX(2px)'
                  }
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                  <Avatar
                    sx={{
                      width: 24,
                      height: 24,
                      bgcolor: person.isAdmin ? 'primary.main' : getRelationshipColor(person.relationshipToAdmin) + '.main',
                      fontSize: 12
                    }}
                  >
                    <PersonIcon sx={{ fontSize: 12 }} />
                  </Avatar>
                  <Box sx={{ flexGrow: 1, minWidth: 0 }}>
                    <Typography variant="body2" fontWeight={500} noWrap>
                      {person.name || `Person ${person.id.split('_')[1]}`}
                    </Typography>
                    {person.relationshipToAdmin && (
                      <Chip
                        label={getRelationshipLabel(person.relationshipToAdmin, person.generation)}
                        size="small"
                        color={getRelationshipColor(person.relationshipToAdmin)}
                        variant="outlined"
                        sx={{ height: 16, fontSize: '0.6rem', '& .MuiChip-label': { px: 0.5 } }}
                      />
                    )}
                  </Box>
                  <Typography variant="caption" color="text.secondary">
                    {person.faceIds.length}
                  </Typography>
                </Box>
              </Paper>
            ))}
            {peopleWithRelationships.length > 5 && (
              <Typography variant="caption" color="text.secondary" align="center" sx={{ mt: 1 }}>
                +{peopleWithRelationships.length - 5} more people
              </Typography>
            )}
          </Box>
        )}
      </CardContent>
    </Card>
  );

  return (
    <Container maxWidth="xl" sx={{ py: 2 }}>
      {/* Page Header */}
      <Box sx={{ mb: 3 }}>
        <Typography variant="h4" fontWeight={600} gutterBottom>
          People
        </Typography>
        <Typography variant="body1" color="text.secondary">
          Manage faces, people, and family relationships from your photos
        </Typography>
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

      {/* Bento Grid Layout */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gridTemplateRows: isMobile ? 'auto' : 'repeat(2, minmax(300px, auto))',
          gap: 2,
          minHeight: '600px'
        }}
      >
        <ProcessingProgressCard />
        <UntrackedFacesCard />
        <AddedPeopleCard />
      </Box>
    </Container>
  );
};

export default PeoplePage;