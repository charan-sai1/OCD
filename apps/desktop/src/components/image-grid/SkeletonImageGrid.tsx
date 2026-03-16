import React from "react";
import Box from "@mui/material/Box";
import Skeleton from "@mui/material/Skeleton";

interface SkeletonImageGridProps {
  imageSize: number;
  imageCount?: number;
}

const SkeletonImageGrid: React.FC<SkeletonImageGridProps> = ({
  imageSize,
  imageCount = 20, // Default number of skeleton items
}) => {
  // Calculate item dimensions based on imageSize (columns)
  const containerWidth = window.innerWidth - (imageSize === 2 ? 160 : imageSize === 3 ? 120 : 80);
  const itemWidth = Math.floor(containerWidth / imageSize);
  const itemHeight = itemWidth; // Square aspect ratio

  return (
    <Box sx={{ width: "100%" }}>
      <Box
        sx={{
          display: "grid",
          gridTemplateColumns: `repeat(${imageSize}, 1fr)`,
          gap: 2,
          width: "100%",
        }}
      >
        {Array.from({ length: imageCount }, (_, index) => (
          <Box
            key={index}
            sx={{
              width: itemWidth - 16, // Account for gap
              height: itemHeight - 16,
            }}
          >
            <Skeleton
              variant="rectangular"
              sx={{
                width: "100%",
                height: "100%",
                borderRadius: 2,
                animationDelay: `${index * 0.1}s`, // Staggered animation
              }}
              animation="wave"
            />
            {/* Skeleton for image overlay text */}
            <Box sx={{ mt: 1 }}>
              <Skeleton
                variant="text"
                sx={{
                  width: "80%",
                  height: 16,
                  animationDelay: `${index * 0.1 + 0.05}s`,
                }}
                animation="wave"
              />
              <Skeleton
                variant="text"
                sx={{
                  width: "60%",
                  height: 14,
                  mt: 0.5,
                  animationDelay: `${index * 0.1 + 0.1}s`,
                }}
                animation="wave"
              />
            </Box>
          </Box>
        ))}
      </Box>
    </Box>
  );
};

export default SkeletonImageGrid;