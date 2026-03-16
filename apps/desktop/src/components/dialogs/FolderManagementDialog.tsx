import React, { useState } from "react";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import DialogContentText from "@mui/material/DialogContentText";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemSecondaryAction from "@mui/material/ListItemSecondaryAction";
import Tooltip from "@mui/material/Tooltip";
import LinearProgress from "@mui/material/LinearProgress";
import Chip from "@mui/material/Chip";
import Paper from "@mui/material/Paper";
import {
  FolderOpen as FolderOpenIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Close as CloseIcon,
  CheckCircle as CheckCircleIcon,
  Sync as SyncIcon,
  Image as ImageIcon,
  Error as ErrorIcon,
  AutoAwesome as AutoAwesomeIcon,
  PhotoLibrary as PhotoLibraryIcon,
} from "@mui/icons-material";

interface OptimizationState {
  isScanning: boolean;
  isGenerating: boolean;
  scanProgress: number;
  generationProgress: number;
  totalImages: number;
  processedImages: number;
  currentFile?: string;
  canMinimize: boolean;
  completedAt?: number;
}

interface FolderManagementDialogProps {
  open: boolean;
  onClose: () => void;
  directoryPaths: string[];
  onAddFolders: () => void;
  onRemoveDirectory: (path: string) => void;
  optimizationState?: OptimizationState;
}

const FolderManagementDialog: React.FC<FolderManagementDialogProps> = ({
  open,
  onClose,
  directoryPaths,
  onAddFolders,
  onRemoveDirectory,
  optimizationState,
}) => {
  const [confirmDelete, setConfirmDelete] = useState<{ open: boolean; path: string | null }>({
    open: false,
    path: null,
  });

  const defaultOptimizationState: OptimizationState = {
    isScanning: false,
    isGenerating: false,
    scanProgress: 0,
    generationProgress: 0,
    totalImages: 0,
    processedImages: 0,
    canMinimize: true,
  };

  const state = optimizationState || defaultOptimizationState;
  
  const isScanning = state.isScanning;
  const isGenerating = state.isGenerating;
  
  const RECENT_COMPLETION_THRESHOLD = 10000;
  const isRecentlyCompleted = state.completedAt !== undefined && 
    (Date.now() - state.completedAt) < RECENT_COMPLETION_THRESHOLD;
  
  const isComplete = !isScanning && !isGenerating && (isRecentlyCompleted || state.totalImages > 0 || state.processedImages > 0);
  const isWorking = isScanning || isGenerating;
  
  const overallProgress = isScanning 
    ? state.scanProgress 
    : isGenerating 
      ? state.generationProgress 
      : isComplete ? 100 : 0;

  const getFolderName = (path: string) => {
    return path.split("/").pop() || path.split("\\").pop() || path;
  };

  const handleDeleteClick = (path: string) => {
    setConfirmDelete({ open: true, path });
  };

  const handleConfirmDelete = () => {
    if (confirmDelete.path) {
      onRemoveDirectory(confirmDelete.path);
    }
    setConfirmDelete({ open: false, path: null });
  };

  const handleCancelDelete = () => {
    setConfirmDelete({ open: false, path: null });
  };

  const getStatusInfo = () => {
    if (isScanning) {
      return { color: "primary", label: "Scanning", icon: <SyncIcon />, spinning: true };
    }
    if (isGenerating) {
      return { color: "warning", label: "Processing", icon: <AutoAwesomeIcon />, spinning: true };
    }
    if (isComplete) {
      return { color: "success", label: "Ready", icon: <CheckCircleIcon />, spinning: false };
    }
    return { color: "default", label: "Ready", icon: <ImageIcon />, spinning: false };
  };

  const statusInfo = getStatusInfo();

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{
        timeout: 300,
      }}
      sx={{
        "& .MuiDialog-paper": {
          borderRadius: 3,
          backgroundColor: "background.paper",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.2)",
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
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
          <Box
            sx={{
              width: 40,
              height: 40,
              borderRadius: 2,
              backgroundColor: "primary.main",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <FolderOpenIcon sx={{ color: "primary.contrastText", fontSize: 22 }} />
          </Box>
          <Box>
            <Typography variant="h6" fontWeight={600}>
              Manage Folders
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {directoryPaths.length} folder{directoryPaths.length !== 1 ? "s" : ""} configured
            </Typography>
          </Box>
        </Box>
        <Chip
          icon={statusInfo.spinning ? <SyncIcon sx={{ animation: "spin 1s linear infinite", "@keyframes spin": { from: { transform: "rotate(0deg)" }, to: { transform: "rotate(360deg)" } } }} /> : statusInfo.icon}
          label={isWorking ? (isScanning ? "Scanning..." : "Processing...") : (isComplete ? "Complete" : "Ready")}
          size="small"
          color={statusInfo.color as any}
          variant="outlined"
        />
      </DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        {isWorking && (
          <Paper
            elevation={0}
            sx={{
              mb: 3,
              p: 2,
              backgroundColor: isGenerating ? "warning.main" : "primary.main",
              color: isGenerating ? "warning.contrastText" : "primary.contrastText",
              borderRadius: 2,
            }}
          >
            <Box sx={{ display: "flex", alignItems: "center", gap: 2, mb: 1 }}>
              <Box sx={{ flex: 1 }}>
                <Typography variant="body2" fontWeight={500}>
                  {isScanning 
                    ? `Scanning ${directoryPaths.length} folder${directoryPaths.length !== 1 ? "s" : ""}...` 
                    : `Processing ${state.processedImages} of ${state.totalImages} images`}
                </Typography>
                <Typography variant="caption" sx={{ opacity: 0.9 }}>
                  {isGenerating ? "Generating thumbnails..." : "Finding images in your folders"}
                </Typography>
              </Box>
              <Typography variant="h6" fontWeight={700}>
                {Math.round(overallProgress)}%
              </Typography>
            </Box>
            <LinearProgress
              variant="determinate"
              value={overallProgress}
              sx={{
                height: 6,
                borderRadius: 3,
                backgroundColor: "rgba(255,255,255,0.3)",
                "& .MuiLinearProgress-bar": {
                  borderRadius: 3,
                  backgroundColor: "white",
                },
              }}
            />
          </Paper>
        )}

        {isComplete && !isWorking && (
          <Paper
            elevation={0}
            sx={{
              mb: 3,
              p: 2,
              backgroundColor: "success.light",
              color: "success.contrastText",
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              gap: 2,
            }}
          >
            <CheckCircleIcon />
            <Box sx={{ flex: 1 }}>
              <Typography variant="body2" fontWeight={500}>
                All folders processed
              </Typography>
              <Typography variant="caption" sx={{ opacity: 0.9 }}>
                {state.totalImages} images ready to view
              </Typography>
            </Box>
          </Paper>
        )}

        {directoryPaths.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              py: 8,
              textAlign: "center",
            }}
          >
            <Box
              sx={{
                width: 100,
                height: 100,
                borderRadius: "50%",
                backgroundColor: "primary.light",
                opacity: 0.2,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 3,
              }}
            >
              <PhotoLibraryIcon sx={{ fontSize: 48, color: "primary.main", opacity: 0.5 }} />
            </Box>
            <Typography variant="h6" color="text.primary" sx={{ mb: 1, fontWeight: 600 }}>
              No folders added yet
            </Typography>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 4, maxWidth: 280 }}>
              Add folders containing your photos to start building your gallery
            </Typography>
            <Button
              variant="contained"
              startIcon={<AddIcon />}
              onClick={onAddFolders}
              size="large"
              sx={{
                borderRadius: 20,
                textTransform: "none",
                px: 4,
                py: 1.5,
                boxShadow: 2,
              }}
            >
              Add your first folder
            </Button>
          </Box>
        ) : (
          <List sx={{ pt: 0 }}>
            {directoryPaths.map((path) => (
              <ListItem
                key={path}
                sx={{
                  borderRadius: 2,
                  mb: 1.5,
                  backgroundColor: "background.default",
                  border: "1px solid",
                  borderColor: "divider",
                  transition: "all 0.2s ease",
                  "&:hover": {
                    backgroundColor: "action.hover",
                    borderColor: "primary.light",
                  },
                }}
              >
                <Box
                  sx={{
                    width: 40,
                    height: 40,
                    borderRadius: 1.5,
                    backgroundColor: "primary.main",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    mr: 2,
                  }}
                >
                  <FolderOpenIcon sx={{ color: "primary.contrastText", fontSize: 20 }} />
                </Box>
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Tooltip title={path} placement="top-start" arrow>
                    <Typography
                      variant="body1"
                      sx={{
                        fontWeight: 600,
                        color: "text.primary",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {getFolderName(path)}
                    </Typography>
                  </Tooltip>
                  <Tooltip title={path} placement="bottom-start" arrow>
                    <Typography
                      variant="caption"
                      sx={{
                        color: "text.secondary",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                        display: "block",
                      }}
                    >
                      {path}
                    </Typography>
                  </Tooltip>
                </Box>
                <ListItemSecondaryAction>
                  <Tooltip title="Remove folder">
                    <IconButton
                      edge="end"
                      onClick={() => handleDeleteClick(path)}
                      sx={{
                        color: "text.secondary",
                        "&:hover": {
                          backgroundColor: "error.main",
                          color: "error.contrastText",
                        },
                      }}
                    >
                      <DeleteIcon fontSize="small" />
                    </IconButton>
                  </Tooltip>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 0, gap: 1.5 }}>
        <Button
          onClick={onAddFolders}
          variant="outlined"
          startIcon={<AddIcon />}
          sx={{
            borderRadius: 20,
            textTransform: "none",
            "&:hover": {
              transform: "translateY(-1px)",
            },
          }}
        >
          {directoryPaths.length === 0 ? "Add Folder" : "Add More"}
        </Button>
        <Box sx={{ flex: 1 }} />
        <Button
          onClick={onClose}
          variant="contained"
          startIcon={<CloseIcon />}
          sx={{
            borderRadius: 20,
            textTransform: "none",
            minWidth: 100,
          }}
        >
          {isWorking ? "Continue" : "Done"}
        </Button>
      </DialogActions>

      <Dialog
        open={confirmDelete.open}
        onClose={handleCancelDelete}
        maxWidth="xs"
        fullWidth
        PaperProps={{ sx: { borderRadius: 3 } }}
      >
        <DialogTitle sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ErrorIcon color="error" />
          Remove Folder?
        </DialogTitle>
        <DialogContent>
          <DialogContentText>
            Are you sure you want to remove "{confirmDelete.path && getFolderName(confirmDelete.path)}" from your watched folders? 
            This will stop scanning photos from this location.
          </DialogContentText>
        </DialogContent>
        <DialogActions sx={{ px: 3, pb: 2 }}>
          <Button 
            onClick={handleCancelDelete} 
            color="inherit"
            sx={{ borderRadius: 2, textTransform: "none" }}
          >
            Cancel
          </Button>
          <Button 
            onClick={handleConfirmDelete} 
            color="error" 
            variant="contained"
            sx={{ borderRadius: 2, textTransform: "none" }}
          >
            Remove
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
};

export default FolderManagementDialog;
