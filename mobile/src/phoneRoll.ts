import { Platform } from 'react-native';
import * as MediaLibrary from 'expo-media-library/legacy';
import * as FileSystem from 'expo-file-system/legacy';

/**
 * One item from the phone's own camera roll. The Photos grid and the send
 * screen both read this shape, so a tile means the same thing in either place.
 */
export type PhoneAsset = {
  id: string;
  filename: string;
  uri: string;
  cloud?: boolean;
  size?: number;
  takenAt: number;
  kind: 'image' | 'video';
  duration: number;
};

export const PHONE_PAGE = 60;

export type RollPage = {
  assets: PhoneAsset[];
  endCursor?: string;
  hasNextPage: boolean;
};

export function readRollPermission(): Promise<MediaLibrary.PermissionResponse> {
  return MediaLibrary.getPermissionsAsync();
}

export function askRollPermission(): Promise<MediaLibrary.PermissionResponse> {
  return MediaLibrary.requestPermissionsAsync(false, ['photo', 'video']);
}

/** Reads one page of the camera roll and resolves local preview URIs. */
export async function readRollPage(
  after: string | undefined,
  first = PHONE_PAGE,
): Promise<RollPage> {
  const page = await MediaLibrary.getAssetsAsync({
    first,
    after,
    mediaType: ['photo', 'video'],
    sortBy: [['creationTime', false]],
  });
  return {
    assets: await resolveAssets(page.assets),
    endCursor: page.endCursor,
    hasNextPage: page.hasNextPage,
  };
}

export async function resolveAssets(
  list: MediaLibrary.Asset[],
): Promise<PhoneAsset[]> {
  const out = new Array<PhoneAsset>(list.length);
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const i = next++;
      out[i] = await resolveOne(list[i]);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, list.length) }, worker));
  return out;
}

async function resolveOne(a: MediaLibrary.Asset): Promise<PhoneAsset> {
  let uri = a.uri;
  let cloud = false;
  if (Platform.OS === 'ios') {
    try {
      // false: never pull originals down from iCloud just to show a tile.
      const info = await MediaLibrary.getAssetInfoAsync(a, {
        shouldDownloadFromNetwork: false,
      });
      if (info.localUri) uri = info.localUri;
      else cloud = true;
    } catch {
      // iCloud-only asset; the tile will say so.
      cloud = true;
    }
    // React Native's image loader has no handler for ph://. Handing it one
    // just logs "No suitable image URL loader found" and leaves an empty tile.
    if (uri.startsWith('ph://')) {
      cloud = true;
      uri = '';
    }
  }
  let size: number | undefined;
  if (uri) {
    try {
      const file = await FileSystem.getInfoAsync(uri);
      if (file.exists && !file.isDirectory) size = file.size;
    } catch {
      // Size is optional; a missing size just leaves totals approximate.
    }
  }
  return {
    id: a.id,
    filename: a.filename,
    uri,
    cloud,
    size,
    takenAt: Math.round(a.creationTime / 1000),
    kind: a.mediaType === 'video' ? 'video' : 'image',
    duration: a.duration,
  };
}

export function phoneAssetLabel(a: PhoneAsset): string {
  return [
    a.kind === 'video' ? 'Video' : 'Photo',
    a.filename,
    a.cloud ? 'in iCloud' : '',
  ]
    .filter(Boolean)
    .join(', ');
}
