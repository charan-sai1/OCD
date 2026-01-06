// apps/desktop/src/components/AddedPeopleView.tsx
// Shows added people with relationships to the admin user

import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  Card,
  CardContent,
  Grid,
  Typography,
  Avatar,
  Chip,
  Paper,
  IconButton,
  Tooltip,
  useTheme,
  alpha,
  Container
} from '@mui/material';
import {
  People as PeopleIcon,
  Person as PersonIcon,
  Edit as EditIcon,
  Add as AddIcon,
  FamilyRestroom as FamilyIcon,
  Cake as BirthdayIcon
} from '@mui/icons-material';
import { useFaceRecognition, PersonGroup } from '../hooks/useFaceRecognition';
import { RelationshipType } from '../../../../shared-backend/core/types';

interface PersonWithRelationship extends PersonGroup {
  relationshipToAdmin?: RelationshipType;
  generation?: number;
  birthDate?: string;
  isAdmin?: boolean;
}

const AddedPeopleView: React.FC = () => {
  const theme = useTheme();
  const { people } = useFaceRecognition();

  const [peopleWithRelationships, setPeopleWithRelationships] = useState<PersonWithRelationship[]>([]);

  useEffect(() => {
    // Mock relationship data - in real implementation, this would come from the database
    const mockRelationships: PersonWithRelationship[] = people.map((person, index) => ({
      ...person,
      relationshipToAdmin: index === 0 ? undefined : // First person is admin
        Object.values(RelationshipType)[index % Object.values(RelationshipType).length],
      generation: index === 0 ? 0 : Math.floor(index / 3) - 1, // Spread across generations
      birthDate: index > 0 ? new Date(1990 + index * 2, index % 12, 15).toISOString() : undefined
    }));

    setPeopleWithRelationships(mockRelationships);
  }, [people]);

  const getAdminUser = () => peopleWithRelationships.find(p => p.isAdmin);
  const getNonAdminPeople = () => peopleWithRelationships.filter(p => !p.isAdmin);

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
    if (!relationship) return 'primary'; // Admin

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

  const AdminCard = ({ person }: { person: PersonWithRelationship }) => (
    <Card sx={{ mb: 3, border: `2px solid ${theme.palette.primary.main}`, bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
      <CardContent>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar
            sx={{
              width: 64,
              height: 64,
              bgcolor: 'primary.main',
              fontSize: 32
            }}
          >
            <PersonIcon />
          </Avatar>
          <Box sx={{ flexGrow: 1 }}>
            <Typography variant="h5" fontWeight={600} color="primary.main">
              {person.name || 'You'}
            </Typography>
            <Typography variant="body1" color="primary.main">
              Family Admin
            </Typography>
            {person.birthDate && (
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 1 }}>
                <BirthdayIcon sx={{ fontSize: 16, color: 'text.secondary' }} />
                <Typography variant="body2" color="text.secondary">
                  {new Date(person.birthDate).toLocaleDateString()}
                </Typography>
              </Box>
            )}
          </Box>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
            <Tooltip title="Edit profile">
              <IconButton size="small">
                <EditIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>
      </CardContent>
    </Card>
  );

  const PersonCard = ({ person }: { person: PersonWithRelationship }) => (
    <Paper
      sx={{
        p: 2,
        mb: 1,
        cursor: 'pointer',
        transition: 'all 0.2s ease',
        '&:hover': {
          bgcolor: alpha(theme.palette.primary.main, 0.02),
          transform: 'translateX(4px)'
        }
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
        <Avatar
          sx={{
            width: 48,
            height: 48,
            bgcolor: `${getRelationshipColor(person.relationshipToAdmin)}.main`
          }}
        >
          <PersonIcon />
        </Avatar>
        <Box sx={{ flexGrow: 1 }}>
          <Typography variant="subtitle1" fontWeight={500}>
            {person.name || `Person ${person.id.split('_')[1]}`}
          </Typography>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mt: 0.5 }}>
            <Chip
              label={getRelationshipLabel(person.relationshipToAdmin, person.generation)}
              size="small"
              color={getRelationshipColor(person.relationshipToAdmin)}
              variant="outlined"
            />
            {person.birthDate && (
              <>
                <Typography variant="body2" color="text.secondary">•</Typography>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <BirthdayIcon sx={{ fontSize: 14, color: 'text.secondary' }} />
                  <Typography variant="body2" color="text.secondary">
                    {new Date(person.birthDate).getFullYear()}
                  </Typography>
                </Box>
              </>
            )}
          </Box>
        </Box>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Chip
            label={`${person.faceIds.length} face${person.faceIds.length !== 1 ? 's' : ''}`}
            size="small"
            variant="filled"
            sx={{ bgcolor: alpha(theme.palette.secondary.main, 0.1) }}
          />
          <Tooltip title="Edit person">
            <IconButton size="small">
              <EditIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>
    </Paper>
  );

  const admin = getAdminUser();
  const otherPeople = getNonAdminPeople();

  return (
    <Container maxWidth="lg" sx={{ py: 2 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 4 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2 }}>
          <Avatar sx={{ bgcolor: 'primary.main' }}>
            <PeopleIcon />
          </Avatar>
          <Box>
            <Typography variant="h4" fontWeight={600}>
              My People
            </Typography>
            <Typography variant="body1" color="text.secondary">
              Family members and their relationships
            </Typography>
          </Box>
        </Box>
        <Button
          variant="contained"
          startIcon={<AddIcon />}
          onClick={() => console.log('Add new person')}
        >
          Add Person
        </Button>
      </Box>

      <Grid container spacing={3}>
        {/* Admin User */}
        <Grid item xs={12}>
          {admin ? (
            <AdminCard person={admin} />
          ) : (
            <Card sx={{ mb: 3, border: '2px dashed', borderColor: 'primary.main', bgcolor: alpha(theme.palette.primary.main, 0.05) }}>
              <CardContent sx={{ textAlign: 'center', py: 4 }}>
                <PersonIcon sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" color="primary.main" gutterBottom>
                  Set Up Your Profile
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                  Add yourself as the family admin to start building your family tree.
                </Typography>
                <Button variant="contained" startIcon={<AddIcon />}>
                  Add Yourself
                </Button>
              </CardContent>
            </Card>
          )}
        </Grid>

        {/* Family Members */}
        <Grid item xs={12}>
          <Card>
            <CardContent>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <FamilyIcon color="primary" />
                <Typography variant="h6" fontWeight={600}>
                  Family Members ({otherPeople.length})
                </Typography>
              </Box>

              {otherPeople.length === 0 ? (
                <Box sx={{ textAlign: 'center', py: 6 }}>
                  <FamilyIcon sx={{ fontSize: 64, color: 'text.secondary', mb: 2 }} />
                  <Typography variant="h6" color="text.secondary" gutterBottom>
                    No Family Members Added Yet
                  </Typography>
                  <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
                    Add people from untracked faces to start building your family tree.
                  </Typography>
                  <Button variant="outlined" startIcon={<AddIcon />}>
                    Add from Faces
                  </Button>
                </Box>
              ) : (
                <Box>
                  {otherPeople.map((person) => (
                    <PersonCard key={person.id} person={person} />
                  ))}
                </Box>
              )}
            </CardContent>
          </Card>
        </Grid>
      </Grid>
    </Container>
  );
};

export default AddedPeopleView;