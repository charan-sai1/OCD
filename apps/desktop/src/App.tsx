import { useState, useEffect } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import React, { Suspense, lazy } from "react";
import Fab from "@mui/material/Fab";
import Menu from "@mui/material/Menu";
import MenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import IconButton from "@mui/material/IconButton";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import { previewCache } from "./utils/previewCache";
import MoreVertIcon from "@mui/icons-material/MoreVert";
import FolderOpenIcon from "@mui/icons-material/FolderOpen";
import CloudUploadIcon from "@mui/icons-material/CloudUpload";
import AddIcon from "@mui/icons-material/Add";
import RemoveIcon from "@mui/icons-material/Remove";
import { theme } from "./theme";
import "./styles/animations.css";

// Lazy load components for better initial bundle size
const Sidebar = lazy(() => import("./components/Sidebar"));
const PhotoGrid = lazy(() => import("./components/PhotoGrid"));
const FolderView = lazy(() => import("./components/FolderView"));
const DeviceBrowser = lazy(() => import("./components/DeviceBrowser"));
const FolderManagementDialog = lazy(() => import("./components/FolderManagementDialog"));
const SearchBar = lazy(() => import("./components/SearchBar"));
const FaceRecognitionPanel = lazy(() => import("./components/FaceRecognitionPanel"));
import { open } from "@tauri-apps/plugin-dialog";
import { performanceMonitor } from "./utils/performanceMonitor";
import { workerManager } from "./utils/workerManager";
import { imagePreloader } from "./utils/imagePreloader";
import { asyncScheduler } from "./utils/requestIdleCallbackPolyfill";
import { thumbnailGenerationService } from "./utils/thumbnailGenerationService";
import { advancedImageCache } from "./utils/advancedCache";
import OptimizationProgress, { OptimizationState } from "./components/OptimizationProgress";

function App() {
  // Load persisted data from localStorage
  const loadPersistedData = () => {
    try {
      const savedDirectories = localStorage.getItem('ocd-selected-directories');
      const savedImageSize = localStorage.getItem('ocd-image-size');
      const savedSidebarState = localStorage.getItem('ocd-sidebar-collapsed');
      const savedDirectoryCache = localStorage.getItem('ocd-directory-cache');

      return {
        directories: savedDirectories ? JSON.parse(savedDirectories) : [],
        imageSize: savedImageSize ? parseInt(savedImageSize, 10) : 4,
        sidebarCollapsed: savedSidebarState ? JSON.parse(savedSidebarState) : false,
        directoryCache: savedDirectoryCache ? JSON.parse(savedDirectoryCache) : {},
      };
    } catch (error) {
      console.error('Error loading persisted data:', error);
      return {
        directories: [],
        imageSize: 4,
        sidebarCollapsed: false,
        directoryCache: {},
      };
    }
  };

  const persistedData = loadPersistedData();
  console.log('Loaded persisted data:', persistedData);

  const [selectedSection, setSelectedSection] = useState<string>("photos");
  const [images, setImages] = useState<string[]>([]);
  const [directoryPaths, setDirectoryPaths] = useState<string[]>(
    persistedData.directories,
  );
  console.log('Initial directory paths:', directoryPaths);


  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(
    persistedData.sidebarCollapsed,
  );
  const [isFolderManagementOpen, setIsFolderManagementOpen] =
    useState<boolean>(false);
  const [imageSize, setImageSize] = useState<number>(persistedData.imageSize);
  const [isMoreOptionsOpen, setIsMoreOptionsOpen] = useState<boolean>(false);
  const [menuAnchorEl, setMenuAnchorEl] = useState<null | HTMLElement>(null);
  const [isScrolled, setIsScrolled] = useState<boolean>(false);
  const [directoryCache, setDirectoryCache] = useState<Record<string, { images: string[], timestamp: number, mtime?: number }>>(persistedData.directoryCache);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(false);
  const [loadingProgress, setLoadingProgress] = useState<number>(0);
  const [totalFilesInDirectory, setTotalFilesInDirectory] = useState<number | undefined>(undefined);
   const [optimizationState, setOptimizationState] = useState<OptimizationState>({
     isScanning: false,
     isGenerating: false,
     scanProgress: 0,
     generationProgress: 0,
     totalImages: 0,
     processedImages: 0,
     currentFile: undefined,
     canMinimize: true
   });

  // Register service worker for caching (only in production)
  useEffect(() => {
    // Temporarily skip service worker to avoid conflicts
    console.log('Skipping service worker registration');
    return;

    asyncScheduler.schedule(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
          .then((registration) => {
            console.log('Service Worker registered successfully:', registration);
          })
          .catch((error) => {
            console.log('Service Worker registration failed:', error);
          });
      } else {
        console.log('Service Worker not supported in this browser');
      }
    });
  }, []);

  // Initialize caches
  useEffect(() => {
    const initCaches = async () => {
      try {
        await previewCache.init();
        await advancedImageCache.init();
        console.log('Image caches initialized successfully');
      } catch (error) {
        console.error('Failed to initialize caches:', error);
      }
    };
    initCaches();
  }, []);

  // Load initial viewport images in background (not all images)
  useEffect(() => {
    if (directoryPaths.length > 0) {
      setIsLoadingImages(true); // Show loading immediately
      loadInitialViewportImages().catch((error) => {
        console.error('Error in initial image loading:', error);
        setIsLoadingImages(false);
      });
    } else {
      setImages([]);
      setTotalFilesInDirectory(0);
      setIsLoadingImages(false);
    }
  }, [directoryPaths]);



  // Handle scroll detection for search bar visibility
  useEffect(() => {
    let scrollCount = 0;
    const handleScroll = () => {
      const scrollY = window.scrollY || window.pageYOffset;
      setIsScrolled(scrollY > 50); // Hide search bar when scrolled down more than 50px

      // Debug logging for scroll issues
      scrollCount++;
      if (scrollCount % 20 === 0 && process.env.NODE_ENV === 'development') {
        console.log('App: Scroll event detected', { scrollY, scrollCount, timestamp: Date.now() });
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Persist all settings to localStorage (batched for performance)
  useEffect(() => {
    try {
      localStorage.setItem("ocd-selected-directories", JSON.stringify(directoryPaths));
      localStorage.setItem("ocd-image-size", imageSize.toString());
      localStorage.setItem("ocd-sidebar-collapsed", JSON.stringify(isSidebarCollapsed));
      const recentCache = Object.fromEntries(
        Object.entries(directoryCache)
          .filter(([_, data]) => Date.now() - data.timestamp < 30 * 60 * 1000)
          .slice(-10)
      );
      localStorage.setItem("ocd-directory-cache", JSON.stringify(recentCache));
    } catch (error) {
      console.error("Error saving settings to localStorage:", error);
    }
  }, [directoryPaths, imageSize, isSidebarCollapsed, directoryCache]);

   const handleAddFolders = async () => {
     // Schedule directory selection asynchronously
     asyncScheduler.schedule(async () => {
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

           // Start optimization process for new folders
           await optimizeNewFolders(paths);
         }
       } catch (err) {
         console.error("Error opening directory picker:", err);
       }
     });
   };

   const optimizeNewFolders = async (newPaths: string[]) => {
     try {
       // Phase 1: Scan directories
       setOptimizationState(prev => ({ ...prev, isScanning: true, scanProgress: 0 }));

       const allImages = await scanDirectoriesForImages(newPaths);

       setOptimizationState(prev => ({
         ...prev,
         isScanning: false,
         isGenerating: true,
         totalImages: allImages.length,
         generationProgress: 0
       }));

       // Phase 2: Generate thumbnails
       const deviceProfile = await import('./utils/deviceCapabilities').then(m => m.DeviceCapabilities.detect());

       await thumbnailGenerationService.generateThumbnailsForImages(
         allImages,
         {
           quality: deviceProfile.recommendedSettings.quality,
           format: 'webp',
           maxConcurrent: deviceProfile.recommendedSettings.batchSize,
           deviceAdaptive: true
         },
         (completed, total, currentFile) => {
           setOptimizationState(prev => ({
             ...prev,
             processedImages: completed,
             generationProgress: (completed / total) * 100,
             currentFile
           }));
         }
       );

       // Phase 3: Complete and load images
       setOptimizationState(prev => ({
         ...prev,
         isGenerating: false
       }));

       console.log('Thumbnail optimization complete!');

       // Now load the images (they should load instantly from cache)
       asyncScheduler.schedule(() => loadImagesFromPaths(newPaths), { timeout: 100 });

     } catch (error) {
       console.error('Optimization failed:', error);
       setOptimizationState(prev => ({
         ...prev,
         isScanning: false,
         isGenerating: false
       }));

       // Fallback: load images without optimization
       asyncScheduler.schedule(() => loadImagesFromPaths(newPaths), { timeout: 100 });
     }
   };

   const scanDirectoriesForImages = async (paths: string[]): Promise<string[]> => {
     const allImages: string[] = [];

     for (let i = 0; i < paths.length; i++) {
       const path = paths[i];
       try {
         const { invoke } = await import('@tauri-apps/api/core');
         const imagePaths: string[] = await invoke("list_files", {
           path: path,
           fileType: "images",
         });
         allImages.push(...imagePaths);

         // Update scan progress
         setOptimizationState(prev => ({
           ...prev,
           scanProgress: ((i + 1) / paths.length) * 100,
           currentFile: path.split('/').pop()
         }));

       } catch (error) {
         console.error(`Error scanning ${path}:`, error);
       }
     }

     return allImages;
   };

  const loadImagesFromPaths = async (pathsToLoad?: string[]) => {
    const paths = pathsToLoad || directoryPaths;
    console.log("Loading images from paths:", paths);

    if (paths.length === 0) {
      console.log("No paths to load from");
      return;
    }

    performanceMonitor.start('total-image-loading');

    try {
      setIsLoadingImages(true);
      setLoadingProgress(0);

      // Try to use web worker for directory scanning
      console.log('Attempting to use directory scanner worker...');

      const directoryScanner = await workerManager.getDirectoryScanner();
      const scanResults = await directoryScanner.scanDirectories(paths, directoryCache);
      console.log('Directory scanner worker succeeded');

      const allImagePaths: string[] = [];
      const seenPaths = new Set<string>();
      const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

        // Process scan results asynchronously
        for (let i = 0; i < scanResults.length; i++) {
          const result = scanResults[i];
          const path = result.path;
          const images = Array.isArray(result.images) ? result.images as string[] : [];
          const error = result.error;

        if (error) {
          console.error(`Error scanning ${path}:`, error);
          // Remove failed directory from cache
          setDirectoryCache(prev => {
            const updated = { ...prev };
            delete updated[path];
            return updated;
          });
          continue;
        }

        // Update cache for newly scanned directories
        const now = Date.now();
        const cached = directoryCache[path];
        if (!cached || (now - cached.timestamp) >= CACHE_DURATION) {
          setDirectoryCache(prev => ({
            ...prev,
            [path]: {
              images,
              timestamp: now,
            }
          }));
          console.log(`Scanned ${images.length} images in ${path}`);
        } else {
          console.log(`Using cached data for ${path} (${images.length} images)`);
        }

        // Add to collection with deduplication
        for (const imagePath of images) {
          if (!seenPaths.has(imagePath)) {
            seenPaths.add(imagePath);
            allImagePaths.push(imagePath);
          }
        }

        // Update progress incrementally
        const progress = ((i + 1) / scanResults.length) * 100;
        setLoadingProgress(Math.min(progress, 99));

        // Yield control between directories
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      console.log(
        `Loading complete - total unique images: ${allImagePaths.length}`
      );

      setImages(allImagePaths);
      setTotalFilesInDirectory(allImagePaths.length);
      setLoadingProgress(100);

      performanceMonitor.end('total-image-loading');

      // Log performance stats asynchronously
      asyncScheduler.schedule(() => {
        performanceMonitor.logAllStats();
      });

      // Show completion state briefly
      setTimeout(() => {
        setIsLoadingImages(false);
        setLoadingProgress(0);
      }, 1000);

    } catch (err) {
      console.error("Worker scanning failed, attempting fallback:", err);

      // Fallback to synchronous scanning
      console.log('Attempting fallback synchronous scanning...');
      try {
        const { invoke } = await import('@tauri-apps/api/core');
        const scanResults: any[] = [];

        for (let i = 0; i < paths.length; i++) {
          const path = paths[i];
          try {
            const imagesResult = await invoke("list_files", {
              path: path,
              fileType: "images",
            });

            // Ensure images is an array of strings
            const images = Array.isArray(imagesResult) ? imagesResult as string[] : [];

            // Update cache
            setDirectoryCache(prev => ({
              ...prev,
              [path]: {
                images,
                timestamp: Date.now(),
              }
            }));

            scanResults.push({ path, images });
            console.log(`Scanned ${images.length} images from ${path}`);
          } catch (scanError) {
            console.error(`Error scanning ${path}:`, scanError);
            const errorMessage = scanError instanceof Error ? scanError.message : 'Unknown error';
            scanResults.push({ path, images: [], error: errorMessage });
          }
        }

        // Process scan results
        const allImagePaths: string[] = [];
        const seenPaths = new Set<string>();

        for (let i = 0; i < scanResults.length; i++) {
          const result = scanResults[i];
          const images = Array.isArray(result.images) ? result.images as string[] : [];
          const error = result.error;

          if (error) {
            console.error(`Error scanning ${result.path}:`, error);
            continue;
          }

          // Add to collection with deduplication
          for (const imagePath of images) {
            if (!seenPaths.has(imagePath)) {
              seenPaths.add(imagePath);
              allImagePaths.push(imagePath);
            }
          }
        }

        console.log(`Fallback scanning complete - total unique images: ${allImagePaths.length}`);
        setImages(allImagePaths);
        setTotalFilesInDirectory(allImagePaths.length);
        setLoadingProgress(100);

        setTimeout(() => {
          setIsLoadingImages(false);
          setLoadingProgress(0);
        }, 1000);

      } catch (fallbackError) {
        console.error('Fallback scanning also failed:', fallbackError);
        setIsLoadingImages(false);
        setLoadingProgress(0);
      }
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

  const loadInitialViewportImages = async () => {
    // Schedule initial loading asynchronously to prevent blocking
    asyncScheduler.schedule(async () => {
      try {
        // Calculate how many images we need for initial viewport (2x viewport height)
        const viewportHeight = window.innerHeight - 200; // Account for header/footer
        const imageSize = 4; // Default columns
        const itemHeight = Math.floor((window.innerWidth - 80) / imageSize); // Approximate item height
        const imagesPerRow = imageSize;
        const rowsInViewport = Math.ceil(viewportHeight / itemHeight);
        const initialImageCount = rowsInViewport * imagesPerRow * 2; // 2x viewport for smooth scrolling

        console.log(`Loading ${initialImageCount} images for initial viewport`);

        setIsLoadingImages(true);
        setLoadingProgress(0);

        // Get all available image paths from cache or quick scan
        const allPaths = await getAllImagePaths();

        console.log(`Found ${allPaths.length} total images`);

        // For smaller collections (< 1000 images), load all at once
        // For larger collections, use progressive loading
        if (allPaths.length <= 1000) {
          console.log(`Loading all ${allPaths.length} images at once`);
          setImages(allPaths);
          setTotalFilesInDirectory(allPaths.length);
          setLoadingProgress(100);
          setTimeout(() => {
            setIsLoadingImages(false);
          }, 1000);
        } else {
          // Take only the first N images for initial load
          const initialPaths = allPaths.slice(0, initialImageCount);

          console.log(`Loading ${initialPaths.length} initial images (${allPaths.length} total)`);
          setImages(initialPaths);
          setTotalFilesInDirectory(allPaths.length);
          setLoadingProgress(100);

          // Start background loading of remaining images asynchronously
          asyncScheduler.schedule(() => {
            loadRemainingImages(allPaths, initialImageCount);
          }, { timeout: 2000 }); // Timeout ensures it runs even if not idle
        }

      } catch (error) {
        console.error("Error loading initial viewport images:", error);
        setIsLoadingImages(false);
      }
    });
  };

  const getAllImagePaths = async (): Promise<string[]> => {
    try {
      // Import the invoke function dynamically to avoid main thread dependencies
      const { invoke } = await import('@tauri-apps/api/core');

      // Use cached data if available, otherwise do quick scan
      const allPaths: string[] = [];
      const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

      for (const path of directoryPaths) {
        const cached = directoryCache[path];
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          // Use cached data
          allPaths.push(...cached.images);
          console.log(`Using cached data for ${path}: ${cached.images.length} images`);
        } else {
          // Quick scan of directory
          try {
            const imagePaths: string[] = await invoke("list_files", {
              path: path,
              fileType: "images",
            });
            allPaths.push(...imagePaths);
            console.log(`Scanned ${imagePaths.length} images from ${path}`);

            // Update cache
            setDirectoryCache(prev => ({
              ...prev,
              [path]: {
                images: imagePaths,
                timestamp: now,
              }
            }));
          } catch (error) {
            console.error(`Error scanning ${path}:`, error);
          }
        }

        // Yield control between directories to prevent blocking
        await new Promise(resolve => setTimeout(resolve, 0));
      }

      const deduplicated = Array.from(new Set(allPaths));
      console.log(`Total unique images found: ${deduplicated.length}`);
      return deduplicated;
    } catch (error) {
      console.error('Error in getAllImagePaths:', error);
      return [];
    }
  };

  const loadRemainingImages = async (allPaths: string[], loadedCount: number) => {
    const remainingPaths = allPaths.slice(loadedCount);

    if (remainingPaths.length === 0) {
      setIsLoadingImages(false);
      return;
    }

    try {
      let result;

      try {
        // Try to use async processor worker
        console.log('Attempting to use async processor worker...');
        const asyncProcessor = await workerManager.getAsyncProcessor();
        result = await asyncProcessor.processBatch({
          id: 'load-remaining-images',
          data: remainingPaths,
          batchSize: 50,
          delay: 10,
        });
        console.log('Async processor worker succeeded');
      } catch (workerError) {
        console.warn('Async processor worker failed, falling back to direct processing:', workerError);

        // Fallback: process in batches manually
        result = {
          completed: true,
          processed: remainingPaths,
        };
      }

      if (result.completed) {
        // Update images state with all processed items
        setImages(prev => [...prev, ...result.processed]);
        console.log(`Loaded ${result.processed.length} additional images`);
      }
    } catch (error) {
      console.error('Error in loadRemainingImages:', error);
      // Final fallback
      setImages(prev => [...prev, ...remainingPaths]);
    }

    setIsLoadingImages(false);
  };

  const handleMenuOpen = (event: React.MouseEvent<HTMLElement>) => {
    setMenuAnchorEl(event.currentTarget);
    setIsMoreOptionsOpen(true);
  };

  const handleMenuClose = () => {
    setMenuAnchorEl(null);
    setIsMoreOptionsOpen(false);
  };

  // Cleanup workers and preloader when app unmounts
  React.useEffect(() => {
    return () => {
      workerManager.terminateAll().catch(console.error);
      imagePreloader.clear();
    };
  }, []);

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
            <Suspense fallback={
              <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
                <CircularProgress size={60} />
              </Box>
            }>
              {selectedSection === "photos" ? (
                <PhotoGrid
                  images={images}
                  directoryPaths={directoryPaths}
                  imageSize={imageSize}
                  isLoadingImages={isLoadingImages}
                  showStatusIndicator={true}
                  totalFilesInDirectory={totalFilesInDirectory}
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
                    setImages((prev) => {
                      const newImages = [...prev, ...files];
                      setTotalFilesInDirectory(newImages.length);
                      return newImages;
                    });
                  }}
                  onImportImages={(importedImages: string[]) => {
                    // When images are imported from a device, add them to the current images
                    setImages((prev) => {
                      const newImages = [...prev, ...importedImages];
                      setTotalFilesInDirectory(newImages.length);
                      return newImages;
                    });
                  }}
               />
             ) : selectedSection === "faces" ? (
               <FaceRecognitionPanel
                 isVisible={true}
                 onClose={() => setSelectedSection("photos")}
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
          </Suspense>
        </Box>
        </Box>
      </Box>

      {/* Search Bar */}
      <Suspense fallback={null}>
        <SearchBar
          onSearch={handleSearch}
          sidebarWidth={isSidebarCollapsed ? 80 : 280}
          isVisible={!isScrolled}
        />
      </Suspense>

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
      <Suspense fallback={null}>
        <FolderManagementDialog
          open={isFolderManagementOpen}
          onClose={() => setIsFolderManagementOpen(false)}
          directoryPaths={directoryPaths}
          onAddFolders={handleAddFolders}
          onRemoveDirectory={handleRemoveDirectory}
          isLoadingImages={isLoadingImages}
          loadingProgress={loadingProgress}
        />
      </Suspense>

      {/* Optimization Progress Dialog */}
      <OptimizationProgress
        state={optimizationState}
        onSkip={() => {
          thumbnailGenerationService.cancel();
          setOptimizationState(prev => ({ ...prev, isScanning: false, isGenerating: false }));
          // Load images without waiting for optimization
          asyncScheduler.schedule(() => loadImagesFromPaths(), { timeout: 100 });
        }}
        onBackground={() => {
          setOptimizationState(prev => ({ ...prev, canMinimize: false }));
          // Continue optimization in background
        }}
        onCancel={() => {
          thumbnailGenerationService.cancel();
          setOptimizationState(prev => ({ ...prev, isScanning: false, isGenerating: false }));
        }}
      />
    </ThemeProvider>
  );
}

export default App;
