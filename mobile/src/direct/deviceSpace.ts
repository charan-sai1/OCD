import * as FileSystem from 'expo-file-system/legacy';

/**
 * Free space on the phone's data partition, or null when the platform does not
 * report it. Kept apart from `spacePlan.ts` so the arithmetic stays testable
 * without Expo.
 */
export async function phoneFreeBytes(): Promise<number | null> {
  try {
    const n = await FileSystem.getFreeDiskStorageAsync();
    return Number.isFinite(n) && n >= 0 ? n : null;
  } catch {
    return null;
  }
}
