import React, { useState, useEffect, useRef } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Breadcrumbs from "@mui/material/Breadcrumbs";
import Link from "@mui/material/Link";
import CircularProgress from "@mui/material/CircularProgress";
import {
  Folder as FolderIcon,
  ArrowBack as ArrowBackIcon,
  Check as CheckIcon,
  Close as CloseIcon,
  FolderOpen as FolderOpenIcon,
} from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";

interface Device {
  name: string;
  mount_point: string;
  device_type: string;
  total_space?: number;
  available_space?: number;
}

interface FolderItem {
  name: string;
  path: string;
  is_directory: boolean;
}

interface FolderSelectionDialogProps {
  open: boolean;
  onClose: () => void;
  device: Device | null;
  onFolderSelect: (folderPath: string) => void;
}

const FolderSelectionDialog: React.FC<FolderSelectionDialogProps> = ({
  open,
  onClose,
  device,
  onFolderSelect,
}) => {
  const [currentPath, setCurrentPath] = useState<string>("");
  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedFolder, setSelectedFolder] = useState<string | null>(null);
  
  const abortControllerRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
    };
  }, []);

  useEffect(() => {
    if (open && device) {
      setCurrentPath(device.mount_point);
      setPathHistory([device.mount_point]);
      setSelectedFolder(null);
      loadFolders(device.mount_point);
    } else {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      setCurrentPath("");
      setFolders([]);
      setPathHistory([]);
      setSelectedFolder(null);
    }
  }, [open, device]);

  const loadFolders = async (path: string) => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    abortControllerRef.current = new AbortController();
    
    try {
      setLoading(true);
      const directoryContents: string[] = await invoke("read_directory", {
        path,
      });

      if (!isMountedRef.current || abortControllerRef.current.signal.aborted) {
        return;
      }

      // Convert to FolderItem format - assume all items are directories for now
      // We'll handle the error if user tries to navigate into a file
      const folderItems: FolderItem[] = directoryContents
        .map((itemPath: string) => {
          const name = itemPath.split("/").pop() || itemPath.split("\\").pop() || itemPath;
          // For now, assume everything is a directory
          // If it's not, the navigation will fail gracefully
          return {
            name,
            path: itemPath,
            is_directory: true,
          };
        })
        .sort((a, b) => a.name.localeCompare(b.name));

      setFolders(folderItems);
    } catch (error) {
      if (!isMountedRef.current || abortControllerRef.current?.signal.aborted) {
        return;
      }
      console.error("Error loading folders:", error);
      setFolders([]);
    } finally {
      if (isMountedRef.current && !abortControllerRef.current?.signal.aborted) {
        setLoading(false);
      }
    }
  };

  const handleFolderClick = async (folder: FolderItem) => {
    if (loading) return;
    
    const newPath = folder.path;
    try {
      setPathHistory(prev => [...prev, newPath]);
      setCurrentPath(newPath);
      await loadFolders(newPath);
    } catch (error) {
      console.error("Cannot navigate to:", folder.path, error);
      setPathHistory(prev => prev.slice(0, -1));
      setCurrentPath(prev => prev);
    }
  };

  const handleBreadcrumbClick = async (clickedPath: string, index: number) => {
    if (loading) return;
    
    try {
      setPathHistory(prev => prev.slice(0, index + 1));
      setCurrentPath(clickedPath);
      await loadFolders(clickedPath);
    } catch (error) {
      console.error("Cannot navigate to:", clickedPath, error);
      setCurrentPath(prev => prev);
    }
  };

  const goBack = async () => {
    if (loading || pathHistory.length <= 1) return;
    
    const previousPath = pathHistory[pathHistory.length - 2];
    try {
      setPathHistory(prev => prev.slice(0, -1));
      setCurrentPath(previousPath);
      await loadFolders(previousPath);
    } catch (error) {
      console.error("Cannot go back:", error);
    }
  };

  const handleSelectFolder = () => {
    if (selectedFolder) {
      onFolderSelect(selectedFolder);
      onClose();
    }
  };

  const handleCurrentFolderSelect = () => {
    setSelectedFolder(currentPath);
  };

  const getDisplayPath = (path: string) => {
    if (!device) return path;
    if (path === device.mount_point) {
      return device.name || "Root";
    }
    return path.split("/").pop() || path.split("\\").pop() || path;
  };

  if (!device) return null;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      TransitionProps={{
        timeout: 300,
      }}
      sx={{
        "& .MuiDialog-paper": {
          borderRadius: 3,
          backgroundColor: "background.paper",
          minHeight: "500px",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <FolderOpenIcon />
          <Typography variant="h6">
            Select Import Folder - {device.name || device.mount_point}
          </Typography>
        </Box>
        <IconButton
          onClick={onClose}
          sx={{
            color: "text.secondary",
            "&:hover": {
              backgroundColor: "action.hover",
            },
          }}
        >
          <CloseIcon />
        </IconButton>
      </DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        {/* Current folder selection */}
        <Box sx={{ mb: 2, p: 2, backgroundColor: "action.hover", borderRadius: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <Box>
              <Typography variant="body2" sx={{ mb: 0.5, fontWeight: 500 }}>
                Current Folder:
              </Typography>
              <Typography variant="body2" color="text.secondary" sx={{ fontFamily: "monospace" }}>
                {currentPath}
              </Typography>
            </Box>
            <Button
              variant={selectedFolder === currentPath ? "contained" : "outlined"}
              size="small"
              onClick={handleCurrentFolderSelect}
              startIcon={selectedFolder === currentPath ? <CheckIcon /> : undefined}
              sx={{ borderRadius: 20, textTransform: "none" }}
            >
              {selectedFolder === currentPath ? "Selected" : "Select This Folder"}
            </Button>
          </Box>
        </Box>

        {/* Breadcrumb navigation */}
        <Box sx={{ mb: 2 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 1 }}>
            <IconButton
              size="small"
              onClick={goBack}
              disabled={loading || pathHistory.length <= 1}
              sx={{
                color: "primary.main",
                "&:hover": {
                  backgroundColor: "action.hover",
                },
              }}
            >
              <ArrowBackIcon fontSize="small" />
            </IconButton>
            <Breadcrumbs maxItems={4}>
              {pathHistory.map((path, index) => (
                <Link
                  key={path}
                  component="button"
                  variant="body2"
                  onClick={() => handleBreadcrumbClick(path, index)}
                  sx={{
                    color:
                      index === pathHistory.length - 1
                        ? "text.primary"
                        : "primary.main",
                    textDecoration: "none",
                    "&:hover": {
                      textDecoration:
                        index !== pathHistory.length - 1 ? "underline" : "none",
                    },
                  }}
                >
                  {getDisplayPath(path)}
                </Link>
              ))}
            </Breadcrumbs>
          </Box>
        </Box>

        {/* Folder list */}
        <Box sx={{ maxHeight: "300px", overflowY: "auto" }}>
          {loading ? (
            <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
              <CircularProgress size={40} />
            </Box>
          ) : (
            <List sx={{ pt: 0 }}>
              {folders.map((folder) => (
                <ListItem key={folder.path} disablePadding>
                  <ListItemButton
                    onClick={() => handleFolderClick(folder)}
                    sx={{
                      borderRadius: 1,
                      mb: 0.5,
                      "&:hover": {
                        backgroundColor: "action.hover",
                      },
                    }}
                  >
                    <ListItemIcon sx={{ color: "warning.main", minWidth: 40 }}>
                      <FolderIcon />
                    </ListItemIcon>
                    <ListItemText
                      primary={folder.name}
                      secondary="Folder"
                    />
                  </ListItemButton>
                </ListItem>
              ))}
              {folders.length === 0 && !loading && (
                <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
                  <FolderIcon sx={{ fontSize: 48, mb: 1, opacity: 0.5 }} />
                  <Typography variant="body2">
                    No subfolders found in this directory
                  </Typography>
                </Box>
              )}
            </List>
          )}
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 1 }}>
        <Button
          onClick={onClose}
          variant="outlined"
          sx={{
            borderRadius: 20,
            textTransform: "none",
          }}
        >
          Cancel
        </Button>
        <Button
          onClick={handleSelectFolder}
          variant="contained"
          disabled={!selectedFolder}
          sx={{
            borderRadius: 20,
            textTransform: "none",
          }}
        >
          Import from Selected Folder
        </Button>
      </DialogActions>
    </Dialog>
  );
};

export default FolderSelectionDialog;