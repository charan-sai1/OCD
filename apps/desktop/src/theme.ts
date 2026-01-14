import { createTheme } from '@mui/material/styles';

// Extend the theme to include Material Design 3 color tokens
declare module '@mui/material/styles' {
  interface Palette {
    surfaceContainerLow: string;
    surfaceContainerLowest: string;
    onSurfaceVariant: string;
    surfaceTint: string;
  }
  interface PaletteOptions {
    surfaceContainerLow?: string;
    surfaceContainerLowest?: string;
    onSurfaceVariant?: string;
    surfaceTint?: string;
  }
}

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#f5f5f5',
    },
    secondary: {
      main: '#1a1a1a',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
    text: {
      primary: '#f5f5f5',
      secondary: '#e0e0e0',
    },
    // Material Design 3 color tokens
    surfaceContainerLow: '#1e1e1e',
    surfaceContainerLowest: '#121212',
    onSurfaceVariant: '#c4c7c5',
    surfaceTint: '#f5f5f5',
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 300,
      letterSpacing: '-0.01562em',
    },
    h6: {
      fontWeight: 400,
      letterSpacing: '0.00735em',
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          textTransform: 'none',
          fontWeight: 500,
        },
        contained: {
          boxShadow: 'none',
          '&:hover': {
            boxShadow:
              '0px 2px 4px -1px rgba(0,0,0,0.2), 0px 4px 5px 0px rgba(0,0,0,0.14), 0px 1px 10px 0px rgba(0,0,0,0.12)',
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: 'none',
          border: '1px solid rgba(255,255,255,0.12)',
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          '& .MuiOutlinedInput-root': {
            borderRadius: 16,
          },
        },
      },
    },
    MuiDrawer: {
      styleOverrides: {
        root: {
          '& .MuiDrawer-paper': {
            backgroundColor: '#1e1e1e',
            borderRadius: '0 16px 16px 0',
            border: 'none',
            boxShadow: '0px 1px 4px 0px rgba(0, 0, 0, 0.12), 0px 1px 2px 0px rgba(0, 0, 0, 0.08)',
          },
        },
      },
    },
    MuiListItemButton: {
      styleOverrides: {
        root: {
          borderRadius: 28,
          margin: '4px 12px',
          padding: '8px 12px',
          '&.Mui-selected': {
            backgroundColor: 'rgba(245, 245, 245, 0.08)',
            '&:hover': {
              backgroundColor: 'rgba(245, 245, 245, 0.12)',
            },
            '& .MuiListItemText-primary': {
              color: '#f5f5f5',
              fontWeight: 500,
            },
          },
          '&:hover': {
            backgroundColor: 'rgba(245, 245, 245, 0.04)',
          },
        },
      },
    },
  },
});
