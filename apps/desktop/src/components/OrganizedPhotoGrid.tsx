import React, { memo, useState, useEffect } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import { invoke } from "@tauri-apps/api/core";
import LazyImageContainer from "./LazyImageContainer";

interface OrganizedPhotoGridProps {
  images: string[];
  onImageClick?: (imagePath: string) => void;
}

interface ImageWithDate {
  path: string;
  date: Date;
}

interface DayGroup {
  date: string;
  images: ImageWithDate[];
}

interface MonthGroup {
  month: string;
  days: DayGroup[];
}

const OrganizedPhotoGrid: React.FC<OrganizedPhotoGridProps> = memo(({
  images = [],
  onImageClick,
}) => {
  const [organizedImages, setOrganizedImages] = useState<MonthGroup[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    organizeImages();
  }, [images]);

  const organizeImages = async () => {
    if (!images || images.length === 0) {
      setOrganizedImages([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    try {
      // Get modification times for all images
      const imagesWithDates: ImageWithDate[] = await Promise.all(
        images.map(async (path) => {
          try {
            const stat = await invoke("get_file_info", { path });
            const date = new Date((stat as any).modified);
            return { path, date };
          } catch {
            // Fallback to current date if we can't get file info
            return { path, date: new Date() };
          }
        })
      );

      // Sort by date (newest first)
      imagesWithDates.sort((a, b) => b.date.getTime() - a.date.getTime());

      // Group by month, then by day
      const monthGroups: { [monthKey: string]: { [dayKey: string]: ImageWithDate[] } } = {};

      imagesWithDates.forEach((image) => {
        const monthKey = `${image.date.getFullYear()}-${String(image.date.getMonth() + 1).padStart(2, '0')}`;
        const dayKey = `${monthKey}-${String(image.date.getDate()).padStart(2, '0')}`;

        if (!monthGroups[monthKey]) {
          monthGroups[monthKey] = {};
        }
        if (!monthGroups[monthKey][dayKey]) {
          monthGroups[monthKey][dayKey] = [];
        }
        monthGroups[monthKey][dayKey].push(image);
      });

      // Convert to MonthGroup array
      const organized: MonthGroup[] = Object.keys(monthGroups)
        .sort((a, b) => b.localeCompare(a)) // Sort months newest first
        .map((monthKey) => {
          const days = Object.keys(monthGroups[monthKey])
            .sort((a, b) => b.localeCompare(a)) // Sort days newest first
            .map((dayKey) => ({
              date: dayKey,
              images: monthGroups[monthKey][dayKey]
            }));

          return {
            month: monthKey,
            days
          };
        });

      setOrganizedImages(organized);
    } catch (error) {
      console.error('Error organizing images:', error);
      setOrganizedImages([]);
    } finally {
      setLoading(false);
    }
  };

  const formatMonthHeader = (monthKey: string) => {
    const [year, month] = monthKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1);
    return date.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
  };

  const formatDayLabel = (dayKey: string) => {
    const [year, month, day] = dayKey.split('-');
    const date = new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);

    if (date.toDateString() === today.toDateString()) {
      return 'Today';
    } else if (date.toDateString() === yesterday.toDateString()) {
      return 'Yesterday';
    } else {
      return date.toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });
    }
  };

  const handleImageClick = (imagePath: string) => {
    onImageClick?.(imagePath);
  };

  if (loading) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        color: 'text.secondary'
      }}>
        Organizing photos...
      </Box>
    );
  }

  if (!organizedImages || organizedImages.length === 0) {
    return (
      <Box sx={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '200px',
        color: 'text.secondary'
      }}>
        No images to display
      </Box>
    );
  }

  return (
    <Box sx={{ width: '100%', position: 'relative' }}>
      {organizedImages.map((monthGroup) => (
        <Box key={monthGroup.month} sx={{ mb: 4 }}>
          {/* Month Header */}
          <Typography
            variant="h5"
            sx={{
              mb: 3,
              mt: 2,
              fontWeight: 600,
              color: 'text.primary',
              borderBottom: '2px solid',
              borderColor: 'primary.main',
              pb: 1,
              pl: 1
            }}
          >
            {formatMonthHeader(monthGroup.month)}
          </Typography>

          {/* Days within the month */}
          {monthGroup.days.map((dayGroup) => (
            <Box key={dayGroup.date} sx={{ mb: 3 }}>
              {/* Day Label */}
              <Typography
                variant="subtitle1"
                sx={{
                  mb: 2,
                  fontWeight: 500,
                  color: 'text.secondary',
                  pl: 1
                }}
              >
                {formatDayLabel(dayGroup.date)}
              </Typography>

              {/* Images for this day - horizontal flex layout */}
              <Box
                sx={{
                  display: 'flex',
                  flexWrap: 'wrap',
                  gap: 1,
                  pl: 1
                }}
              >
                {dayGroup.images.map((image, index) => {
                  const globalIndex = images.indexOf(image.path);
                  const priority =
                    globalIndex < 12 ? 'high' :
                    globalIndex < 48 ? 'normal' :
                    'low';

                  return (
                    <Box
                      key={`${image.path}-${index}`}
                      sx={{
                        width: 120,
                        height: 120,
                        flexShrink: 0,
                        cursor: onImageClick ? 'pointer' : 'default',
                        borderRadius: 1,
                        overflow: 'hidden'
                      }}
                      onClick={() => handleImageClick(image.path)}
                    >
                      <LazyImageContainer
                        imagePath={image.path}
                        onClick={() => handleImageClick(image.path)}
                        placeholderVariant="shimmer"
                        priority={priority}
                      />
                    </Box>
                  );
                })}
              </Box>
            </Box>
          ))}
        </Box>
      ))}

      {/* Gradual blur effect at the bottom */}
      <Box
        sx={{
          position: 'absolute',
          bottom: 0,
          left: 0,
          right: 0,
          height: '120px',
          pointerEvents: 'none',
          zIndex: 1,
          background: 'linear-gradient(to top, rgba(255,255,255,0.8) 0%, rgba(255,255,255,0.4) 30%, rgba(255,255,255,0.1) 60%, transparent 100%)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)', // Safari support
        }}
      />
    </Box>
  );
});

OrganizedPhotoGrid.displayName = "OrganizedPhotoGrid";

export default OrganizedPhotoGrid;