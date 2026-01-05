import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  List,
  ListItem,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  CircularProgress,
  Alert,
  Breadcrumbs,
  Link,
  Chip,
  Tooltip,
  IconButton,
} from "@mui/material";
import {
  Storage as StorageIcon,
  Usb as UsbIcon,
  SdCard as SdCardIcon,
  Folder as FolderIcon,
  InsertDriveFile as FileIcon,
  ArrowBack as ArrowBackIcon,
  Refresh as RefreshIcon,
  ViewList as ViewListIcon,
  ViewModule as ViewModuleIcon,
  GridView as GridViewIcon,
} from "@mui/icons-material";
import { invoke } from "@tauri-apps/api/core";

interface Device {
  name: string;
  mount_point: string;
  device_type: string;
  total_space?: number;
  available_space?: number;
}

interface FileItem {
  name: string;
  path: string;
  is_directory: boolean;
  size?: number;
}

type ViewMode = "list" | "small_grid" | "large_grid";

interface DeviceBrowserProps {
  onDeviceSelect?: (device: Device) => void;
  onFileSelect?: (files: string[]) => void;
}

interface ViewControlsProps {
  viewMode: ViewMode;
  onViewModeChange: (mode: ViewMode) => void;
}

const ViewControls: React.FC<ViewControlsProps> = ({ viewMode, onViewModeChange }) => {
  return (
    <Box sx={{ display: "flex", gap: 0.5 }}>
      <Tooltip title="List view">
        <IconButton
          size="small"
          onClick={() => onViewModeChange("list")}
          sx={{
            color: viewMode === "list" ? "primary.main" : "text.secondary",
            bgcolor: viewMode === "list" ? "primary.light" : "transparent",
            "&:hover": {
              bgcolor: viewMode === "list" ? "primary.main" : "action.hover",
              color: viewMode === "list" ? "white" : "text.primary",
            },
          }}
        >
          <ViewListIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Small grid">
        <IconButton
          size="small"
          onClick={() => onViewModeChange("small_grid")}
          sx={{
            color: viewMode === "small_grid" ? "primary.main" : "text.secondary",
            bgcolor: viewMode === "small_grid" ? "primary.light" : "transparent",
            "&:hover": {
              bgcolor: viewMode === "small_grid" ? "primary.main" : "action.hover",
              color: viewMode === "small_grid" ? "white" : "text.primary",
            },
          }}
        >
          <ViewModuleIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Large grid">
        <IconButton
          size="small"
          onClick={() => onViewModeChange("large_grid")}
          sx={{
            color: viewMode === "large_grid" ? "primary.main" : "text.secondary",
            bgcolor: viewMode === "large_grid" ? "primary.light" : "transparent",
            "&:hover": {
              bgcolor: viewMode === "large_grid" ? "primary.main" : "action.hover",
              color: viewMode === "large_grid" ? "white" : "text.primary",
            },
          }}
        >
          <GridViewIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
};

interface DeviceGridProps {
  devices: Device[];
  onDeviceClick: (device: Device) => void;
  getDeviceIcon: (deviceType: string) => React.ReactNode;
  formatBytes: (bytes?: number) => string;
  size: "small" | "large";
}

const DeviceGrid: React.FC<DeviceGridProps> = ({
  devices,
  onDeviceClick,
  getDeviceIcon,
  formatBytes,
  size,
}) => {
  const isLarge = size === "large";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: isLarge
          ? "repeat(auto-fill, minmax(280px, 1fr))"
          : "repeat(auto-fill, minmax(160px, 1fr))",
        gap: 2,
        p: 2,
      }}
    >
      {devices.map((device) => (
        <Box
          key={device.mount_point}
          onClick={() => onDeviceClick(device)}
          sx={{
            cursor: "pointer",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: isLarge ? 3 : 2,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            transition: "all 0.2s ease-in-out",
            "&:hover": {
              bgcolor: "action.hover",
              borderColor: "primary.main",
              transform: "translateY(-2px)",
              boxShadow: 2,
            },
          }}
        >
          <Box sx={{ mb: isLarge ? 2 : 1, color: "primary.main", fontSize: isLarge ? 48 : 32 }}>
            {getDeviceIcon(device.device_type)}
          </Box>
          <Typography
            variant={isLarge ? "h6" : "body1"}
            sx={{
              mb: 1,
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.2,
            }}
          >
            {device.name || device.mount_point}
          </Typography>
          <Chip
            label={device.device_type}
            size="small"
            variant="outlined"
            sx={{ mb: isLarge ? 2 : 1 }}
          />
          {device.total_space && isLarge && (
            <Typography variant="caption" color="text.secondary">
              {formatBytes(device.available_space)} free of{" "}
              {formatBytes(device.total_space)}
            </Typography>
          )}
          {device.total_space && !isLarge && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: "0.7rem" }}>
              {formatBytes(device.available_space)} free
            </Typography>
          )}
        </Box>
      ))}
      {devices.length === 0 && (
        <Box
          sx={{
            gridColumn: "1 / -1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 8,
            color: "text.secondary",
          }}
        >
          <StorageIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            No devices found
          </Typography>
          <Typography variant="body2">
            Connect a USB drive, external hard drive, or mobile device
          </Typography>
        </Box>
      )}
    </Box>
  );
};

interface FileGridProps {
  files: FileItem[];
  onFileClick: (file: FileItem) => void;
  size: "small" | "large";
}

const FileGrid: React.FC<FileGridProps> = ({ files, onFileClick, size }) => {
  const isLarge = size === "large";

  return (
    <Box
      sx={{
        display: "grid",
        gridTemplateColumns: isLarge
          ? "repeat(auto-fill, minmax(200px, 1fr))"
          : "repeat(auto-fill, minmax(120px, 1fr))",
        gap: 2,
        p: 2,
      }}
    >
      {files.map((file) => (
        <Box
          key={file.path}
          onClick={() => onFileClick(file)}
          sx={{
            cursor: "pointer",
            border: "1px solid",
            borderColor: "divider",
            borderRadius: 2,
            p: isLarge ? 2 : 1.5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            textAlign: "center",
            transition: "all 0.2s ease-in-out",
            "&:hover": {
              bgcolor: "action.hover",
              borderColor: "primary.main",
              transform: "translateY(-2px)",
              boxShadow: 2,
            },
          }}
        >
          <Box sx={{ mb: isLarge ? 1.5 : 1, color: file.is_directory ? "warning.main" : "text.secondary", fontSize: isLarge ? 48 : 32 }}>
            {file.is_directory ? <FolderIcon /> : <FileIcon />}
          </Box>
          <Typography
            variant={isLarge ? "body1" : "body2"}
            sx={{
              fontWeight: 500,
              overflow: "hidden",
              textOverflow: "ellipsis",
              display: "-webkit-box",
              WebkitLineClamp: isLarge ? 3 : 2,
              WebkitBoxOrient: "vertical",
              lineHeight: 1.2,
              wordBreak: "break-word",
            }}
          >
            {file.name}
          </Typography>
          {isLarge && (
            <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
              {file.is_directory ? "Folder" : "File"}
            </Typography>
          )}
        </Box>
      ))}
      {files.length === 0 && (
        <Box
          sx={{
            gridColumn: "1 / -1",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            py: 8,
            color: "text.secondary",
          }}
        >
          <FolderIcon sx={{ fontSize: 64, mb: 2, opacity: 0.5 }} />
          <Typography variant="h6" sx={{ mb: 1 }}>
            Empty directory
          </Typography>
          <Typography variant="body2">
            No files or folders found
          </Typography>
        </Box>
      )}
    </Box>
  );
};

const DeviceBrowser: React.FC<DeviceBrowserProps> = ({
  onDeviceSelect,
  onFileSelect,
}) => {
  const [devices, setDevices] = useState<Device[]>([]);
  const [selectedDevice, setSelectedDevice] = useState<Device | null>(null);
  const [currentPath, setCurrentPath] = useState<string>("");
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [previousDeviceCount, setPreviousDeviceCount] = useState<number>(0);
  const [deviceChangeMessage, setDeviceChangeMessage] = useState<string | null>(
    null,
  );
  const [pathHistory, setPathHistory] = useState<string[]>([]);
  const [viewMode, setViewMode] = useState<ViewMode>(() => {
    const saved = localStorage.getItem("deviceBrowserViewMode");
    return (saved as ViewMode) || "list";
  });

  const changeViewMode = (mode: ViewMode) => {
    setViewMode(mode);
    localStorage.setItem("deviceBrowserViewMode", mode);
  };

  // Load connected devices on component mount and set up polling
  useEffect(() => {
    loadDevices();

    // Poll for device changes every 3 seconds
    const pollInterval = setInterval(() => {
      loadDevices();
    }, 3000);

    // Cleanup interval on unmount
    return () => clearInterval(pollInterval);
  }, []);

  const loadDevices = async () => {
    try {
      setLoading(true);
      setError(null);
      const connectedDevices: Device[] = await invoke("list_connected_devices");

      // Check for device changes
      const currentCount = connectedDevices.length;
      if (previousDeviceCount !== 0 && currentCount !== previousDeviceCount) {
        if (currentCount > previousDeviceCount) {
          setDeviceChangeMessage(
            `Device connected (${currentCount - previousDeviceCount} new)`,
          );
        } else {
          setDeviceChangeMessage(
            `Device disconnected (${previousDeviceCount - currentCount} removed)`,
          );
        }
        // Clear the message after 3 seconds
        setTimeout(() => setDeviceChangeMessage(null), 3000);
      }
      setPreviousDeviceCount(currentCount);

      setDevices(connectedDevices);
      setLastRefresh(new Date());
    } catch (err) {
      console.error("Error loading devices:", err);
      setError("Failed to load connected devices");
    } finally {
      setLoading(false);
    }
  };

  const browseDevice = async (device: Device) => {
    setSelectedDevice(device);
    setCurrentPath(device.mount_point);
    setPathHistory([device.mount_point]);
    await loadDirectoryContents(device.mount_point);
    onDeviceSelect?.(device);
  };

  const loadDirectoryContents = async (path: string) => {
    try {
      setLoading(true);
      setError(null);

      // Get directory listing
      const directoryContents: string[] = await invoke("read_directory", {
        path,
      });

      // Convert to FileItem format
      const fileItems: FileItem[] = await Promise.all(
        directoryContents.map(async (itemPath: string) => {
          const isDirectory =
            itemPath.endsWith("/") || !(await isFile(itemPath));
          const name =
            itemPath.split("/").pop() || itemPath.split("\\").pop() || itemPath;

          return {
            name,
            path: itemPath,
            is_directory: isDirectory,
          };
        }),
      );

      // Filter and sort: directories first, then files
      const sortedFiles = fileItems.sort((a, b) => {
        if (a.is_directory && !b.is_directory) return -1;
        if (!a.is_directory && b.is_directory) return 1;
        return a.name.localeCompare(b.name);
      });

      setFiles(sortedFiles);
    } catch (err) {
      console.error("Error loading directory:", err);
      setError("Failed to load directory contents");
      setFiles([]);
    } finally {
      setLoading(false);
    }
  };

  const isFile = async (_path: string): Promise<boolean> => {
    try {
      // Simple check - if it's not a directory, assume it's a file
      // In a real implementation, you'd check file metadata
      return true;
    } catch {
      return false;
    }
  };

  const handleFileClick = async (file: FileItem) => {
    if (file.is_directory) {
      setCurrentPath(file.path);
      setPathHistory([...pathHistory, file.path]);
      await loadDirectoryContents(file.path);
    } else {
      // Handle file selection - for images, load them
      const imageFiles: string[] = await invoke("list_files", {
        path: currentPath,
        fileType: "images",
      });
      onFileSelect?.(imageFiles);
    }
  };

  const handleBreadcrumbClick = async (clickedPath: string, index: number) => {
    setCurrentPath(clickedPath);
    setPathHistory(pathHistory.slice(0, index + 1));
    await loadDirectoryContents(clickedPath);
  };

  const goBack = async () => {
    if (pathHistory.length > 1) {
      const newHistory = pathHistory.slice(0, -1);
      const previousPath = newHistory[newHistory.length - 1];
      setCurrentPath(previousPath);
      setPathHistory(newHistory);
      await loadDirectoryContents(previousPath);
    } else {
      // If we're at the root of the device, go back to device list
      setSelectedDevice(null);
      setCurrentPath("");
      setPathHistory([]);
      setFiles([]);
    }
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes) return "Unknown";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType.toLowerCase()) {
      case "external drive":
        return <UsbIcon />;
      case "removable drive":
        return <SdCardIcon />;
      case "system drive":
        return <StorageIcon />;
      default:
        return <StorageIcon />;
    }
  };

  if (loading && devices.length === 0) {
    return (
      <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 2 }}>
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
        <button onClick={loadDevices}>Retry</button>
      </Box>
    );
  }

  if (!selectedDevice) {
    // Show device list
    return (
      <Box>
        <Box
          sx={{
            p: 2,
            pb: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <Box>
            <Typography variant="h6">Connected Devices</Typography>
            {lastRefresh && (
              <Typography variant="caption" color="text.secondary">
                Last updated: {lastRefresh.toLocaleTimeString()}
              </Typography>
            )}
          </Box>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <ViewControls viewMode={viewMode} onViewModeChange={changeViewMode} />
            <Tooltip title="Refresh devices">
              <IconButton
                onClick={loadDevices}
                disabled={loading}
                sx={{
                  color: "text.secondary",
                  "&:hover": {
                    backgroundColor: "action.hover",
                  },
                  animation: loading ? "spin 1s linear infinite" : "none",
                  "@keyframes spin": {
                    "0%": {
                      transform: "rotate(0deg)",
                    },
                    "100%": {
                      transform: "rotate(360deg)",
                    },
                  },
                }}
              >
                <RefreshIcon />
              </IconButton>
            </Tooltip>
          </Box>
        </Box>

        {deviceChangeMessage && (
          <Alert severity="info" sx={{ mx: 2, mb: 1 }}>
            {deviceChangeMessage}
          </Alert>
        )}

        {viewMode === "list" ? (
          <List sx={{ pt: 0 }}>
            {devices.map((device) => (
              <ListItem key={device.mount_point} disablePadding>
                <ListItemButton onClick={() => browseDevice(device)}>
                  <ListItemIcon>{getDeviceIcon(device.device_type)}</ListItemIcon>
                  <ListItemText
                    primary={device.name || device.mount_point}
                    secondary={
                      <Box>
                        <Typography variant="body2" color="text.secondary">
                          {device.device_type}
                        </Typography>
                        {device.total_space && (
                          <Typography variant="caption" color="text.secondary">
                            {formatBytes(device.available_space)} free of{" "}
                            {formatBytes(device.total_space)}
                          </Typography>
                        )}
                      </Box>
                    }
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {devices.length === 0 && (
              <ListItem>
                <ListItemText
                  primary="No devices found"
                  secondary="Connect a USB drive, external hard drive, or mobile device"
                />
              </ListItem>
            )}
          </List>
        ) : (
          <DeviceGrid
            devices={devices}
            onDeviceClick={browseDevice}
            getDeviceIcon={getDeviceIcon}
            formatBytes={formatBytes}
            size={viewMode === "large_grid" ? "large" : "small"}
          />
        )}
      </Box>
    );
  }

  // Show file browser
  return (
    <Box>
      {/* Header with device info */}
      <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", mb: 1 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            {getDeviceIcon(selectedDevice.device_type)}
            <Typography variant="h6">
              {selectedDevice.name || selectedDevice.mount_point}
            </Typography>
            <Chip
              label={selectedDevice.device_type}
              size="small"
              variant="outlined"
            />
          </Box>
          <ViewControls viewMode={viewMode} onViewModeChange={changeViewMode} />
        </Box>
        {selectedDevice.total_space && (
          <Typography variant="caption" color="text.secondary">
            {formatBytes(selectedDevice.available_space)} free of{" "}
            {formatBytes(selectedDevice.total_space)}
          </Typography>
        )}
      </Box>

      {/* Breadcrumb navigation */}
      <Box sx={{ p: 2, borderBottom: "1px solid", borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ArrowBackIcon
            sx={{
              cursor: "pointer",
              color: "primary.main",
              "&:hover": {
                color: "primary.dark",
              },
            }}
            onClick={goBack}
          />
          <Breadcrumbs maxItems={3}>
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
                {path === selectedDevice.mount_point
                  ? selectedDevice.name || "Root"
                  : path.split("/").pop() || path.split("\\").pop() || path}
              </Link>
            ))}
          </Breadcrumbs>
        </Box>
      </Box>

      {/* File list */}
      <Box sx={{ flex: 1, overflowY: "auto" }}>
        {loading ? (
          <Box sx={{ display: "flex", justifyContent: "center", p: 4 }}>
            <CircularProgress />
          </Box>
        ) : viewMode === "list" ? (
          <List sx={{ pt: 0 }}>
            {files.map((file) => (
              <ListItem key={file.path} disablePadding>
                <ListItemButton onClick={() => handleFileClick(file)}>
                  <ListItemIcon>
                    {file.is_directory ? <FolderIcon /> : <FileIcon />}
                  </ListItemIcon>
                  <ListItemText
                    primary={file.name}
                    secondary={file.is_directory ? "Folder" : "File"}
                  />
                </ListItemButton>
              </ListItem>
            ))}
            {files.length === 0 && (
              <ListItem>
                <ListItemText
                  primary="Empty directory"
                  secondary="No files or folders found"
                />
              </ListItem>
            )}
          </List>
        ) : (
          <FileGrid
            files={files}
            onFileClick={handleFileClick}
            size={viewMode === "large_grid" ? "large" : "small"}
          />
        )}
      </Box>
    </Box>
  );
};

export default DeviceBrowser;
