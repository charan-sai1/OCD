import { useState, useEffect, useCallback } from "react";
import { ThemeProvider } from "@mui/material/styles";
import CssBaseline from "@mui/material/CssBaseline";
import React, { Suspense, lazy } from "react";
import Fab from "@mui/material/Fab";
import Button from "@mui/material/Button";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import CircularProgress from "@mui/material/CircularProgress";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import { previewCache } from "./utils/previewCache";
import AddIcon from "@mui/icons-material/Add";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import AiIcon from "@mui/icons-material/AutoAwesome";
import { theme } from "./theme";
import "./styles/animations.css";

// Lazy load components for better initial bundle size
const Sidebar = lazy(() => import("./components/Sidebar"));
const OrganizedPhotoGrid = lazy(() => import("./components/OrganizedPhotoGrid"));
const FolderView = lazy(() => import("./components/FolderView"));
const DeviceBrowser = lazy(() => import("./components/DeviceBrowser"));
const FolderManagementDialog = lazy(() => import("./components/FolderManagementDialog"));
const SearchBar = lazy(() => import("./components/SearchBar"));
const FaceRecognitionPanel = lazy(() => import("./components/FaceRecognitionPanel"));
const ImageViewerModal = lazy(() => import("./components/ImageViewerModal"));
const FileImport = lazy(() => import("./components/FileImport"));
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
      const savedSidebarState = localStorage.getItem('ocd-sidebar-collapsed');
      const savedDirectoryCache = localStorage.getItem('ocd-directory-cache');

      let directoryPaths = savedDirectories ? JSON.parse(savedDirectories) : [];

      // TEMPORARY: Add a test directory if no directories are configured
      if (directoryPaths.length === 0) {
        directoryPaths = ['/Users/saicharan/Pictures'];
        console.log('[DEBUG] Added test directory:', directoryPaths);
      }

      return {
        directoryPaths,
        sidebarCollapsed: savedSidebarState ? JSON.parse(savedSidebarState) : false,
        directoryCache: savedDirectoryCache ? JSON.parse(savedDirectoryCache) : {},
      };
    } catch (error) {
      console.error('Error loading persisted data:', error);
      return {
        directoryPaths: ['/Users/saicharan/Pictures'], // Fallback test directory
        sidebarCollapsed: false,
        directoryCache: {},
      };
    }
  };

  const persistedData = loadPersistedData();

  const [selectedSection, setSelectedSection] = useState<string>("photos");
  const [selectedDeviceForImport, setSelectedDeviceForImport] = useState<string | null>(null);
  const [images, setImages] = useState<string[]>([]);
  const [directoryPaths, setDirectoryPaths] = useState<string[]>(
    persistedData.directoryPaths,
  );


  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(
    persistedData.sidebarCollapsed,
  );
  const [isFolderManagementOpen, setIsFolderManagementOpen] =
    useState<boolean>(false);
  const [sortOrder, setSortOrder] = useState<"newest" | "oldest">("newest");
  const [topBarHidden, setTopBarHidden] = useState<boolean>(false);
  const [directoryCache, setDirectoryCache] = useState<Record<string, { images: string[], timestamp: number, mtime?: number }>>(persistedData.directoryCache);
  const [isLoadingImages, setIsLoadingImages] = useState<boolean>(false);
   const [loadingProgress, setLoadingProgress] = useState<number>(0);
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

  // Image viewer modal state
  const [isImageViewerOpen, setIsImageViewerOpen] = useState<boolean>(false);
  const [currentImageIndex, setCurrentImageIndex] = useState<number>(0);

  // Register service worker for caching (only in production)
  useEffect(() => {
    // Temporarily skip service worker to avoid conflicts
    return;

    asyncScheduler.schedule(() => {
      if ('serviceWorker' in navigator) {
        navigator.serviceWorker.register('/sw.js')
          .then((_registration) => {
            // Service Worker registered successfully
          })
          .catch((_error) => {
            // Service Worker registration failed
          });
      } else {
        // Service Worker not supported in this browser
      }
    });
  }, []);

  // Initialize caches
  useEffect(() => {
    const initCaches = async () => {
      try {
        await previewCache.init();
        await advancedImageCache.init();
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
      setIsLoadingImages(false);
    }
  }, [directoryPaths]);



  // Handle scroll detection for top bar visibility
  useEffect(() => {
    let lastScrollY = 0;
    let ticking = false;

    const handleScroll = () => {
      if (!ticking) {
        requestAnimationFrame(() => {
          const scrollY = window.scrollY || window.pageYOffset;
          const scrollDirection = scrollY > lastScrollY ? 'down' : 'up';
          const scrollDelta = Math.abs(scrollY - lastScrollY);

          // Hide/show top bar based on scroll direction and distance
          if (scrollDirection === 'down' && scrollDelta > 10 && scrollY > 100) {
            setTopBarHidden(true);
          } else if (scrollDirection === 'up' && scrollDelta > 10) {
            setTopBarHidden(false);
          }



          lastScrollY = scrollY;
          ticking = false;
        });
        ticking = true;
      }
    };

    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  // Auto-collapse sidebar for medium screen sizes (510px - 620px)
  useEffect(() => {
    const handleResize = () => {
      const windowWidth = window.innerWidth;
      // Auto-collapse sidebar if window width is between 510px and 620px
      if (windowWidth >= 510 && windowWidth <= 620) {
        setIsSidebarCollapsed(true);
      }
      // Note: We don't auto-expand here to respect user preference
      // Users can still manually toggle it back open if desired
    };

    // Check on mount
    handleResize();

    // Listen for resize events
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  // Persist all settings to localStorage (batched for performance)
  useEffect(() => {
    try {
      localStorage.setItem("ocd-selected-directories", JSON.stringify(directoryPaths));
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
  }, [directoryPaths, isSidebarCollapsed, directoryCache]);

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

    if (paths.length === 0) {
      return;
    }

    performanceMonitor.start('total-image-loading');

    try {
      setIsLoadingImages(true);
      setLoadingProgress(0);

       // Try to use web worker for directory scanning
       const directoryScanner = await workerManager.getDirectoryScanner();
       const scanResults = await directoryScanner.scanDirectories(paths, directoryCache);

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
        } else {
          // Using cached data
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

       // Sort images based on sort order
       if (sortOrder === "newest") {
         // Sort by modification time (newest first)
         const { invoke } = await import('@tauri-apps/api/core');
         const imageStats = await Promise.all(
           allImagePaths.map(async (path) => {
             try {
               const stat = await invoke("get_file_info", { path });
               return { path, mtime: (stat as any).modified };
             } catch {
               return { path, mtime: 0 };
             }
           })
         );
         imageStats.sort((a, b) => b.mtime - a.mtime);
         setImages(imageStats.map(item => item.path));
       } else {
         // Sort by modification time (oldest first)
         const { invoke } = await import('@tauri-apps/api/core');
         const imageStats = await Promise.all(
           allImagePaths.map(async (path) => {
             try {
               const stat = await invoke("get_file_info", { path });
               return { path, mtime: (stat as any).modified };
             } catch {
               return { path, mtime: 0 };
             }
           })
         );
         imageStats.sort((a, b) => a.mtime - b.mtime);
         setImages(imageStats.map(item => item.path));
       }
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


        setImages(allImagePaths);
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

  const handleSearch = (_query: string) => {
    // TODO: Implement search filtering logic
  };



   const handleImageChange = useCallback((newIndex: number) => {
     setCurrentImageIndex(newIndex);
   }, []);

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

        setIsLoadingImages(true);
        setLoadingProgress(0);

        // Get all available image paths from cache or quick scan
        const allPaths = await getAllImagePaths();

        // For smaller collections (< 1000 images), load all at once
        // For larger collections, use progressive loading
        if (allPaths.length <= 1000) {
          setImages(allPaths);
          setLoadingProgress(100);
          setTimeout(() => {
            setIsLoadingImages(false);
          }, 1000);
        } else {
          // Take only the first N images for initial load
          const initialPaths = allPaths.slice(0, initialImageCount);
          setImages(initialPaths);
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

      // First, validate that directories exist before scanning them
      const validDirectoryPaths: string[] = [];
      console.log(`[Image Loading] Checking ${directoryPaths.length} directory paths:`, directoryPaths);
      for (const path of directoryPaths) {
        try {
          const fileInfo = await invoke("get_file_info", { path });
          if ((fileInfo as any).is_dir) {
            console.log(`[Image Loading] Valid directory found: ${path}`);
            validDirectoryPaths.push(path);
          } else {
            console.warn(`Path ${path} is not a directory, skipping`);
          }
        } catch (error) {
          console.warn(`Directory ${path} does not exist, removing from list:`, error);
          // Remove invalid path from directoryPaths
          setDirectoryPaths(prev => prev.filter(p => p !== path));
        }
      }
      console.log(`[Image Loading] Found ${validDirectoryPaths.length} valid directories to scan`);

      for (const path of validDirectoryPaths) {
        const cached = directoryCache[path];
        const now = Date.now();

        if (cached && (now - cached.timestamp) < CACHE_DURATION) {
          // Use cached data
          allPaths.push(...cached.images);
        } else {
          // Quick scan of directory
          try {
            console.log(`[Image Loading] Scanning directory for images: ${path}`);
            const imagePaths: string[] = await invoke("list_files", {
              path: path,
              fileType: "images",
            });
            console.log(`[Image Loading] Found ${imagePaths.length} images in ${path}:`, imagePaths.slice(0, 5)); // Show first 5
            allPaths.push(...imagePaths);

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
      console.log(`[Image Loading] Total unique images found: ${deduplicated.length}`);
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
        const asyncProcessor = await workerManager.getAsyncProcessor();
        result = await asyncProcessor.processBatch({
          id: 'load-remaining-images',
          data: remainingPaths,
          batchSize: 50,
          delay: 10,
        });
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
      }
    } catch (error) {
      console.error('Error in loadRemainingImages:', error);
      // Final fallback
      setImages(prev => [...prev, ...remainingPaths]);
    }

    setIsLoadingImages(false);
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
      <Box sx={{ display: "flex", height: "100vh", overflow: "hidden" }}>
        {/* Sidebar */}
        <Box
          sx={{
            width: isSidebarCollapsed ? "80px" : "280px",
            flexShrink: 0,
            transition: "width 0.3s ease",
          }}
        >
          <Sidebar
            selectedSection={selectedSection}
            onSectionChange={setSelectedSection}
            collapsed={isSidebarCollapsed}
            onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          />
        </Box>

        {/* Main Content */}
        <Box
          sx={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
          }}
        >
          {/* Scrollable Content */}
          <Box sx={{ flex: 1, overflowY: "auto" }}>
            {/* Sticky Controls Bar with Search */}
            <div style={{ padding: '16px 24px', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '16px', borderBottom: '1px solid rgba(0,0,0,0.12)', backgroundColor: 'var(--mui-palette-background-paper)', position: 'sticky', top: 0, zIndex: 100 }}>
              <div style={{ flex: 1 }}></div>
              <TextField
                placeholder="Search photos..."
                variant="outlined"
                size="small"
                onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleSearch(e.target.value)}
                InputProps={{
                  startAdornment: (
                    <InputAdornment position="start">
                      <AiIcon sx={{ color: 'rgba(0, 0, 0, 0.6)' }} />
                    </InputAdornment>
                  ),
                }}
                sx={{
                  maxWidth: 300,
                  '& .MuiOutlinedInput-root': {
                    borderRadius: 50,
                    backdropFilter: 'blur(16px) saturate(180%)',
                    background: `
                      linear-gradient(135deg,
                        rgba(255,255,255,0.2) 0%,
                        rgba(255,255,255,0.1) 25%,
                        rgba(255,255,255,0.08) 50%,
                        rgba(255,255,255,0.1) 75%,
                        rgba(255,255,255,0.2) 100%
                      )
                    `,
                    border: '1px solid rgba(255, 255, 255, 0.3)',
                    boxShadow: `
                      0 4px 16px rgba(0, 0, 0, 0.08),
                      0 1px 4px rgba(255, 255, 255, 0.2) inset,
                      0 -1px 2px rgba(0, 0, 0, 0.05) inset
                    `,
                    '& fieldset': {
                      border: 'none',
                    },
                    '&:hover': {
                      backdropFilter: 'blur(20px) saturate(200%)',
                      background: `
                        linear-gradient(135deg,
                          rgba(255,255,255,0.3) 0%,
                          rgba(255,255,255,0.2) 25%,
                          rgba(255,255,255,0.15) 50%,
                          rgba(255,255,255,0.2) 75%,
                          rgba(255,255,255,0.3) 100%
                        )
                      `,
                      boxShadow: `
                        0 6px 20px rgba(0, 0, 0, 0.12),
                        0 2px 8px rgba(255, 255, 255, 0.25) inset,
                        0 -2px 4px rgba(0, 0, 0, 0.08) inset
                      `,
                    },
                  },
                  '& .MuiInputAdornment-root .MuiSvgIcon-root': {
                    color: 'text.secondary',
                  },
                  '&.Mui-focused .MuiInputAdornment-root .MuiSvgIcon-root': {
                    color: '#9370db',
                  },
                  '& .MuiInputBase-input::placeholder': {
                    color: 'text.secondary',
                    opacity: 1,
                  },
                }}
              />
              <Button
                startIcon={sortOrder === "newest" ? <ArrowUpwardIcon /> : <ArrowDownwardIcon />}
                variant="outlined"
                onClick={async () => {
                  const newSortOrder = sortOrder === "newest" ? "oldest" : "newest";
                  setSortOrder(newSortOrder);
                  const { invoke } = await import('@tauri-apps/api/core');
                  const imageStats = await Promise.all(
                    images.map(async (path) => {
                      try {
                        const stat = await invoke("get_file_info", { path });
                        return { path, mtime: (stat as any).modified };
                      } catch {
                        return { path, mtime: 0 };
                      }
                    })
                  );
                  if (newSortOrder === "newest") {
                    imageStats.sort((a, b) => b.mtime - a.mtime);
                  } else {
                    imageStats.sort((a, b) => a.mtime - b.mtime);
                  }
                  setImages(imageStats.map(item => item.path));
                }}
                sx={{
                  backdropFilter: 'blur(16px) saturate(180%)',
                  background: `
                    linear-gradient(135deg,
                      rgba(255,255,255,0.2) 0%,
                      rgba(255,255,255,0.1) 25%,
                      rgba(255,255,255,0.08) 50%,
                      rgba(255,255,255,0.1) 75%,
                      rgba(255,255,255,0.2) 100%
                    )
                  `,
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: `
                    0 4px 16px rgba(0, 0, 0, 0.08),
                    0 1px 4px rgba(255, 255, 255, 0.2) inset,
                    0 -1px 2px rgba(0, 0, 0, 0.05) inset
                  `,
                   color: 'text.primary',
                  '&:hover': {
                    backdropFilter: 'blur(20px) saturate(200%)',
                    background: `
                      linear-gradient(135deg,
                        rgba(255,255,255,0.3) 0%,
                        rgba(255,255,255,0.2) 25%,
                        rgba(255,255,255,0.15) 50%,
                        rgba(255,255,255,0.2) 75%,
                        rgba(255,255,255,0.3) 100%
                      )
                    `,
                    boxShadow: `
                      0 6px 20px rgba(0, 0, 0, 0.12),
                      0 2px 8px rgba(255, 255, 255, 0.25) inset,
                      0 -2px 4px rgba(0, 0, 0, 0.08) inset
                    `,
                  },
                   '& .MuiButton-startIcon': {
                     color: 'text.secondary',
                   },
                }}
              >
                {sortOrder === "newest" ? "Newest" : "Oldest"}
              </Button>
              <Fab
                size="small"
                onClick={() => setIsFolderManagementOpen(true)}
                sx={{
                  backdropFilter: 'blur(16px) saturate(180%)',
                  background: `
                    linear-gradient(135deg,
                      rgba(255,255,255,0.2) 0%,
                      rgba(255,255,255,0.1) 25%,
                      rgba(255,255,255,0.08) 50%,
                      rgba(255,255,255,0.1) 75%,
                      rgba(255,255,255,0.2) 100%
                    )
                  `,
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  boxShadow: `
                    0 4px 16px rgba(0, 0, 0, 0.08),
                    0 1px 4px rgba(255, 255, 255, 0.2) inset,
                    0 -1px 2px rgba(0, 0, 0, 0.05) inset
                  `,
                  color: 'rgba(0, 0, 0, 0.7)',
                  '&:hover': {
                    backdropFilter: 'blur(20px) saturate(200%)',
                    background: `
                      linear-gradient(135deg,
                        rgba(255,255,255,0.3) 0%,
                        rgba(255,255,255,0.2) 25%,
                        rgba(255,255,255,0.15) 50%,
                        rgba(255,255,255,0.2) 75%,
                        rgba(255,255,255,0.3) 100%
                      )
                    `,
                    boxShadow: `
                      0 6px 20px rgba(0, 0, 0, 0.12),
                      0 2px 8px rgba(255, 255, 255, 0.25) inset,
                      0 -2px 4px rgba(0, 0, 0, 0.08) inset
                    `,
                  },
                }}
              >
                 <AddIcon sx={{ color: 'text.secondary' }} />
              </Fab>
            </div>

            {/* Main Content */}
            <div style={{ padding: '24px', paddingTop: '0px' }}>
              <Suspense fallback={
                <Box sx={{ display: "flex", justifyContent: "center", alignItems: "center", height: "60vh" }}>
                  <CircularProgress size={60} />
                </Box>
              }>
                 {selectedSection === "photos" ? (
                    <OrganizedPhotoGrid
                      images={images}
                      onImageClick={(imagePath) => {
                        const imageIndex = images.indexOf(imagePath);
                        if (imageIndex !== -1) {
                          setCurrentImageIndex(imageIndex);
                          setIsImageViewerOpen(true);
                        }
                      }}
                    />
                 ) : selectedSection === "import" ? (
                  <FileImport
                    initialSourceDir={selectedDeviceForImport}
                    onImportComplete={() => {
                      // Clear the selected device and go back to devices section
                      setSelectedDeviceForImport(null);
                      setSelectedSection("devices");
                    }}
                    onCancel={() => {
                      // Go back to devices section when cancelled
                      setSelectedDeviceForImport(null);
                      setSelectedSection("devices");
                    }}
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
                   onImportImages={(importedImages: string[]) => {
                     // When images are imported from a device, add them to the current images
                     setImages((prev) => [...prev, ...importedImages]);
                   }}
                   onDeviceClick={(devicePath: string) => {
                     // When a device is clicked, switch to import UI and set the device path
                     setSelectedDeviceForImport(devicePath);
                     setSelectedSection("import");
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
        </div>
      </Box>
        </Box>
      </Box>



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

      {/* Image Viewer Modal */}
      <Suspense fallback={null}>
        <ImageViewerModal
          open={isImageViewerOpen}
          onClose={() => setIsImageViewerOpen(false)}
          images={images}
          currentImageIndex={currentImageIndex}
          onImageChange={handleImageChange}
        />
      </Suspense>

    </ThemeProvider>
  );
}
export default App;
