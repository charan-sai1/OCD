import React from "react";
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
import ListItemText from "@mui/material/ListItemText";
import ListItemSecondaryAction from "@mui/material/ListItemSecondaryAction";
import {
  FolderOpen as FolderOpenIcon,
  Delete as DeleteIcon,
  Add as AddIcon,
  Image as ImageIcon,
} from "@mui/icons-material";

interface FolderManagementDialogProps {
  open: boolean;
  onClose: () => void;
  directoryPaths: string[];
  onAddFolders: () => void;
  onRemoveDirectory: (path: string) => void;
  isLoadingImages?: boolean;
  loadingProgress?: number;
}

const FolderManagementDialog: React.FC<FolderManagementDialogProps> = ({
  open,
  onClose,
  directoryPaths,
  onAddFolders,
  onRemoveDirectory,
  isLoadingImages = false,
  loadingProgress = 0,
}) => {
  const handleAddFolders = () => {
    onAddFolders();
    // Don't close the dialog so user can see the newly added folders
  };

  return (
    <Dialog
      open={open}
      onClose={isLoadingImages ? undefined : onClose}
      maxWidth="sm"
      fullWidth
      TransitionProps={{
        timeout: 300,
      }}
      sx={{
        "& .MuiDialog-paper": {
          borderRadius: 3,
          backgroundColor: "background.paper",
          transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
          boxShadow: "0 24px 48px rgba(0, 0, 0, 0.2)",
        },
      }}
    >
      <DialogTitle
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          pb: 1,
        }}
      >
        <FolderOpenIcon />
        Manage Folders
      </DialogTitle>

      <DialogContent sx={{ pb: 1 }}>
        {/* Loading Progress Bar */}
        {isLoadingImages && (
          <Box sx={{ mb: 3 }}>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
              Scanning folders for images...
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
              <Box sx={{ flex: 1 }}>
                <Box
                  sx={{
                    height: 8,
                    backgroundColor: "action.disabled",
                    borderRadius: 4,
                    overflow: "hidden",
                  }}
                >
                  <Box
                    sx={{
                      height: "100%",
                      backgroundColor: "primary.main",
                      borderRadius: 4,
                      width: `${loadingProgress}%`,
                      transition: "width 0.4s cubic-bezier(0.4, 0, 0.2, 1)",
                      boxShadow: "0 2px 8px rgba(25, 118, 210, 0.3)",
                    }}
                  />
                </Box>
              </Box>
              <Typography
                variant="body1"
                color="text.primary"
                fontWeight={600}
                sx={{
                  transition: "color 0.2s ease",
                  minWidth: 45,
                  textAlign: "right",
                }}
              >
                {Math.round(loadingProgress)}%
              </Typography>
            </Box>
          </Box>
        )}

        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Selected folders ({directoryPaths.length}):
        </Typography>

        {directoryPaths.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              py: 6,
              textAlign: "center",
            }}
          >
            <Box
              sx={{
                width: 64,
                height: 64,
                borderRadius: "50%",
                backgroundColor: "action.disabled",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                mb: 2,
              }}
            >
              <ImageIcon sx={{ fontSize: 32, color: "text.disabled" }} />
            </Box>
            <Typography variant="h6" color="text.secondary" sx={{ mb: 1 }}>
              No folders selected
            </Typography>
            <Typography variant="body2" color="text.disabled">
              Click "Add folders" to start selecting folders with photos
            </Typography>
          </Box>
        ) : (
          <List sx={{ pt: 0 }}>
            {directoryPaths.map((path, index) => (
              <React.Fragment key={index}>
                <ListItem
                  sx={{
                    borderRadius: 2,
                    mb: 1,
                    backgroundColor: "background.default",
                    border: "1px solid",
                    borderColor: "divider",
                    transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                    cursor: "default",
                    "&:hover": {
                      backgroundColor: "action.hover",
                      borderColor: "action.focus",
                      transform: "translateY(-1px)",
                      boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                    },
                  }}
                >
                  <Box sx={{ mr: 2 }}>
                    <FolderOpenIcon
                      sx={{ color: "primary.main", fontSize: 24 }}
                    />
                  </Box>
                  <ListItemText
                    primary={path.split("/").pop()}
                    secondary={path}
                    primaryTypographyProps={{
                      variant: "body1",
                      sx: { fontWeight: 500, color: "text.primary" },
                    }}
                    secondaryTypographyProps={{
                      variant: "body2",
                      sx: { fontSize: "0.75rem", color: "text.secondary" },
                    }}
                  />
                  <ListItemSecondaryAction>
                    <IconButton
                      edge="end"
                      onClick={() => onRemoveDirectory(path)}
                      disabled={isLoadingImages}
                      sx={{
                        color: "error.main",
                        transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                        "&:hover": {
                          backgroundColor: "error.main",
                          color: "error.contrastText",
                          transform: "scale(1.1)",
                        },
                        "&:active": {
                          transform: "scale(0.95)",
                        },
                        "&:disabled": {
                          color: "action.disabled",
                          cursor: "not-allowed",
                        },
                      }}
                    >
                      <DeleteIcon />
                    </IconButton>
                  </ListItemSecondaryAction>
                </ListItem>
              </React.Fragment>
            ))}
          </List>
        )}
      </DialogContent>

      <DialogActions sx={{ px: 3, pb: 3, pt: 0 }}>
        <Button
          onClick={handleAddFolders}
          variant="outlined"
          startIcon={<AddIcon />}
          disabled={isLoadingImages}
          sx={{
            borderRadius: 20,
            textTransform: "none",
            mr: 1,
            transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
            "&:hover": {
              transform: "translateY(-1px)",
              boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
            },
            "&:active": {
              transform: "translateY(0)",
            },
            "&:disabled": {
              opacity: 0.6,
            },
          }}
        >
          {isLoadingImages ? "Scanning..." : "Add folders"}
        </Button>
        {!isLoadingImages && (
          <Button
            onClick={onClose}
            variant="contained"
            sx={{
              borderRadius: 20,
              textTransform: "none",
              transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
              "&:hover": {
                transform: "translateY(-1px)",
                boxShadow: "0 6px 20px rgba(25, 118, 210, 0.3)",
              },
              "&:active": {
                transform: "translateY(0)",
              },
            }}
          >
            Done
          </Button>
        )}
      </DialogActions>
    </Dialog>
  );
};

export default FolderManagementDialog;
