import React from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import List from "@mui/material/List";
import ListItem from "@mui/material/ListItem";
import ListItemButton from "@mui/material/ListItemButton";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Divider from "@mui/material/Divider";
import IconButton from "@mui/material/IconButton";
import {
  PhotoLibrary as PhotoLibraryIcon,
  Folder as FolderIcon,
  Favorite as FavoriteIcon,
  Delete as DeleteIcon,
  Archive as ArchiveIcon,
  Devices as DevicesIcon,
  Face as FaceIcon,
  ChevronLeft as ChevronLeftIcon,
} from "@mui/icons-material";

interface SidebarProps {
  selectedSection: string;
  onSectionChange: (section: string) => void;
  collapsed?: boolean;
  onToggleSidebar: () => void;
}

const Sidebar: React.FC<SidebarProps> = ({
  selectedSection,
  onSectionChange,
  collapsed = false,
  onToggleSidebar,
}) => {
  const menuItems = [
    { id: "photos", label: "Photos", icon: PhotoLibraryIcon },
    { id: "folders", label: "Folders", icon: FolderIcon },
    { id: "devices", label: "Devices", icon: DevicesIcon },
    { id: "faces", label: "Faces", icon: FaceIcon },
    { id: "favorites", label: "Favorites", icon: FavoriteIcon },
    { id: "archive", label: "Archive", icon: ArchiveIcon },
    { id: "trash", label: "Trash", icon: DeleteIcon },
  ];

  return (
    <Box
      sx={{
        width: collapsed ? 80 : 280,
        height: "100vh",
        backgroundColor: "background.paper",
        borderRight: "1px solid",
        borderColor: "divider",
        display: "flex",
        flexDirection: "column",
        transition: "width 0.3s ease",
      }}
    >
      {/* Logo/Brand */}
      <Box
        sx={{
          padding: collapsed ? 2 : 3,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          justifyContent: "center",
        }}
      >
        <Box
          sx={{ display: "flex", alignItems: "center", gap: collapsed ? 0 : 1 }}
        >
          <PhotoLibraryIcon
            sx={{
              fontSize: collapsed ? 28 : 32,
              color: "primary.main",
            }}
          />
          {!collapsed && (
            <Typography
              variant="h6"
              sx={{
                fontWeight: 600,
                color: "text.primary",
              }}
            >
              OCD Photos
            </Typography>
          )}
        </Box>
      </Box>

      {/* Navigation Menu */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List sx={{ padding: 0 }}>
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <ListItem key={item.id} disablePadding>
                <ListItemButton
                  selected={selectedSection === item.id}
                  onClick={() => onSectionChange(item.id)}
                  sx={{
                    paddingX: collapsed ? 2.5 : 3,
                    paddingY: 1.5,
                    justifyContent: collapsed ? "center" : "flex-start",
                    "&.Mui-selected": {
                      backgroundColor: "action.selected",
                      "&:hover": {
                        backgroundColor: "action.selected",
                      },
                    },
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: collapsed ? "auto" : 40,
                      justifyContent: collapsed ? "center" : "flex-start",
                      width: collapsed ? "100%" : "auto",
                    }}
                  >
                    <IconComponent
                      sx={{
                        color:
                          selectedSection === item.id
                            ? "primary.main"
                            : "text.secondary",
                      }}
                    />
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontWeight: selectedSection === item.id ? 600 : 400,
                        color:
                          selectedSection === item.id
                            ? "primary.main"
                            : "text.primary",
                      }}
                    />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        <Divider sx={{ marginY: 2 }} />

        {/* Storage Info */}
        {!collapsed && (
          <Box sx={{ padding: 3 }}>
            <Typography variant="body2" color="text.secondary" gutterBottom>
              Storage
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  flex: 1,
                  height: 4,
                  backgroundColor: "action.disabled",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    width: "35%",
                    height: "100%",
                    backgroundColor: "primary.main",
                    borderRadius: 2,
                  }}
                />
              </Box>
              <Typography variant="caption" color="text.secondary">
                35%
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              3.5 GB of 10 GB used
            </Typography>
          </Box>
        )}

        {/* Collapse/Expand Button */}
        <Box
          sx={{
            padding: collapsed ? 1 : 2,
            borderTop: "1px solid",
            borderColor: "divider",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <IconButton
            onClick={onToggleSidebar}
            sx={{
              color: "text.secondary",
              "&:hover": {
                backgroundColor: "action.hover",
              },
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.3s ease",
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Box>
      </Box>
    </Box>
  );
};

export default Sidebar;
