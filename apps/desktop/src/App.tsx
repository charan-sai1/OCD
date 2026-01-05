import { useState, useEffect } from "react";
import { ThemeProvider, createTheme, CssBaseline } from "@mui/material";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import Sidebar from "./components/Sidebar";
import PhotoGrid from "./components/PhotoGrid";
import {
  Fab,
  Menu,
  MenuItem,
  ListItemIcon,
  ListItemText,
  IconButton,
  Box,
  Typography,
} from "@mui/material";
import {
  MoreVert as MoreVertIcon,
  FolderOpen as FolderOpenIcon,
  CloudUpload as CloudUploadIcon,
  Add as AddIcon,
  Remove as RemoveIcon,
} from "@mui/icons-material";
import FolderView from "./components/FolderView";
import DeviceBrowser from "./components/DeviceBrowser";
import FolderManagementDialog from "./components/FolderManagementDialog";
import SearchBar from "./components/SearchBar";
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

const theme = createTheme({
  palette: {
    mode: "dark",
    primary: {
      main: "#f5f5f5", // Off-white
    },
    secondary: {
      main: "#1a1a1a", // Off-black
    },
    background: {
      default: "#121212", // Dark off-black
      paper: "#1e1e1e", // Slightly lighter off-black
    },
    text: {
      primary: "#f5f5f5", // Off-white text
      secondary: "#e0e0e0", // Lighter off-white
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 300,
      letterSpacing: "-0.01562em",
    },
    h6: {
      fontWeight: 400,
      letterSpacing: "0.00735em",
    },
  },
  components: {
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 20,
          textTransform: "none",
          fontWeight: 500,
        },
        contained: {
          boxShadow: "none",
          "&:hover": {
            boxShadow:
              "0px 2px 4px -1px rgba(0,0,0,0.2), 0px 4px 5px 0px rgba(0,0,0,0.14), 0px 1px 10px 0px rgba(0,0,0,0.12)",
          },
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: "none",
          border: "1px solid rgba(255,255,255,0.12)",
        },
      },
    },
    MuiTextField: {
      styleOverrides: {
        root: {
          "& .MuiOutlinedInput-root": {
            borderRadius: 16,
          },
        },
      },
    },
  },
});

function App() {
  // Load persisted data from localStorage
  const loadPersistedData = () => {
    try {
      const savedDirectories = localStorage.getItem("ocd-selected-directories");
      const savedImageSize = localStorage.getItem("ocd-image-size");
      const savedSidebarState = localStorage.getItem("ocd-sidebar-collapsed");

      return {
        directories: savedDirectories ? JSON.parse(savedDirectories) : [],
        imageSize: savedImageSize ? parseInt(savedImageSize, 10) : 4,
        sidebarCollapsed: savedSidebarState
          ? JSON.parse(savedSidebarState)
          : false,
      };
    } catch (error) {
      console.error("Error loading persisted data:", error);
      return {
        directories: [],
        imageSize: 4,
        sidebarCollapsed: false,
      };
    }
  };

  const persistedData = loadPersistedData();

  const [selectedSection, setSelectedSection] = useState<string>("photos");
  const [images, setImages] = useState<string[]>([]);
  const [directoryPaths, setDirectoryPaths] = useState<string[]>(
    persistedData.directories,
  );
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(
    persistedData.sidebarCollapsed,
  );
  const [isFolderManagementOpen, setIsFolderManagementOpen] =
    useState<boolean>(false);
  const [imageSize, setImageSize] = useState<number>(persistedData.imageSize);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);

  // Load images whenever directoryPaths changes (including from persisted data)
  useEffect(() => {
    if (directoryPaths.length > 0) {
      loadImagesFromPaths();
    } else {
      setImages([]);
    }
  }, [directoryPaths]);

  // Initialize Lenis smooth scrolling
  useEffect(() => {
    const lenis = new Lenis({
      duration: 1.2,
      easing: (t) => Math.min(1, 1.001 - Math.pow(2, -10 * t)),
    });

    function raf(time: number) {
      lenis.raf(time);
      requestAnimationFrame(raf);
    }

    requestAnimationFrame(raf);

    return () => {
      lenis.destroy();
    };
  }, []);

  // Handle scroll detection for search bar visibility
  useEffect(() => {
    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      setIsScrolled(scrollY > 50); // Hide search bar when scrolled down more than 50px
    };

    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Persist directory paths to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "ocd-selected-directories",
        JSON.stringify(directoryPaths),
      );
    } catch (error) {
      console.error("Error saving directory paths to localStorage:", error);
    }
  }, [directoryPaths]);

  // Persist image size to localStorage
  useEffect(() => {
    try {
      localStorage.setItem("ocd-image-size", imageSize.toString());
    } catch (error) {
      console.error("Error saving image size to localStorage:", error);
    }
  }, [imageSize]);

  // Persist sidebar state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        "ocd-sidebar-collapsed",
        JSON.stringify(isSidebarCollapsed),
      );
    } catch (error) {
      console.error("Error saving sidebar state to localStorage:", error);
    }
  }, [isSidebarCollapsed]);

  const handleAddFolders = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true,
        title: "Select Image Directories",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        // Add new paths to existing ones, avoiding duplicates
        setDirectoryPaths((prev) => {
          const combined = [...prev, ...paths];
          return Array.from(new Set(combined)); // Remove duplicates
        });

        // Auto-load images when directories are selected (load from all directories)
        await loadImagesFromPaths();
      }
    } catch (err) {
      console.error("Error opening directory picker:", err);
    }
  };

  const loadImagesFromPaths = async (pathsToLoad?: string[]) => {
    const paths = pathsToLoad || directoryPaths;
    console.log("Loading images from paths:", paths);

    if (paths.length === 0) {
      console.log("No paths to load from");
      return;
    }

    try {
      setIsLoadingImages(true);
      setLoadingProgress(0);
      const allImagePaths: string[] = [];

      // Process folders in batches to prevent UI blocking
      const batchSize = 3; // Process 3 folders concurrently
      const batches = [];

      for (let i = 0; i < paths.length; i += batchSize) {
        batches.push(paths.slice(i, i + batchSize));
      }

      for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
        const batch = batches[batchIndex];
        console.log(
          `Processing batch ${batchIndex + 1}/${batches.length}:`,
          batch,
        );

        // Process folders in this batch concurrently
        const batchPromises = batch.map(async (path, indexInBatch) => {
          try {
            console.log("Loading images from path:", path);
            const imagePaths: string[] = await invoke("list_files", {
              path: path,
              fileType: "images",
            });
            console.log(
              "Found images in",
              path,
              ":",
              imagePaths.length,
              "images",
            );

            // Update progress incrementally within the batch
            const currentProgress =
              ((batchIndex * batchSize + indexInBatch + 1) / paths.length) *
              100;
            setLoadingProgress(Math.min(currentProgress, 99)); // Cap at 99% until fully complete

            return imagePaths;
          } catch (error) {
            console.error(`Error loading images from ${path}:`, error);
            // Return empty array for failed folders instead of breaking entire process
            return [];
          }
        });

        // Wait for all folders in this batch to complete
        const batchResults = await Promise.all(batchPromises);

        // Add results to our collection
        batchResults.forEach((imagePaths) => {
          allImagePaths.push(...imagePaths);
        });

        // Add a small delay between batches to keep UI responsive
        if (batchIndex < batches.length - 1) {
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
      }

      // Remove duplicates (in case same image exists in multiple directories)
      const uniqueImages = Array.from(new Set(allImagePaths));
      console.log(
        "Total unique images found:",
        uniqueImages.length,
        "unique images from",
        allImagePaths.length,
        "total paths",
      );

      setImages(uniqueImages);
      setLoadingProgress(100);

      // Small delay to show completion before hiding
      setTimeout(() => {
        setIsLoadingImages(false);
        setLoadingProgress(0);
      }, 800); // Slightly longer to show completion
    } catch (err) {
      console.error("Error loading images:", err);
      setIsLoadingImages(false);
      setLoadingProgress(0);
    }
  };

  const handleRemoveDirectory = (pathToRemove: string) => {
    setDirectoryPaths((prev) => prev.filter((path) => path !== pathToRemove));
  };

  const handleSearch = (query: string) => {
    // TODO: Implement search filtering logic
    console.log("Search query:", query);
  };

  const handleIncreaseImageSize = () => {
    setImageSize((prev) => Math.min(prev + 1, 8)); // Max 8 columns
  };

  const handleDecreaseImageSize = () => {
    setImageSize((prev) => Math.max(prev - 1, 2)); // Min 2 columns
  };

  const handleImport = () => {
    // TODO: Implement import functionality
    console.log("Import functionality to be implemented");
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
    setIsMoreOptionsOpen(true);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setIsMoreOptionsOpen(false);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box sx={{ display: "flex", minHeight: "100vh" }}>
        {/* Fixed Sidebar */}
        <Box
          sx={{
            position: "fixed",
            left: 0,
            top: 0,
            height: "100vh",
            zIndex: 1000,
          }}
        >
          <Sidebar
            selectedSection={selectedSection}
            onSectionChange={setSelectedSection}
            collapsed={isSidebarCollapsed}
            onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
        </Box>

        {/* Main Content with left margin to account for fixed sidebar */}
        <Box
          sx={{
            flex: 1,
            marginLeft: isSidebarCollapsed ? "80px" : "280px",
            display: "flex",
            flexDirection: "column",
            transition: "margin-left 0.3s ease",
          }}
        >
          {/* Photo Grid */}
          <Box sx={{ flex: 1, padding: 3, paddingTop: 2, overflowY: "auto" }}>
            {selectedSection === "photos" ? (
              <PhotoGrid
                images={images}
                directoryPaths={directoryPaths}
                imageSize={imageSize}
              />
            ) : selectedSection === "folders" ? (
              <FolderView
                directoryPaths={directoryPaths}
                onAddFolders={handleAddFolders}
                onRemoveDirectory={handleRemoveDirectory}
              />
            ) : selectedSection === "devices" ? (
              <DeviceBrowser
                onFileSelect={async (files: string[]) => {
                  // When images are selected from a device, add them to the current images
                  setImages((prev) => [...prev, ...files]);
                }}
              />
            ) : (
              <Box
                sx={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  minHeight: "60vh",
                }}
              >
                <Typography variant="h6" color="text.secondary">
                  {selectedSection.charAt(0).toUpperCase() +
                    selectedSection.slice(1)}{" "}
                  view coming soon...
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </Box>

      {/* Search Bar */}
      <SearchBar
        onSearch={handleSearch}
        sidebarWidth={isSidebarCollapsed ? 80 : 280}
        isVisible={!isScrolled}
      />

      {/* Floating More Options Button */}
      <Fab
        color="primary"
        size="medium"
        sx={{
          position: "fixed",
          top: 24,
          right: 24,
          borderRadius: 3,
          boxShadow: 3,
          zIndex: 1000,
        }}
        onClick={handleMenuOpen}
      >
        <MoreVertIcon />
      </Fab>

      {/* More Options Menu */}
      <Menu
        anchorEl={menuAnchorEl}
        open={isMoreOptionsOpen}
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
            minWidth: 200,
            mt: 1,
          },
        }}
      >
        <MenuItem
          onClick={() => {
            handleMenuClose();
            setIsFolderManagementOpen(true);
          }}
        >
          <ListItemIcon>
            <FolderOpenIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Add folders</ListItemText>
        </MenuItem>
        <MenuItem
          onClick={() => {
            handleMenuClose();
            handleImport();
          }}
        >
          <ListItemIcon>
            <CloudUploadIcon fontSize="small" />
          </ListItemIcon>
          <ListItemText>Import</ListItemText>
        </MenuItem>
        <MenuItem sx={{ justifyContent: "center", py: 1.5 }}>
          <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
            <Typography
              variant="body2"
              sx={{ minWidth: 60, textAlign: "center" }}
            >
              Image size
            </Typography>
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleDecreaseImageSize();
                }}
                disabled={imageSize <= 2}
                sx={{ p: 0.5 }}
              >
                <RemoveIcon fontSize="small" />
              </IconButton>
              <Typography
                variant="body2"
                sx={{
                  minWidth: 24,
                  textAlign: "center",
                  fontWeight: 600,
                  color: "primary.main",
                }}
              >
                {imageSize}
              </Typography>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  handleIncreaseImageSize();
                }}
                disabled={imageSize >= 8}
                sx={{ p: 0.5 }}
              >
                <AddIcon fontSize="small" />
              </IconButton>
            </Box>
          </Box>
        </MenuItem>
      </Menu>

      {/* Folder Management Dialog */}
      <FolderManagementDialog
        open={isFolderManagementOpen}
        onClose={() => setIsFolderManagementOpen(false)}
        directoryPaths={directoryPaths}
        onAddFolders={handleAddFolders}
        onRemoveDirectory={handleRemoveDirectory}
        isLoadingImages={isLoadingImages}
        loadingProgress={loadingProgress}
      />
    </ThemeProvider>
  );
}

export default App;
