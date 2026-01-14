import React, { useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import Grid from "@mui/material/Grid";
import Chip from "@mui/material/Chip";
import Snackbar from "@mui/material/Snackbar";
import Alert from "@mui/material/Alert";
import CircularProgress from "@mui/material/CircularProgress";
import Card from "@mui/material/Card";
import CardContent from "@mui/material/CardContent";
import RadioGroup from "@mui/material/RadioGroup";
import FormControlLabel from "@mui/material/FormControlLabel";
import Radio from "@mui/material/Radio";
import {
  FolderOpen as FolderOpenIcon,
  Save as SaveIcon,
  Image as ImageIcon,
  VideoLibrary as VideoIcon,
  Audiotrack as AudioIcon,
  Description as DocumentIcon,
  Archive as ArchiveIcon,
  Code as CodeIcon,
  ImportExport as ImportExportIcon,
  SmartToy as SmartToyIcon,
  FolderCopy as FolderCopyIcon,

  ArrowBack as ArrowBackIcon,
} from "@mui/icons-material";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";

interface FileCategory {
  id: string;
  label: string;
  icon: React.ReactElement;
  extensions: string[];
}

interface FileImportProps {
  initialSourceDir?: string | null;
  onImportComplete?: () => void;
  onCancel?: () => void;
}

const FileImport: React.FC<FileImportProps> = ({
  initialSourceDir,
  onImportComplete,
  onCancel
}) => {
  const [sourceDir, setSourceDir] = useState<string>("");
  const [destinationDir, setDestinationDir] = useState<string>("");
  const [selectedCategories, setSelectedCategories] = useState<string[]>([]);
  const [importMode, setImportMode] = useState<"smart" | "all">("smart");
  const [isImporting, setIsImporting] = useState(false);
  const [currentStep, setCurrentStep] = useState<"selection" | "preview">("selection");

  // Import preview data
  const [importPreview, setImportPreview] = useState<{
    totalFiles: number;
    totalSize: number;
    estimatedTime: string;
    isCalculating: boolean;
  }>({
    totalFiles: 0,
    totalSize: 0,
    estimatedTime: "0 min",
    isCalculating: false
  });



  const [snackbar, setSnackbar] = useState<{
    open: boolean;
    message: string;
    severity: 'success' | 'error' | 'warning' | 'info';
  }>({
    open: false,
    message: '',
    severity: 'info'
  });

  // Set initial source directory when component mounts or when initialSourceDir changes
  useEffect(() => {
    if (initialSourceDir) {
      setSourceDir(initialSourceDir);
    }
  }, [initialSourceDir]);

  const fileCategories: FileCategory[] = [
    {
      id: "images",
      label: "Images",
      icon: <ImageIcon />,
      extensions: ["jpg", "jpeg", "png", "gif", "bmp", "tiff", "webp", "svg"]
    },
    {
      id: "videos",
      label: "Videos",
      icon: <VideoIcon />,
      extensions: ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm"]
    },
    {
      id: "documents",
      label: "Documents",
      icon: <DocumentIcon />,
      extensions: ["pdf", "doc", "docx", "txt", "rtf", "odt"]
    },
    {
      id: "audio",
      label: "Audio",
      icon: <AudioIcon />,
      extensions: ["mp3", "wav", "flac", "aac", "ogg", "wma"]
    },
    {
      id: "archives",
      label: "Archives",
      icon: <ArchiveIcon />,
      extensions: ["zip", "rar", "7z", "tar", "gz", "bz2"]
    },
    {
      id: "code",
      label: "Code Files",
      icon: <CodeIcon />,
      extensions: ["js", "ts", "py", "java", "cpp", "c", "cs", "php", "rb", "html", "css", "json", "xml", "yaml", "yml"]
    }
  ];

  const handleSelectSourceDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Source Directory",
      });

      if (selected && !Array.isArray(selected)) {
        setSourceDir(selected);
      }
    } catch (error) {
      console.error("Error selecting source directory:", error);
    }
  };

  const handleSelectDestinationDir = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: "Select Destination Directory",
      });

      if (selected && !Array.isArray(selected)) {
        setDestinationDir(selected);
      }
    } catch (error) {
      console.error("Error selecting destination directory:", error);
    }
  };

  const handleCategoryToggle = (categoryId: string) => {
    setSelectedCategories(prev =>
      prev.includes(categoryId)
        ? prev.filter(id => id !== categoryId)
        : [...prev, categoryId]
    );
  };

  const calculateImportPreview = async () => {
    setImportPreview(prev => ({ ...prev, isCalculating: true }));

    // Mock calculation - in real implementation this would scan the source directory
    setTimeout(() => {
      const mockData = {
        totalFiles: Math.floor(Math.random() * 500) + 100,
        totalSize: Math.floor(Math.random() * 2000000000) + 100000000, // 100MB to 2GB
        estimatedTime: "2-5 min" // Mock time estimate
      };

      setImportPreview({
        totalFiles: mockData.totalFiles,
        totalSize: mockData.totalSize,
        estimatedTime: mockData.estimatedTime,
        isCalculating: false
      });
    }, 1000); // Simulate calculation delay
  };

  const handleNext = () => {
    if (!sourceDir || !destinationDir) {
      setSnackbar({
        open: true,
        message: "Please select source and destination directories",
        severity: 'warning'
      });
      return;
    }

    if (importMode === "smart" && selectedCategories.length === 0) {
      setSnackbar({
        open: true,
        message: "Please select at least one file category for Smart Import",
        severity: 'warning'
      });
      return;
    }

    setCurrentStep("preview");
    calculateImportPreview();
  };

  const handleImport = async () => {
    if (!sourceDir || !destinationDir) {
      return;
    }

    setIsImporting(true);

    try {
      let selectedExtensions: string[] = [];

      if (importMode === "all") {
        // Import all supported file types
        selectedExtensions = fileCategories.flatMap(cat => cat.extensions);
      } else if (importMode === "smart") {
        // Smart import - only files not already in system
        if (selectedCategories.length > 0) {
          selectedExtensions = selectedCategories.flatMap(
            categoryId => fileCategories.find(cat => cat.id === categoryId)?.extensions || []
          );
        } else {
          // Default smart categories if none selected
          const smartCategories = ["images", "videos", "documents"];
          selectedExtensions = smartCategories.flatMap(
            categoryId => fileCategories.find(cat => cat.id === categoryId)?.extensions || []
          );
        }
      }

      // Call backend to import files with additional options
      const result = await invoke("import_files", {
        sourcePath: sourceDir,
        destinationPath: destinationDir,
        fileExtensions: selectedExtensions,
        skipDuplicates: importMode === "smart" ? true : false,
        preserveStructure: true,
        importMode,
      });

      const importResult = result as any;

      // Show snackbar with summary
      const message = `Imported ${importResult.importedFiles} of ${importResult.totalFiles} files` +
        (importResult.skippedFiles > 0 ? ` (${importResult.skippedFiles} skipped)` : '');

      setSnackbar({
        open: true,
        message,
        severity: importResult.errors.length > 0 ? 'warning' : 'success'
      });

      onImportComplete?.();
    } catch (error) {
      console.error("Import failed:", error);

      setSnackbar({
        open: true,
        message: "Import failed",
        severity: 'error'
      });

      onImportComplete?.();
    } finally {
      setIsImporting(false);
    }
  };

  const canImport = sourceDir && destinationDir && !isImporting;

  return (
    <Box sx={{ p: 2, maxWidth: 1200, mx: "auto", pb: 4 }}>
      {/* Main Content */}
      <Grid container spacing={2}>

        {/* Folders Section */}
        <Grid item xs={12} md={8}>
          <Card sx={{
            borderRadius: 3,
            height: '100%',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
            border: '1px solid',
            borderColor: 'divider'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                <FolderCopyIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  Source & Destination
                </Typography>
              </Box>

              <Grid container spacing={2}>
                {/* Source Directory */}
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" sx={{ mb: 1, fontWeight: 500, color: 'text.secondary', fontSize: '0.85rem' }}>
                    FROM
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={sourceDir}
                    placeholder="Select source..."
                    InputProps={{ readOnly: true }}
                    sx={{ mb: 1 }}
                  />
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<FolderOpenIcon />}
                    onClick={handleSelectSourceDir}
                    size="small"
                    sx={{
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      borderRadius: 3,
                      py: 1,
                      textTransform: 'none',
                      backgroundColor: 'primary.main',
                      '&:hover': {
                        backgroundColor: 'primary.dark',
                        boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                      }
                    }}
                  >
                    Browse Source
                  </Button>
                </Grid>

                {/* Destination Directory */}
                <Grid item xs={12} sm={6}>
                  <Typography variant="body2" sx={{
                    mb: 1,
                    fontWeight: 500,
                    color: 'text.secondary',
                    fontSize: '0.85rem'
                  }}>
                    TO
                  </Typography>
                  <TextField
                    fullWidth
                    size="small"
                    value={destinationDir}
                    placeholder="Select destination..."
                    InputProps={{ readOnly: true }}
                    sx={{ mb: 1 }}
                  />
                  <Button
                    fullWidth
                    variant="contained"
                    startIcon={<SaveIcon />}
                    onClick={handleSelectDestinationDir}
                    size="small"
                    sx={{
                      fontSize: '0.85rem',
                      fontWeight: 500,
                      borderRadius: 3,
                      py: 1,
                      textTransform: 'none',
                      backgroundColor: 'primary.main',
                      '&:hover': {
                        backgroundColor: 'primary.dark',
                        boxShadow: '0 4px 8px rgba(0,0,0,0.15)'
                      }
                    }}
                  >
                    Browse Destination
                  </Button>
                </Grid>
              </Grid>
            </CardContent>
          </Card>
        </Grid>

        {/* Import Mode Section */}
        <Grid item xs={12} md={4}>
          <Card sx={{
            borderRadius: 3,
            height: '100%',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
            border: '1px solid',
            borderColor: 'divider'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 2 }}>
                <SmartToyIcon color="primary" />
                <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                  Import Mode
                </Typography>
              </Box>

              <RadioGroup
                value={importMode}
                onChange={(e) => setImportMode(e.target.value as any)}
                sx={{
                  '& .MuiFormControlLabel-label': { fontSize: '0.9rem' },
                  '& .MuiRadio-root': {
                    color: 'primary.main',
                    '&.Mui-checked': {
                      color: 'primary.main'
                    }
                  }
                }}
              >
                <FormControlLabel
                  value="smart"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{
                    fontWeight: 500,
                    fontSize: '0.9rem',
                    color: 'text.primary',
                    lineHeight: 1.2
                  }}>
                        Smart Import
                      </Typography>
                      <Typography variant="caption" sx={{
                        color: 'text.secondary',
                        fontSize: '0.8rem',
                        lineHeight: 1.3,
                        mt: 0.5
                      }}>
                        Only new files (skip duplicates)
                      </Typography>
                    </Box>
                  }
                />
                <FormControlLabel
                  value="all"
                  control={<Radio size="small" />}
                  label={
                    <Box>
                      <Typography variant="body2" sx={{
                        fontWeight: 500,
                        fontSize: '0.9rem',
                        color: 'text.primary',
                        lineHeight: 1.2
                      }}>
                        Import All
                      </Typography>
                      <Typography variant="caption" sx={{
                        color: 'text.secondary',
                        fontSize: '0.8rem',
                        lineHeight: 1.3,
                        mt: 0.5
                      }}>
                        All files including duplicates
                      </Typography>
                    </Box>
                  }
                />
              </RadioGroup>
            </CardContent>
          </Card>
        </Grid>

        {/* File Categories */}
        <Grid item xs={12}>
          <Card sx={{
            borderRadius: 3,
            boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
            border: '1px solid',
            borderColor: 'divider'
          }}>
            <CardContent sx={{ p: 3 }}>
              <Typography variant="h6" sx={{ mb: 2, fontWeight: 600, fontSize: '1.1rem' }}>
                Select File Categories
              </Typography>
              <Typography variant="body2" sx={{ mb: 2, color: 'text.secondary', fontSize: '0.85rem' }}>
                Choose which file types to import ({importMode === "smart" ? "optional" : "required"})
              </Typography>
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1.5 }}>
                {fileCategories.map((category) => (
                  <Chip
                    key={category.id}
                    icon={category.icon}
                    label={category.label}
                    size="small"
                    onClick={() => handleCategoryToggle(category.id)}
                    variant={selectedCategories.includes(category.id) ? "filled" : "outlined"}
                    color={selectedCategories.includes(category.id) ? "primary" : "default"}
                    sx={{
                      fontSize: '0.85rem',
                      fontWeight: selectedCategories.includes(category.id) ? 500 : 400,
                      minWidth: 85,
                      height: 36,
                      borderRadius: 2.5,
                      cursor: 'pointer',
                      transition: 'all 0.2s ease-in-out',
                      '&:hover': {
                        transform: 'translateY(-1px)',
                        boxShadow: '0 2px 8px rgba(0,0,0,0.1)'
                      },
                      '& .MuiChip-icon': {
                        color: selectedCategories.includes(category.id) ? 'inherit' : 'text.secondary'
                      }
                    }}
                  />
                ))}
              </Box>
            </CardContent>
          </Card>
        </Grid>




        {/* Import Preview Step */}
        {currentStep === "preview" && (
          <Grid item xs={12}>
            <Card sx={{
              borderRadius: 3,
              boxShadow: '0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24)',
              border: '1px solid',
              borderColor: 'divider',
              mb: 2
            }}>
              <CardContent sx={{ p: 3 }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 3 }}>
                  <ImportExportIcon color="primary" />
                  <Typography variant="h6" sx={{ fontWeight: 600, fontSize: '1.1rem' }}>
                    Import Preview
                  </Typography>
                </Box>

                {importPreview.isCalculating ? (
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', py: 4 }}>
                    <CircularProgress size={32} sx={{ mr: 2 }} />
                    <Typography variant="body1" color="text.secondary">
                      Calculating import details...
                    </Typography>
                  </Box>
                ) : (
                  <Grid container spacing={3}>
                    <Grid item xs={12} md={4}>
                      <Box sx={{ textAlign: 'center', p: 2 }}>
                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>
                          {importPreview.totalFiles.toLocaleString()}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Files to import
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Box sx={{ textAlign: 'center', p: 2 }}>
                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>
                          {(importPreview.totalSize / (1024 * 1024 * 1024)).toFixed(1)} GB
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Total size
                        </Typography>
                      </Box>
                    </Grid>
                    <Grid item xs={12} md={4}>
                      <Box sx={{ textAlign: 'center', p: 2 }}>
                        <Typography variant="h4" sx={{ fontWeight: 700, color: 'primary.main', mb: 1 }}>
                          {importPreview.estimatedTime}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                          Estimated time
                        </Typography>
                      </Box>
                    </Grid>
                  </Grid>
                )}
              </CardContent>
            </Card>
          </Grid>
        )}

        {/* Bottom Navigation */}
        <Grid item xs={12}>
          <Box sx={{
            position: 'fixed',
            bottom: 16,
            right: 16,
            display: 'flex',
            flexDirection: 'row',
            gap: 1
          }}>
            <Button
              variant="outlined"
              startIcon={<ArrowBackIcon />}
              onClick={currentStep === "preview" ? () => setCurrentStep("selection") : onCancel}
              disabled={isImporting}
              size="small"
              sx={{
                borderRadius: 8,
                px: 2,
                py: 1,
                fontSize: "0.8rem",
                fontWeight: 500,
                textTransform: 'none',
                minWidth: 'auto'
              }}
            >
              Back
            </Button>
            {currentStep === "preview" ? (
              <Button
                variant="contained"
                onClick={handleImport}
                disabled={isImporting}
                startIcon={isImporting ? <CircularProgress size={16} /> : <ImportExportIcon />}
                size="small"
                sx={{
                  borderRadius: 8,
                  px: 2,
                  py: 1,
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  textTransform: 'none',
                  minWidth: 'auto'
                }}
              >
                {isImporting ? "Importing..." : "Start Import"}
              </Button>
            ) : (
              <Button
                variant="contained"
                onClick={handleNext}
                disabled={!canImport}
                startIcon={<ImportExportIcon />}
                size="small"
                sx={{
                  borderRadius: 8,
                  px: 2,
                  py: 1,
                  fontSize: "0.8rem",
                  fontWeight: 500,
                  textTransform: 'none',
                  minWidth: 'auto'
                }}
              >
                Next
              </Button>
            )}
          </Box>
        </Grid>
      </Grid>

      {/* Snackbar for notifications */}
      <Snackbar
        open={snackbar.open}
        autoHideDuration={6000}
        onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }}
      >
        <Alert
          onClose={() => setSnackbar(prev => ({ ...prev, open: false }))}
          severity={snackbar.severity}
          variant="filled"
          sx={{ width: '100%', borderRadius: 2 }}
        >
          {snackbar.message}
        </Alert>
      </Snackbar>
    </Box>
  );
};

export default FileImport;