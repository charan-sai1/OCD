import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';

export type ShareableItem = {
  key: string;
  name: string;
  kind?: 'photo' | 'video' | string;
  size?: number;
  // A file/ content URI on this phone; when set we share the local file
  // rather than downloading it from the computer first.
  localUri?: string;
};

// A share downloads the original from the drive into the app cache first.
// Anything larger is not something a phone should quietly pull over Wi-Fi.
export const MAX_SHARE_BYTES = 2 * 1024 * 1024 * 1024; // 2 GB, one long 4K clip

export class ShareTooLargeError extends Error {
  constructor(readonly items: ShareableItem[]) {
    super('These files are too large to share from the phone.');
  }
}

/**
 * Neither react-native's Share nor expo-sharing can hand several files to one
 * share sheet, so a multi-select share opens one sheet per file. The cap
 * keeps a stray "select all" from producing dozens of prompts.
 */
export const MAX_SHARE_ITEMS = 10;

export class ShareTooManyError extends Error {
  constructor(readonly items: ShareableItem[]) {
    super(`Share up to ${MAX_SHARE_ITEMS} files at a time.`);
  }
}

export async function shareRemoteFiles(server: string, items: ShareableItem[]): Promise<void> {
  if (!items.length) return;
  if (items.length > MAX_SHARE_ITEMS) throw new ShareTooManyError(items);
  const total = items.reduce((sum, item) => sum + (item.size ?? 0), 0);
  if (total > MAX_SHARE_BYTES) throw new ShareTooLargeError(items);

  // Do not let the cache grow forever: each share cleans the previous batch.
  await clearOldShareFiles();

  const files = await Promise.all(
    items.map((item) =>
      item.localUri ? prepareLocalFile(item) : downloadShareableFile(server, item),
    ),
  );

  // Both share sheets are single-file APIs, so share them in order.
  for (const file of files) {
    await Sharing.shareAsync(file.uri, {
      dialogTitle: file.name,
      mimeType: mimeTypeFor(file.name),
      UTI: utiFor(file.name),
    });
  }
}

type DownloadedFile = { uri: string; name: string };

async function prepareLocalFile(item: ShareableItem): Promise<DownloadedFile> {
  const dir = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}ocd-share/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });
  const ext = getExtension(item.name, item.kind);
  const fileUri = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  await FileSystem.copyAsync({ from: item.localUri as string, to: fileUri });
  return { uri: fileUri, name: safeLocalName(item.name) };
}

async function downloadShareableFile(
  server: string,
  item: ShareableItem,
): Promise<DownloadedFile> {
  const dir = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}ocd-share/`;
  await FileSystem.makeDirectoryAsync(dir, { intermediates: true });

  const ext = getExtension(item.name, item.kind);
  const fileUri = `${dir}${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
  const remoteUri = `${server}/api/orig?k=${encodeURIComponent(item.key)}`;

  const result = await FileSystem.downloadAsync(remoteUri, fileUri);
  if (!result.uri) throw new Error('Could not prepare the file for sharing.');
  return { uri: result.uri, name: safeLocalName(item.name) };
}

async function clearOldShareFiles(): Promise<void> {
  const dir = `${FileSystem.cacheDirectory ?? FileSystem.documentDirectory ?? ''}ocd-share/`;
  try {
    const info = await FileSystem.getInfoAsync(dir);
    if (!info.exists) return;
    const names = await FileSystem.readDirectoryAsync(dir);
    await Promise.all(
      names.map((name) => FileSystem.deleteAsync(dir + name, { idempotent: true })),
    );
  } catch {
    // A stale folder is never worth losing the share over.
  }
}



function safeLocalName(name: string): string {
  const cleaned = name.replace(/[/\\<>:"|?*]/g, '_').trim();
  return cleaned || 'share';
}

function getExtension(name: string, kind?: string): string {
  const match = /\.[^./\\]+$/i.exec(name);
  if (match) return match[0].toLowerCase();
  return kind === 'video' ? '.mp4' : '.jpg';
}

function mimeTypeFor(name: string): string {
  const ext = getExtension(name).toLowerCase();
  switch (ext) {
    case '.heic':
      return 'image/heic';
    case '.heif':
      return 'image/heif';
    case '.png':
      return 'image/png';
    case '.gif':
      return 'image/gif';
    case '.webp':
      return 'image/webp';
    case '.tif':
    case '.tiff':
      return 'image/tiff';
    case '.mp4':
      return 'video/mp4';
    case '.mov':
      return 'video/quicktime';
    case '.3gp':
      return 'video/3gpp';
    case '.webm':
      return 'video/webm';
    default:
      return 'image/jpeg';
  }
}

function utiFor(name: string): string {
  const ext = getExtension(name).toLowerCase();
  switch (ext) {
    case '.heic':
      return 'public.heif';
    case '.heif':
      return 'public.heif';
    case '.png':
      return 'public.png';
    case '.gif':
      return 'public.gif';
    case '.mp4':
      return 'public.mpeg-4';
    case '.mov':
      return 'com.apple.quicktime-movie';
    default:
      return 'public.jpeg';
  }
}
