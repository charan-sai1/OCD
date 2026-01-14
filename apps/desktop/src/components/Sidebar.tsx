 import React from "react";
 import Box from "@mui/material/Box";
 import Typography from "@mui/material/Typography";
 import Drawer from "@mui/material/Drawer";
 import List from "@mui/material/List";
 import ListItem from "@mui/material/ListItem";
 import ListItemButton from "@mui/material/ListItemButton";
 import ListItemIcon from "@mui/material/ListItemIcon";
 import ListItemText from "@mui/material/ListItemText";
 import Divider from "@mui/material/Divider";
 import IconButton from "@mui/material/IconButton";
 import {
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
    { id: "folders", label: "Folders", icon: FolderIcon },
    { id: "devices", label: "Devices", icon: DevicesIcon },
    { id: "faces", label: "Faces", icon: FaceIcon },
    { id: "favorites", label: "Favorites", icon: FavoriteIcon },
    { id: "archive", label: "Archive", icon: ArchiveIcon },
    { id: "trash", label: "Trash", icon: DeleteIcon },
  ];

  return (
    <Drawer
      variant="permanent"
      sx={{
        width: collapsed ? 80 : 280,
        flexShrink: 0,
        '& .MuiDrawer-paper': {
          width: collapsed ? 80 : 280,
          boxSizing: 'border-box',
          backgroundColor: 'background.default',
          borderRadius: collapsed ? '0 16px 16px 0' : 0,
          transition: 'width 0.3s ease, border-radius 0.3s ease',
        },
      }}
    >


      {/* Navigation Menu */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        <List sx={{ padding: collapsed ? '8px 0' : '16px 0' }}>
          {menuItems.map((item) => {
            const IconComponent = item.icon;
            return (
              <ListItem key={item.id} disablePadding sx={{ paddingX: collapsed ? 1 : 2 }}>
                <ListItemButton
                  selected={selectedSection === item.id}
                  onClick={() => onSectionChange(item.id)}
                  sx={{
                    minHeight: 56,
                    paddingX: collapsed ? 1.5 : 3,
                    paddingY: 1,
                    justifyContent: collapsed ? "center" : "flex-start",
                    borderRadius: 28,
                    margin: '4px 12px',
                    gap: collapsed ? 0 : 2,
                  }}
                >
                  <ListItemIcon
                    sx={{
                      minWidth: collapsed ? "auto" : 24,
                      justifyContent: collapsed ? "center" : "flex-start",
                      width: collapsed ? "100%" : "auto",
                      color: selectedSection === item.id ? "surfaceTint" : "onSurfaceVariant",
                    }}
                  >
                    <IconComponent />
                  </ListItemIcon>
                  {!collapsed && (
                    <ListItemText
                      primary={item.label}
                      primaryTypographyProps={{
                        fontWeight: selectedSection === item.id ? 500 : 400,
                        color: selectedSection === item.id ? "surfaceTint" : "onSurfaceVariant",
                        fontSize: '0.875rem',
                        lineHeight: 1.25,
                      }}
                    />
                  )}
                </ListItemButton>
              </ListItem>
            );
          })}
        </List>

        <Divider sx={{ marginY: 2, borderColor: "rgba(255, 255, 255, 0.12)" }} />

        {/* Storage Info */}
        {!collapsed && (
          <Box sx={{ padding: 3 }}>
            <Typography
              variant="body2"
              sx={{
                color: "onSurfaceVariant",
                fontWeight: 500,
                fontSize: '0.75rem',
                lineHeight: 1.333,
                textTransform: 'uppercase',
                letterSpacing: '0.083em',
                marginBottom: 2,
              }}
            >
              Storage
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
              <Box
                sx={{
                  flex: 1,
                  height: 4,
                  backgroundColor: "rgba(255, 255, 255, 0.12)",
                  borderRadius: 2,
                  overflow: "hidden",
                }}
              >
                <Box
                  sx={{
                    width: "35%",
                    height: "100%",
                    backgroundColor: "surfaceTint",
                    borderRadius: 2,
                  }}
                />
              </Box>
              <Typography
                variant="caption"
                sx={{
                  color: "onSurfaceVariant",
                  fontSize: '0.75rem',
                  lineHeight: 1.333,
                }}
              >
                35%
              </Typography>
            </Box>
            <Typography
              variant="caption"
              sx={{
                color: "onSurfaceVariant",
                fontSize: '0.75rem',
                lineHeight: 1.333,
                marginTop: 1,
              }}
            >
              3.5 GB of 10 GB used
            </Typography>
          </Box>
        )}

        {/* Collapse/Expand Button */}
        <Box
          sx={{
            padding: collapsed ? '12px 8px' : '16px 12px',
            borderTop: "1px solid",
            borderColor: "rgba(255, 255, 255, 0.12)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          <IconButton
            onClick={onToggleSidebar}
            sx={{
              color: "onSurfaceVariant",
              borderRadius: 16,
              padding: 1.5,
              "&:hover": {
                backgroundColor: "rgba(245, 245, 245, 0.04)",
              },
              transform: collapsed ? "rotate(180deg)" : "rotate(0deg)",
              transition: "transform 0.3s ease",
            }}
          >
            <ChevronLeftIcon />
          </IconButton>
        </Box>
      </Box>
    </Drawer>
  );
};

export default Sidebar;
