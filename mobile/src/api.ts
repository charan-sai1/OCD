import Constants from 'expo-constants';
import * as FileSystem from 'expo-file-system/legacy';

export type Cursor = { before: number; name: string };

export type GridItem = {
  key: string;
  name: string;
  dir: string;
  lib: string;
  kind: string;
  w: number;
  h: number;
  shot: number;
  size: number;
  dur?: number;
  v: number;
  fav: boolean;
};

export type PhotoPage = {
  items: GridItem[];
  hasMore: boolean;
  indexed: number;
  scanned: number;
  building: boolean;
  cursor?: Cursor;
};

export type Library = {
  id: string;
  name: string;
  path: string;
  available: boolean;
  count: number;
  bytes: number;
};

export type Drive = {
  volumeId: string;
  label?: string;
  root: string;
  count: number;
  size: number;
  generated: string;
  source: string;
  libraries?: string[];
};

export type ImportMatch = {
  onDrive: boolean;
  path?: string;
  volumeId?: string;
  label?: string;
  how?: string;
  // verified is true only when this session uploaded the bytes and the server
  // hashed them. Catalog matches are metadata-only, so they are not deletable.
  verified?: boolean;
};

export type ImportCheck = {
  matches: ImportMatch[];
  scanned: number;
  drives?: string[];
};

export type UploadTarget = {
  libraryId?: string;
  volumeId?: string;
  name: string;
  size: number;
  takenAt?: number;
  kind?: 'image' | 'video';
  width?: number;
  height?: number;
  duration?: number;
  sha256?: string;
};

export type UploadStart = {
  uploadId?: string;
  existingPath?: string;
  path?: string;
  size?: number;
  offset?: number;
  libraryId?: string;
  volumeId?: string;
  label?: string;
};

export type UploadFinish = {
  verified: boolean;
  sha256: string;
  path: string;
  size: number;
  existing: boolean;
  itemId: string;
  libraryId: string;
  volumeId: string;
  label?: string;
};

const PORT = 8090;
const CONFIG = (FileSystem.documentDirectory ?? '') + 'ocd-server.txt';

// The PC's address changes between networks. In development Expo tells us the
// machine serving the bundle, which is always the machine running OCD.
export function guessServer(): string {
  const host = (Constants.expoConfig?.hostUri ?? '').split(':')[0];
  return host ? `http://${host}:${PORT}` : '';
}

export function normalizeServer(raw: string): string {
  let s = raw.trim();
  if (!s) return s;
  if (!/^https?:\/\//i.test(s)) s = 'http://' + s;
  return s.replace(/\/+$/, '');
}

export async function loadServer(): Promise<string> {
  try {
    const saved = (await FileSystem.readAsStringAsync(CONFIG)).trim();
    if (saved) return saved;
  } catch {
    // First run, or the app's document store was cleared.
  }
  return guessServer();
}

export async function saveServer(server: string): Promise<void> {
  try {
    await FileSystem.writeAsStringAsync(CONFIG, server);
  } catch {
    // A missing config file only costs the user a retype next launch.
  }
}

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

async function request<T>(
  server: string,
  path: string,
  init: {
    method?: string;
    body?: unknown;
    timeoutMs?: number;
    headers?: Record<string, string>;
  } = {},
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 12000);
  try {
    const headers: Record<string, string> = {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...(init.headers ?? {}),
    };
    const res = await fetch(server + path, {
      method: init.method ?? 'GET',
      headers: Object.keys(headers).length ? headers : undefined,
      body: init.body ? JSON.stringify(init.body) : undefined,
      signal: ctl.signal,
    });
    if (!res.ok) {
      let message = `HTTP ${res.status}`;
      try {
        const body = (await res.json()) as { error?: string };
        if (body?.error) message = body.error;
      } catch {
        // Keep the status line; some failures have no JSON body.
      }
      throw new ApiError(res.status, message);
    }
    return (await res.json()) as T;
  } finally {
    clearTimeout(timer);
  }
}

function deviceHeaders(): Record<string, string> {
  const name = (Constants.deviceName ?? '').trim();
  return name ? { 'X-OCD-Device': name } : {};
}

// uploadFile streams the local file to the server. It is separate from request
// because a large video must never be read into JS memory just to be sent.
export async function uploadFile(
  server: string,
  uploadId: string,
  uri: string,
  onProgress?: (sent: number, total: number) => void,
): Promise<void> {
  const task = FileSystem.createUploadTask(
    `${server}/api/upload/${encodeURIComponent(uploadId)}?offset=0`,
    uri,
    {
      httpMethod: 'PUT',
      uploadType: FileSystem.FileSystemUploadType.BINARY_CONTENT,
      headers: deviceHeaders(),
    },
    (p) => onProgress?.(p.totalBytesSent, p.totalBytesExpectedToSend),
  );
  const res = await task.uploadAsync();
  if (!res) throw new Error('The upload was cancelled.');
  if (res.status < 200 || res.status >= 300) {
    let message = `HTTP ${res.status}`;
    try {
      const body = JSON.parse(res.body) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      // Some failures have no JSON body.
    }
    throw new ApiError(res.status, message);
  }
}

export const api = {
  version: (server: string) => request<{ current: string }>(server, '/api/version', { timeoutMs: 6000 }),

  libraries: async (server: string): Promise<Library[]> => {
    const res = await request<{ items: Library[] }>(server, '/api/libraries');
    return res.items ?? [];
  },

  drives: async (server: string): Promise<Drive[]> => {
    const res = await request<{ drives: Drive[] }>(server, '/api/drives');
    return res.drives ?? [];
  },

  photos: (
    server: string,
    opts: { limit?: number; q?: string; lib?: string; before?: Cursor },
  ): Promise<PhotoPage> => {
    const p = new URLSearchParams();
    p.set('limit', String(opts.limit ?? 200));
    if (opts.q) p.set('q', opts.q);
    if (opts.lib) p.set('lib', opts.lib);
    if (opts.before) {
      p.set('before', String(opts.before.before));
      p.set('befname', opts.before.name);
    }
    return request<PhotoPage>(server, '/api/photos?' + p.toString());
  },

  // Metadata-only: name + size, with capture time as the fallback for renamed
  // files. Nothing is uploaded or deleted here.
  importCheck: (
    server: string,
    items: { name: string; size: number; takenAt?: number }[],
    volumeId?: string,
  ): Promise<ImportCheck> =>
    request<ImportCheck>(server, '/api/import/check', {
      method: 'POST',
      body: { items, volumeId },
      timeoutMs: 20000,
    }),

  uploadStart: (server: string, target: UploadTarget) =>
    request<UploadStart>(server, '/api/upload/start', {
      method: 'POST',
      body: target,
      timeoutMs: 20000,
      headers: deviceHeaders(),
    }),

  uploadFinish: (server: string, uploadId: string) =>
    request<UploadFinish>(server, `/api/upload/${encodeURIComponent(uploadId)}/finish`, {
      method: 'POST',
      timeoutMs: 120000,
      headers: deviceHeaders(),
    }),

  uploadAbort: (server: string, uploadId: string) =>
    request<{ aborted: boolean }>(server, `/api/upload/${encodeURIComponent(uploadId)}/abort`, {
      method: 'POST',
      timeoutMs: 15000,
    }),

  thumb: (server: string, key: string, w = 400) =>
    `${server}/api/t?k=${encodeURIComponent(key)}&w=${w}`,
  original: (server: string, key: string) => `${server}/api/orig?k=${encodeURIComponent(key)}`,
};

export function messageFor(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.status === 401) return 'This phone needs to be paired with the desktop.';
    return e.message;
  }
  if (e instanceof Error && e.name === 'AbortError') {
    return 'The desktop did not answer. Is OCD Manager still running?';
  }
  return 'Cannot reach the desktop. Check that both devices are on the same Wi-Fi and that OCD Manager is running.';
}
