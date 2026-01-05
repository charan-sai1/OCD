import React, { useState } from "react";
import {
  Box,
  Typography,
  Button,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  Fab,
  Tooltip,
  useTheme,
} from "@mui/material";
import {
  FolderOpen as FolderOpenIcon,
  PhotoLibrary as PhotoLibraryIcon,
} from "@mui/icons-material";
import { convertFileSrc } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

interface ImageGridProps {}

const ImageGrid: React.FC<ImageGridProps> = () => {
  const [images, setImages] = useState<string[]>([]);
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const theme = useTheme();



  const handleBrowseClick = async () => {
    try {
      const selected = await open({
        directory: true,
        multiple: true, // Allow multiple directory selection
        title: "Select Image Directories",
      });

      if (selected) {
        const paths = Array.isArray(selected) ? selected : [selected];
        // Add new paths to existing ones, avoiding duplicates
        setImages((prev) => {
          const combined = [...prev, ...paths];
          return Array.from(new Set(combined)); // Remove duplicates
        });
      }
    } catch (err) {
      console.error("Error opening directory picker:", err);
    }
  };

  const getImageAspectRatio = () => {

    // All images displayed in 1:1 square ratio
    return 1;
  };

  return (
    <Box
      sx={{
        minHeight: "100vh",
        backgroundColor: theme.palette.background.default,
        padding: 3,
      }}
    >
      {images.length > 0 ? (
        <ImageList
          variant="masonry"
          cols={4}
          gap={8}
          sx={{
            "& .MuiImageList-root": {
              margin: 0,
            },
          }}
        >
          {images.map((imagePath, index) => (
            <ImageListItem
              key={index}
              sx={{
                borderRadius: 2,
                overflow: "hidden",
                position: "relative",
                cursor: "pointer",
                "&:hover": {
                  "& .MuiImageListItemBar-root": {
                    opacity: 1,
                  },
                },
              }}
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
            >
              <img
                src={convertFileSrc(imagePath)}
                alt={imagePath.split("/").pop() || `Image ${index + 1}`}
                loading="lazy"
                style={{
                  borderRadius: 12,
                  width: "100%",
                  height: "auto",
                  aspectRatio: getImageAspectRatio(),
                  objectFit: "cover",
                  transition: "transform 0.2s ease-in-out",
                  transform:
                    hoveredIndex === index ? "scale(1.02)" : "scale(1)",
                }}
                onError={(e) => {
                  console.error(`Failed to load image: ${imagePath}`);
                  e.currentTarget.style.display = "none";
                }}
              />
              <ImageListItemBar
                title={imagePath.split("/").pop()}
                subtitle={imagePath.split("/").slice(0, -1).pop()}
                sx={{
                  background:
                    "linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%)",
                  opacity: hoveredIndex === index ? 1 : 0,
                  transition: "opacity 0.2s ease-in-out",
                  borderRadius: "0 0 12px 12px",
                  "& .MuiImageListItemBar-title": {
                    fontSize: "0.875rem",
                    fontWeight: 500,
                  },
                  "& .MuiImageListItemBar-subtitle": {
                    fontSize: "0.75rem",
                  },
                }}
              />
            </ImageListItem>
          ))}
        </ImageList>
      ) : (
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
          <PhotoLibraryIcon
            sx={{
              fontSize: 80,
              color: theme.palette.text.disabled,
              marginBottom: 2,
            }}
          />
          <Typography
            variant="h6"
            sx={{
              color: theme.palette.text.secondary,
              marginBottom: 1,
            }}
          >
            No photos to show
          </Typography>
          <Typography
            variant="body2"
            sx={{
              color: theme.palette.text.disabled,
              marginBottom: 3,
            }}
          >
            Select a folder containing images to get started
          </Typography>
          <Button
            variant="contained"
            startIcon={<FolderOpenIcon />}
            onClick={handleBrowseClick}
            sx={{
              borderRadius: 28,
              paddingX: 3,
              paddingY: 1.5,
            }}
          >
            Select Folders
          </Button>
        </Box>
      )}

      {/* Floating Action Button for quick access */}
      <Tooltip title="Add more folders">
        <Fab
          color="primary"
          sx={{
            position: "fixed",
            bottom: 24,
            right: 24,
            borderRadius: 16,
          }}
          onClick={handleBrowseClick}
        >
          <FolderOpenIcon />
      </Fab>
      </Tooltip>
    </Box>
  );
};

export default ImageGrid;

