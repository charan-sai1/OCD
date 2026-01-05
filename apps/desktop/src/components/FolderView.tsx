import React, { useState, useEffect } from "react";
import {
  Box,
  Typography,
  Button,
  Paper,
  ToggleButton,
  ToggleButtonGroup,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Chip,
  IconButton,
} from "@mui/material";
import {
  Folder as FolderIcon,
  ExpandMore as ExpandMoreIcon,
  Description as FileIcon,
  Image as ImageIcon,
  PictureAsPdf as PdfIcon,
} from "@mui/icons-material";
import { invoke, convertFileSrc } from "@tauri-apps/api/core";

interface FileItem {
  path: string;
  name: string;
  extension: string;
  type: "image" | "pdf" | "other";
}

interface FolderItem {
  path: string;
  name: string;
  files: FileItem[];
}

interface FolderViewProps {
  directoryPaths: string[];
  onAddFolders: () => void;
  onRemoveDirectory: (path: string) => void;
}

const FolderView: React.FC<FolderViewProps> = ({
  directoryPaths,
  onAddFolders,
  onRemoveDirectory,
}) => {
  const [fileTypeFilter, setFileTypeFilter] = useState<
    "images" | "pdfs" | "all"
  >("all");
  const [folders, setFolders] = useState<FolderItem[]>([]);

  // Load files when directories change
  useEffect(() => {
    if (directoryPaths.length > 0) {
      loadFiles();
    } else {
      setFolders([]);
    }
  }, [directoryPaths]);

  const loadFiles = async () => {
    try {
      const folderData: FolderItem[] = [];

      for (const dirPath of directoryPaths) {
        const files: string[] = await invoke("list_files", {
          path: dirPath,
          fileType: "all",
        });

        const fileItems: FileItem[] = files.map((filePath) => {
          const fileName = filePath.split("/").pop() || "";
          const extension = fileName.split(".").pop() || "";
          const fileType = getFileType(extension);

          return {
            path: filePath,
            name: fileName,
            extension,
            type: fileType,
          };
        });

        folderData.push({
          path: dirPath,
          name: dirPath.split("/").pop() || "Unknown Folder",
          files: fileItems,
        });
      }

      setFolders(folderData);
    } catch (error) {
      console.error("Error loading files:", error);
    }
  };

  const handleFileTypeChange = (
    _event: React.MouseEvent<HTMLElement>,
    newFilter: "images" | "pdfs" | "all" | null,
  ) => {
    if (newFilter !== null) {
      setFileTypeFilter(newFilter);
    }
  };

  const getFileType = (extension: string): "image" | "pdf" | "other" => {
    const imageExts = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];
    const pdfExts = ["pdf"];

    if (imageExts.includes(extension.toLowerCase())) return "image";
    if (pdfExts.includes(extension.toLowerCase())) return "pdf";
    return "other";
  };

  const getFileIcon = (fileType: "image" | "pdf" | "other") => {
    switch (fileType) {
      case "image":
        return <ImageIcon sx={{ fontSize: 20 }} />;
      case "pdf":
        return <PdfIcon sx={{ fontSize: 20 }} />;
      default:
        return <FileIcon sx={{ fontSize: 20 }} />;
    }
  };

  const filteredFolders = folders
    .map((folder) => ({
      ...folder,
      files: folder.files.filter((file) => {
        if (fileTypeFilter === "all") return true;
        return file.type === (fileTypeFilter === "images" ? "image" : "pdf");
      }),
    }))
    .filter((folder) => folder.files.length > 0);

  if (directoryPaths.length === 0) {
    return (
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          minHeight: "60vh",
          textAlign: "center",
        }}
      >
        <FolderIcon
          sx={{
            fontSize: 80,
            color: "text.disabled",
            marginBottom: 2,
          }}
        />
        <Typography
          variant="h6"
          sx={{
            color: "text.secondary",
            marginBottom: 1,
          }}
        >
          No folders selected
        </Typography>
        <Typography
          variant="body2"
          sx={{
            color: "text.disabled",
            marginBottom: 3,
          }}
        >
          Select folders to view their contents
        </Typography>
        <Button
          variant="contained"
          startIcon={<FolderIcon />}
          onClick={onAddFolders}
          sx={{
            borderRadius: 28,
            paddingX: 3,
            paddingY: 1.5,
          }}
        >
          Select Folders
        </Button>
      </Box>
    );
  }

  return (
    <Box>
      {/* Selected Directories */}
      <Box sx={{ marginBottom: 3 }}>
        <Typography
          variant="body2"
          sx={{
            color: "text.secondary",
            marginBottom: 1,
          }}
        >
          Selected folders ({directoryPaths.length}):
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 1 }}>
          {directoryPaths.map((path, index) => (
            <Box
              key={index}
              sx={{
                display: "flex",
                alignItems: "center",
                backgroundColor: "background.paper",
                borderRadius: 2,
                padding: "4px 8px",
                border: `1px solid rgba(255,255,255,0.12)`,
              }}
            >
              <FolderIcon
                sx={{ fontSize: 16, marginRight: 1, color: "text.secondary" }}
              />
              <Typography
                variant="body2"
                sx={{
                  fontSize: "0.75rem",
                  color: "text.primary",
                  marginRight: 1,
                }}
              >
                {path.split("/").pop()}
              </Typography>
              <IconButton
                size="small"
                onClick={() => onRemoveDirectory(path)}
                sx={{
                  padding: "2px",
                  "&:hover": {
                    backgroundColor: "action.hover",
                  },
                }}
              >
                <Typography
                  variant="body2"
                  sx={{ fontSize: "1rem", lineHeight: 1 }}
                >
                  ×
                </Typography>
              </IconButton>
            </Box>
          ))}
        </Box>
      </Box>

      {/* File Type Filter */}
      <Paper
        sx={{
          padding: 2,
          marginBottom: 3,
          backgroundColor: "background.paper",
        }}
      >
        <Typography
          variant="body2"
          sx={{ marginBottom: 2, color: "text.secondary" }}
        >
          Filter by file type:
        </Typography>
        <ToggleButtonGroup
          value={fileTypeFilter}
          exclusive
          onChange={handleFileTypeChange}
          sx={{
            "& .MuiToggleButton-root": {
              borderRadius: "20px !important",
              marginRight: 1,
              textTransform: "none",
              "&.Mui-selected": {
                backgroundColor: "primary.main",
                color: "primary.contrastText",
                "&:hover": {
                  backgroundColor: "primary.dark",
                },
              },
            },
          }}
        >
          <ToggleButton value="all">All Files</ToggleButton>
          <ToggleButton value="images">Images</ToggleButton>
          <ToggleButton value="pdfs">PDFs</ToggleButton>
        </ToggleButtonGroup>
      </Paper>

      {/* Folder Accordions */}
      <Box>
        {filteredFolders.length === 0 ? (
          <Box
            sx={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              justifyContent: "center",
              minHeight: "30vh",
              textAlign: "center",
            }}
          >
            <FileIcon
              sx={{
                fontSize: 60,
                color: "text.disabled",
                marginBottom: 2,
              }}
            />
            <Typography
              variant="body1"
              sx={{
                color: "text.secondary",
              }}
            >
              No {fileTypeFilter === "all" ? "files" : fileTypeFilter} found in
              selected folders
            </Typography>
          </Box>
        ) : (
          filteredFolders.map((folder, folderIndex) => (
            <Accordion
              key={folderIndex}
              defaultExpanded={filteredFolders.length === 1}
              sx={{
                marginBottom: 1,
                borderRadius: 2,
                "&:before": {
                  display: "none",
                },
                "& .MuiAccordionSummary-root": {
                  borderRadius: 2,
                  backgroundColor: "background.paper",
                },
                "& .MuiAccordionDetails-root": {
                  backgroundColor: "background.default",
                },
              }}
            >
              <AccordionSummary
                expandIcon={<ExpandMoreIcon />}
                sx={{
                  "& .MuiAccordionSummary-content": {
                    alignItems: "center",
                  },
                }}
              >
                <FolderIcon sx={{ marginRight: 2, color: "text.secondary" }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="subtitle1" sx={{ fontWeight: 500 }}>
                    {folder.name}
                  </Typography>
                  <Typography variant="body2" sx={{ color: "text.secondary" }}>
                    {folder.files.length} file
                    {folder.files.length !== 1 ? "s" : ""}
                  </Typography>
                </Box>
              </AccordionSummary>
              <AccordionDetails sx={{ padding: 0 }}>
                <Box sx={{ padding: 2 }}>
                  <Box sx={{ display: "flex", flexWrap: "wrap", gap: 2 }}>
                    {folder.files.map((file, fileIndex) => (
                      <Paper
                        key={fileIndex}
                        sx={{
                          padding: 2,
                          minWidth: 200,
                          borderRadius: 2,
                          border: `1px solid rgba(255,255,255,0.08)`,
                          backgroundColor: "background.paper",
                          cursor: "pointer",
                          transition: "all 0.2s ease-in-out",
                          "&:hover": {
                            backgroundColor: "action.hover",
                            transform: "translateY(-2px)",
                            boxShadow: "0 4px 8px rgba(0,0,0,0.15)",
                          },
                        }}
                        onClick={() => {
                          // TODO: Open file with system default application
                          console.log("Open file:", file.path);
                        }}
                      >
                        <Box
                          sx={{ display: "flex", alignItems: "center", gap: 2 }}
                        >
                          {file.type === "image" ? (
                            <Box
                              component="img"
                              src={convertFileSrc(file.path)}
                              sx={{
                                width: 48,
                                height: 48,
                                borderRadius: 1,
                                objectFit: "cover",
                              }}
                              onError={(e) => {
                                e.currentTarget.style.display = "none";
                              }}
                            />
                          ) : (
                            <Box
                              sx={{
                                width: 48,
                                height: 48,
                                borderRadius: 1,
                                backgroundColor: "action.disabled",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                              }}
                            >
                              {getFileIcon(file.type)}
                            </Box>
                          )}
                          <Box sx={{ flex: 1, minWidth: 0 }}>
                            <Typography
                              variant="body2"
                              sx={{
                                fontWeight: 500,
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {file.name}
                            </Typography>
                            <Box
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1,
                                marginTop: 0.5,
                              }}
                            >
                              <Chip
                                label={file.extension.toUpperCase()}
                                size="small"
                                sx={{
                                  height: 20,
                                  fontSize: "0.7rem",
                                  backgroundColor: "action.selected",
                                  color: "text.primary",
                                }}
                              />
                            </Box>
                          </Box>
                        </Box>
                      </Paper>
                    ))}
                  </Box>
                </Box>
              </AccordionDetails>
            </Accordion>
          ))
        )}
      </Box>
    </Box>
  );
};

export default FolderView;
