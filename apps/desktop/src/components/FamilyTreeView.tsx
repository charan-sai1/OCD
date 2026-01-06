// apps/desktop/src/components/FamilyTreeView.tsx
// Simplified family tree visualization component

import React from 'react';
import {
  Box,
  Paper,
  Typography,
  Chip,
} from '@mui/material';
import {
  AccountTree as TreeIcon,
  Person as PersonIcon,
} from '@mui/icons-material';
import { useFaceRecognition } from '../hooks/useFaceRecognition';

const FamilyTreeView: React.FC = () => {
  const { people } = useFaceRecognition();

  return (
    <Box sx={{ p: 3 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
        <TreeIcon />
        <Typography variant="h5">Family Tree</Typography>
      </Box>

      <Paper sx={{ p: 3, textAlign: 'center' }}>
        <TreeIcon sx={{ fontSize: 48, color: 'text.secondary', mb: 2 }} />
        <Typography variant="h6" gutterBottom>
          Family Tree Visualization
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Advanced family tree features are coming soon. Currently showing {people.length} people.
        </Typography>

        {people.length > 0 && (
          <Box sx={{ mt: 3 }}>
            <Typography variant="subtitle2" gutterBottom>
              Detected People:
            </Typography>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 1, justifyContent: 'center' }}>
              {people.slice(0, 10).map((person) => (
                <Chip
                  key={person.id}
                  icon={<PersonIcon />}
                  label={person.name || `Person ${person.id.split('_')[1]}`}
                  variant="outlined"
                />
              ))}
              {people.length > 10 && (
                <Chip label={`+${people.length - 10} more`} variant="outlined" />
              )}
            </Box>
          </Box>
        )}
      </Paper>
    </Box>
  );
};

export default FamilyTreeView;