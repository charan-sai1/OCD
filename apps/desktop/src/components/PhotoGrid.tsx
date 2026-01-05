import React, { useState } from "react";
import {
  Box,
  ImageList,
  ImageListItem,
  ImageListItemBar,
  Typography,
  useTheme,
} from "@mui/material";
import { convertFileSrc } from "@tauri-apps/api/core";

interface PhotoGridProps {
  images: string[];
  directoryPaths: string[];
  imageSize: number;
}

const PhotoGrid: React.FC<PhotoGridProps> = ({
  images,
  directoryPaths,
  imageSize,
}) => {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const theme = useTheme();

  const getImageAspectRatio = () => {
    // All images displayed in 1:1 square ratio
    return 1;
  };

  if (images.length === 0 && directoryPaths.length === 0) {
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
          Select folders to start viewing your photos
        </Typography>
      </Box>
    );
  }

  return (
    <Box>
      {/* Image Grid */}
      {images.length > 0 ? (
        <ImageList
          variant="masonry"
          cols={imageSize}
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
                transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                "&:hover": {
                  transform: "scale(1.02)",
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
                  transition: "transform 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
                  transform:
                    hoveredIndex === index ? "scale(1.05)" : "scale(1)",
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
                  borderRadius: "0 0 12px 12px",
                  transform:
                    hoveredIndex === index
                      ? "translateY(0)"
                      : "translateY(4px)",
                  transition: "all 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
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
      ) : directoryPaths.length > 0 ? (
        <Box
          sx={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            minHeight: "40vh",
            textAlign: "center",
          }}
        >
          <Typography
            variant="body1"
            sx={{
              color: theme.palette.text.secondary,
            }}
          >
            No images found in selected folders
          </Typography>
        </Box>
      ) : null}
    </Box>
  );
};

export default PhotoGrid;
