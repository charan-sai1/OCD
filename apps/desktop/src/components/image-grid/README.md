# Image Grid Components

Components for displaying image grids with various optimization strategies.

## Files

- `ImageGrid.tsx` - Basic image grid layout
- `OrganizedPhotoGrid.tsx` - Photos organized by date/album
- `ResponsivePhotoGrid.tsx` - Responsive grid adapting to screen size
- `VirtualImageGrid.tsx` - Virtualized grid for large datasets
- `EnhancedVirtualizedImageGrid.tsx` - Advanced virtualization with element recycling
- `TanStackVirtualizedGallery.tsx` - Production-grade virtualization using @tanstack/react-virtual
- `SkeletonImageGrid.tsx` - Loading skeleton placeholders

## Purpose

Display images in grid layouts with virtualized rendering for performance with large photo libraries.

## Recommended

Use `TanStackVirtualizedGallery` for production apps with large image collections. It provides:
- **Element recycling**: DOM nodes are reused instead of destroyed/recreated
- **Overscan**: Renders extra rows above/below viewport for smoother scrolling
- **Precise measurements**: Dynamic row height calculation
- **Memory efficiency**: Only renders visible + overscan items
