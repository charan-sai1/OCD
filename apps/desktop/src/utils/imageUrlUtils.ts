import { convertFileSrc } from "@tauri-apps/api/core";

// Image URL utilities for consistent URL generation across components
export function getImageUrl(imagePath: string): string {
  // Use convertFileSrc for consistent URL generation
  // This ensures all components use the same URL scheme
  return convertFileSrc(imagePath);
}

export function getAssetUrl(imagePath: string): string {
  // Alternative method using asset protocol
  return `asset://${imagePath}`;
}