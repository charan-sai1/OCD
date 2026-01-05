import React, { useState } from "react";
import {
  AppBar,
  Toolbar,
  Typography,
  IconButton,
  Tooltip,
  Box,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
} from "@mui/material";
import {
  FolderOpen as FolderOpenIcon,
  CloudUpload as CloudUploadIcon,
  MoreVert as MoreVertIcon,
  ChevronLeft as ChevronLeftIcon,
  ChevronRight as ChevronRightIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
} from "@mui/icons-material";

interface AppToolbarProps {
  onImport: () => void;
  onOpenFolderManagement: () => void;
  onIncreaseImageSize: () => void;
  onDecreaseImageSize: () => void;
  imageSize: number;
  photoCount: number;
  isSidebarCollapsed: boolean;
  onToggleSidebar: () => void;
}

const AppToolbar: React.FC<AppToolbarProps> = ({
  onImport,
  onOpenFolderManagement,
  onIncreaseImageSize,
  onDecreaseImageSize,
  imageSize,
  photoCount,
  isSidebarCollapsed,
  onToggleSidebar,
}) => {
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const isMenuOpen = Boolean(menuAnchorEl);

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
  };

  const handleAddFolders = () => {
    handleMenuClose();
    onOpenFolderManagement();
  };

  const handleImport = () => {
    handleMenuClose();
    onImport();
  };
  return (
    <AppBar
      position="static"
      elevation={0}
      sx={{
        backgroundColor: "background.paper",
        borderBottom: "1px solid",
        borderColor: "divider",
        color: "text.primary",
      }}
    >
      <Toolbar sx={{ justifyContent: "space-between" }}>
        {/* Left side - Sidebar toggle and Photo count */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 2 }}>
          <Tooltip
            title={isSidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}
          >
            <IconButton
              onClick={onToggleSidebar}
              sx={{
                color: "text.secondary",
                "&:hover": {
                  backgroundColor: "action.hover",
                },
              }}
            >
              {isSidebarCollapsed ? <ChevronRightIcon /> : <ChevronLeftIcon />}
            </IconButton>
          </Tooltip>
          <Typography variant="h6" sx={{ fontWeight: 400 }}>
            {photoCount > 0
              ? `${photoCount} photo${photoCount !== 1 ? "s" : ""}`
              : "No photos"}
          </Typography>
        </Box>

        {/* Right side - Actions */}
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          {/* More options */}
          <Tooltip title="More options">
            <IconButton
              onClick={handleMenuOpen}
              sx={{
                color: "text.secondary",
                "&:hover": {
                  backgroundColor: "action.hover",
                },
              }}
            >
              <MoreVertIcon />
            </IconButton>
          </Tooltip>

          <Menu
            anchorEl={menuAnchorEl}
            open={isMenuOpen}
            onClose={handleMenuClose}
            anchorOrigin={{
              vertical: "bottom",
              horizontal: "right",
            }}
            transformOrigin={{
              vertical: "top",
              horizontal: "right",
            }}
            PaperProps={{
              sx: {
                borderRadius: 2,
                minWidth: 180,
                mt: 1,
              },
            }}
          >
            <MenuItem onClick={handleAddFolders}>
              <ListItemIcon>
                <FolderOpenIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Add folders</ListItemText>
            </MenuItem>
            <MenuItem onClick={handleImport}>
              <ListItemIcon>
                <CloudUploadIcon fontSize="small" />
              </ListItemIcon>
              <ListItemText>Import</ListItemText>
            </MenuItem>
            <MenuItem sx={{ justifyContent: "space-between", py: 1 }}>
              <Typography variant="body2" sx={{ flex: 1 }}>
                Image size: {imageSize}
              </Typography>
              <Box sx={{ display: "flex", gap: 0.5 }}>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onDecreaseImageSize();
                  }}
                  disabled={imageSize <= 2}
                  sx={{ p: 0.5 }}
                >
                  <RemoveIcon fontSize="small" />
                </IconButton>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    onIncreaseImageSize();
                  }}
                  disabled={imageSize >= 8}
                  sx={{ p: 0.5 }}
                >
                  <AddIcon fontSize="small" />
                </IconButton>
              </Box>
            </MenuItem>
          </Menu>
        </Box>
      </Toolbar>
    </AppBar>
  );
};

export default AppToolbar;
