import React, { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import {
  Box,
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Button,
  Tooltip,
  Divider,
  CircularProgress,
  useTheme,
} from '@mui/material';
import {
  Brightness4,
  Brightness7,
  AutoAwesome,
  CloudUpload,
  Share,
  Delete,
  Download,
  SelectAll,
  PhotoLibrary,
  FolderOpen,
  Refresh,
  Image as ImageIcon,
  VideoLibrary,
  Error as ErrorIcon,
} from '@mui/icons-material';
import { useTheme as useOCDTheme } from '@ocd/ui';
import { TauriService } from '@ocd/core';
import { Sidebar } from './components/sidebar';
import { PhotoGrid } from './components/gallery';
import { SearchBar } from './components/search';
import { OrganizeDialog } from './components/organize';
import { ImportDialog } from './components/import';
import type { FolderInfo, CollectionInfo, PhotoInfo } from '@ocd/core';

const PhotoViewer = lazy(() => import('./components/viewer').then(module => ({ default: module.PhotoViewer })));

// Check for Tauri at runtime
const checkIsTauri = () => {
  try {
    return !!(window as any).__TAURI__;
  } catch {
    return false;
  }
};

interface AppState {
  folders: FolderInfo[];
  collections: CollectionInfo[];
  photos: PhotoInfo[];
  activeFolder: string | null;
  activeCollection: string | null;
  loading: boolean;
  error: string | null;
}

const App: React.FC = () => {
  const theme = useTheme();
  const { mode, toggleColorMode } = useOCDTheme();
  
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [activeSection, setActiveSection] = useState('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [selectionMode, setSelectionMode] = useState(false);
  const [organizeOpen, setOrganizeOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerPhoto, setViewerPhoto] = useState<PhotoInfo | null>(null);
  const [isTauri, setIsTauri] = useState(false);
  
  const [state, setState] = useState<AppState>({
    folders: [],
    collections: [],
    photos: [],
    activeFolder: null,
    activeCollection: null,
    loading: false,
    error: null,
  });

  useEffect(() => {
    setIsTauri(!!(window as any).__TAURI__);
  }, []);

  const loadPhotos = useCallback(async (folderId?: string | null, collectionId?: string | null, search?: string) => {
    setState(prev => ({ ...prev, loading: true }));
    
    if (!isTauri) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }
    
    try {
      let result;
      
      if (collectionId) {
        result = await TauriService.getPhotosInCollection(collectionId);
      } else if (search) {
        const photos = await TauriService.searchPhotos(search, 500);
        result = {
          photos,
          total_count: photos.length,
          has_more: false,
        };
      } else {
        result = await TauriService.getPhotos(folderId || undefined);
      }
      
      setState(prev => ({
        ...prev,
        photos: result.photos,
        loading: false,
        activeFolder: folderId ?? null,
        activeCollection: collectionId ?? null,
        error: null,
      }));
    } catch (error) {
      console.error('Failed to load photos:', error);
      setState(prev => ({ ...prev, loading: false, error: 'Failed to load photos' }));
    }
  }, []);

  const loadInitialData = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }));
    
    if (!isTauri) {
      setState(prev => ({ ...prev, loading: false }));
      return;
    }
    
    try {
      const homeDir = await import('@tauri-apps/api/core').then(m => m.homeDir());
      const commonPaths = [
        `${homeDir}/Pictures`,
        `${homeDir}/Downloads`,
        `${homeDir}/Desktop`,
        `${homeDir}/Pictures/WhatsApp`,
      ];
      
      const validFolders: string[] = [];
      for (const path of commonPaths) {
        try {
          const exists = await TauriService.getFileList(path, false)
            .then(files => files.count > 0)
            .catch(() => false);
          if (exists) {
            validFolders.push(path);
          }
        } catch {
          // Folder doesn't exist, skip
        }
      }
      
      if (validFolders.length === 0) {
        validFolders.push(`${homeDir}/Pictures`);
      }
      
      await TauriService.completeOnboarding(validFolders);
      
      const [folders, collections] = await Promise.all([
        TauriService.getFolders(),
        TauriService.getCollections(),
      ]);
      
      setState(prev => ({
        ...prev,
        folders,
        collections,
        loading: false,
        error: null,
      }));
      
      await loadPhotos();
    } catch (error) {
      console.error('Failed to load initial data:', error);
      setState(prev => ({ ...prev, loading: false, error: 'Failed to initialize. Make sure you\'re running in Tauri app, not browser.' }));
    }
  }, [loadPhotos]);

  const handleSectionClick = useCallback(async (sectionId: string) => {
    setActiveSection(sectionId);
    
    if (sectionId === 'all') {
      await loadPhotos(null, null, searchQuery || undefined);
    } else if (sectionId.startsWith('collection:')) {
      const collectionId = sectionId.replace('collection:', '');
      await loadPhotos(null, collectionId);
    }
  }, [loadPhotos, searchQuery]);

  useEffect(() => {
    loadInitialData();
  }, [loadInitialData]);

  const handlePhotoClick = useCallback((photo: PhotoInfo) => {
    if (selectionMode) {
      const newSelected = new Set(selectedPhotos);
      if (newSelected.has(photo.id)) {
        newSelected.delete(photo.id);
      } else {
        newSelected.add(photo.id);
      }
      setSelectedPhotos(newSelected);
    }
  }, [selectionMode, selectedPhotos]);

  const handlePhotoDoubleClick = useCallback((photo: PhotoInfo) => {
    setViewerPhoto(photo);
    setViewerOpen(true);
  }, []);

  const handleViewerClose = useCallback(() => {
    setViewerOpen(false);
    setViewerPhoto(null);
  }, []);

  const handleViewerNavigate = useCallback((direction: 'prev' | 'next') => {
    if (!viewerPhoto) return;
    const currentIndex = state.photos.findIndex((p) => p.id === viewerPhoto.id);
    let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0) newIndex = state.photos.length - 1;
    if (newIndex >= state.photos.length) newIndex = 0;
    setViewerPhoto(state.photos[newIndex]);
  }, [viewerPhoto, state.photos]);

  const handleSelectionChange = useCallback((ids: Set<string>) => {
    setSelectedPhotos(ids);
    setSelectionMode(ids.size > 0);
  }, []);

  const handleClearSelection = useCallback(() => {
    setSelectedPhotos(new Set());
    setSelectionMode(false);
  }, []);

  const gridPhotos = state.photos.map(p => ({
    id: p.id,
    thumbnail: p.path,
    fullPath: p.path,
    name: p.path.split('/').pop() || 'Unknown',
    date: new Date(parseInt(p.date_modified) * 1000),
    type: p.file_type as 'image' | 'video',
    width: p.width || 1920,
    height: p.height || 1080,
    size: p.file_size,
  }));

  const sidebarCollections = state.collections.map(c => ({
    id: `collection:${c.id}`,
    label: c.name,
    icon: c.icon === 'screenshot' ? <ImageIcon /> : 
          c.icon === 'chat' ? <PhotoLibrary /> : 
          c.icon === 'movie' ? <VideoLibrary /> : <PhotoLibrary />,
    badge: c.photo_count,
  }));

  return (
    <Box sx={{ display: 'flex', height: '100vh', bgcolor: 'background.default' }}>
      <Sidebar
        collapsed={sidebarCollapsed}
        onCollapse={setSidebarCollapsed}
        activeItem={activeSection}
        onItemClick={handleSectionClick}
        collections={sidebarCollections}
        folders={state.folders}
      />

      <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <AppBar
          position="static"
          elevation={0}
          sx={{
            bgcolor: 'background.paper',
            borderBottom: 1,
            borderColor: 'divider',
          }}
        >
          <Toolbar>
            <Box sx={{ flex: 1, display: 'flex', alignItems: 'center', gap: 2 }}>
              <SearchBar
                value={searchQuery}
                onChange={setSearchQuery}
                placeholder="Search photos..."
                onSearch={() => loadPhotos(null, null, searchQuery || undefined)}
              />
            </Box>

            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Tooltip title="Refresh">
                <IconButton onClick={() => loadPhotos(state.activeFolder, state.activeCollection)}>
                  <Refresh />
                </IconButton>
              </Tooltip>

              <Tooltip title="Organize photos">
                <Button
                  variant="outlined"
                  startIcon={<AutoAwesome />}
                  onClick={() => setOrganizeOpen(true)}
                  sx={{ mr: 1 }}
                >
                  Organize
                </Button>
              </Tooltip>

              <Tooltip title="Import from device">
                <Button
                  variant="contained"
                  startIcon={<CloudUpload />}
                  onClick={() => setImportOpen(true)}
                >
                  Import
                </Button>
              </Tooltip>

              <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />

              <Tooltip title="Toggle theme">
                <IconButton onClick={toggleColorMode} color="inherit">
                  {mode === 'dark' ? <Brightness7 /> : <Brightness4 />}
                </IconButton>
              </Tooltip>
            </Box>
          </Toolbar>
        </AppBar>

        {selectionMode && (
          <Box
            sx={{
              bgcolor: theme.palette.primary.main,
              color: theme.palette.primary.contrastText,
              px: 2,
              py: 1,
              display: 'flex',
              alignItems: 'center',
            }}
          >
            <Typography variant="subtitle1" sx={{ flex: 1 }}>
              {selectedPhotos.size} selected
            </Typography>
            <Tooltip title="Select all">
              <IconButton
                sx={{ color: 'inherit' }}
                onClick={() => {
                  if (selectedPhotos.size === gridPhotos.length) {
                    handleClearSelection();
                  } else {
                    setSelectedPhotos(new Set(gridPhotos.map((p) => p.id)));
                    setSelectionMode(true);
                  }
                }}
              >
                <SelectAll />
              </IconButton>
            </Tooltip>
            <Tooltip title="Share">
              <IconButton sx={{ color: 'inherit' }}>
                <Share />
              </IconButton>
            </Tooltip>
            <Tooltip title="Download">
              <IconButton sx={{ color: 'inherit' }}>
                <Download />
              </IconButton>
            </Tooltip>
            <Tooltip title="Delete">
              <IconButton sx={{ color: 'inherit' }}>
                <Delete />
              </IconButton>
            </Tooltip>
          </Box>
        )}

        <Box
          sx={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
          }}
        >
          {state.error ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <ErrorIcon sx={{ fontSize: 64, color: 'error.main' }} />
              <Typography variant="h6" color="error">
                Error
              </Typography>
              <Typography color="text.secondary">
                {state.error}
              </Typography>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={() => loadInitialData()}
                sx={{ mt: 2 }}
              >
                Retry
              </Button>
            </Box>
          ) : state.loading ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <CircularProgress />
              <Typography color="text.secondary">
                Loading photos...
              </Typography>
            </Box>
          ) : gridPhotos.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 }}>
              <FolderOpen sx={{ fontSize: 64, color: 'text.secondary' }} />
              <Typography variant="h6" color="text.secondary">
                No photos found
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Add photos to ~/Pictures, ~/Downloads, or ~/Desktop
              </Typography>
              <Button
                variant="contained"
                startIcon={<Refresh />}
                onClick={() => loadPhotos()}
                sx={{ mt: 2 }}
              >
                Refresh
              </Button>
            </Box>
          ) : (
            <PhotoGrid
              photos={gridPhotos}
              selectionMode={selectionMode}
              selectedIds={selectedPhotos}
              onSelectionChange={handleSelectionChange}
              onPhotoClick={handlePhotoClick}
              onPhotoDoubleClick={handlePhotoDoubleClick}
              onPhotoOpen={handlePhotoDoubleClick}
              columns={5}
            />
          )}
        </Box>
      </Box>

      <OrganizeDialog
        open={organizeOpen}
        onClose={() => setOrganizeOpen(false)}
        onOrganize={(rules) => console.log('Organizing with rules:', rules)}
        photoCount={gridPhotos.length}
      />

      <ImportDialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        onImport={(deviceId, options) => console.log('Importing from device:', deviceId, options)}
      />

      {viewerOpen && viewerPhoto && (
        <Suspense fallback={<Box sx={{ position: 'fixed', inset: 0, bgcolor: 'rgba(0,0,0,0.9)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><CircularProgress /></Box>}>
          <PhotoViewer
            photo={gridPhotos.find(p => p.id === viewerPhoto?.id) || viewerPhoto}
            photos={gridPhotos}
            onClose={handleViewerClose}
            onNavigate={handleViewerNavigate}
            onShare={(photo) => console.log('Share:', photo.id)}
            onDownload={(photo) => console.log('Download:', photo.id)}
            onDelete={(photo) => console.log('Delete:', photo.id)}
            onAddToAlbum={(photo) => console.log('Add to album:', photo.id)}
          />
        </Suspense>
      )}
    </Box>
  );
};

export default App;
