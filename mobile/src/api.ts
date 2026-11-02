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
  init: { method?: string; body?: unknown; timeoutMs?: number } = {},
): Promise<T> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), init.timeoutMs ?? 12000);
  try {
    const res = await fetch(server + path, {
      method: init.method ?? 'GET',
      headers: init.body ? { 'Content-Type': 'application/json' } : undefined,
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
