import React, { useState } from "react";
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
import {
  ImportExport as ImportExportIcon,
  CloudUpload as ImportIcon,
  CloudDownload as ExportIcon,
  Storage as StorageIcon,

  Usb as UsbIcon,
  SdCard as SdCardIcon,
  Close as CloseIcon,
} from "@mui/icons-material";

interface Device {
  name: string;
  mount_point: string;
  device_type: string;
  total_space?: number;
  available_space?: number;
}

interface DeviceImportDialogProps {
  open: boolean;
  onClose: () => void;
  newDevices: Device[];
  onImportFromDevice: (device: Device) => void;
  onExportToDevice: (device: Device) => void;
}

const DeviceImportDialog: React.FC<DeviceImportDialogProps> = ({
  open,
  onClose,
  newDevices,
  onImportFromDevice,
  onExportToDevice,
}) => {
  const [selectedAction, setSelectedAction] = useState<"import" | "export" | null>(null);

  const handleActionSelect = (action: "import" | "export") => {
    setSelectedAction(action);
  };

  const handleDeviceSelect = (device: Device) => {
    if (selectedAction === "import") {
      onImportFromDevice(device);
    } else if (selectedAction === "export") {
      onExportToDevice(device);
    }
    onClose();
  };

  const handleClose = () => {
    setSelectedAction(null);
    onClose();
  };

  const getDeviceIcon = (deviceType: string) => {
    switch (deviceType.toLowerCase()) {
      case "external drive":
        return <UsbIcon />;
      case "removable drive":
        return <SdCardIcon />;
      default:
        return <StorageIcon />;
    }
  };

  const formatBytes = (bytes?: number): string => {
    if (!bytes) return "Unknown";
    const sizes = ["Bytes", "KB", "MB", "GB", "TB"];
    if (bytes === 0) return "0 Bytes";
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round((bytes / Math.pow(1024, i)) * 100) / 100 + " " + sizes[i];
  };

  return (
    <Dialog
      open={open}
      onClose={handleClose}
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
          justifyContent: "space-between",
          pb: 1,
        }}
      >
        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
          <ImportExportIcon />
          New Device Detected
        </Box>
        <IconButton
          onClick={handleClose}
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
        {selectedAction === null ? (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              A new device has been connected. What would you like to do?
            </Typography>

            <Box sx={{ display: "flex", gap: 2, mb: 3 }}>
              <Button
                variant="outlined"
                startIcon={<ImportIcon />}
                onClick={() => handleActionSelect("import")}
                sx={{
                  flex: 1,
                  py: 2,
                  borderRadius: 2,
                  textTransform: "none",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                  },
                }}
              >
                Import Images
              </Button>
              <Button
                variant="outlined"
                startIcon={<ExportIcon />}
                onClick={() => handleActionSelect("export")}
                sx={{
                  flex: 1,
                  py: 2,
                  borderRadius: 2,
                  textTransform: "none",
                  "&:hover": {
                    transform: "translateY(-2px)",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.15)",
                  },
                }}
              >
                Export Images
              </Button>
            </Box>
          </>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
              Select a device to {selectedAction} images {selectedAction === "import" ? "from" : "to"}:
            </Typography>

            <List sx={{ pt: 0 }}>
              {newDevices.map((device) => (
                <ListItem key={device.mount_point} disablePadding>
                  <ListItemButton
                    onClick={() => handleDeviceSelect(device)}
                    sx={{
                      borderRadius: 2,
                      mb: 1,
                      border: "1px solid",
                      borderColor: "divider",
                      transition: "all 0.2s cubic-bezier(0.4, 0, 0.2, 1)",
                      "&:hover": {
                        backgroundColor: "action.hover",
                        borderColor: "primary.main",
                        transform: "translateY(-1px)",
                        boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                      },
                    }}
                  >
                    <ListItemIcon sx={{ color: "primary.main" }}>
                      {getDeviceIcon(device.device_type)}
                    </ListItemIcon>
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
            </List>

            {selectedAction === "import" && (
              <Box sx={{ mt: 3, p: 2, backgroundColor: "action.hover", borderRadius: 2 }}>
                <Typography variant="body2" sx={{ mb: 1, fontWeight: 500 }}>
                  Connect to Mobile Device
                </Typography>
                <Typography variant="caption" color="text.secondary">
                  To import from a mobile device, ensure it's connected via USB and file transfer is enabled.
                  The device should appear in the list above once detected.
                </Typography>
              </Box>
            )}
          </>
        )}
      </DialogContent>

      {selectedAction && (
        <DialogActions sx={{ px: 3, pb: 3, pt: 0 }}>
          <Button
            onClick={() => setSelectedAction(null)}
            variant="outlined"
            sx={{
              borderRadius: 20,
              textTransform: "none",
              mr: 1,
            }}
          >
            Back
          </Button>
          <Button
            onClick={handleClose}
            variant="contained"
            sx={{
              borderRadius: 20,
              textTransform: "none",
            }}
          >
            Cancel
          </Button>
        </DialogActions>
      )}
    </Dialog>
  );
};

export default DeviceImportDialog;