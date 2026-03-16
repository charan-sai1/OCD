let isTauriCache: boolean | null = null;

export function isTauriEnvironment(): boolean {
  if (isTauriCache !== null) {
    return isTauriCache;
  }

  isTauriCache = typeof window !== 'undefined' &&
    '__TAURI__' in window &&
    !!window.__TAURI__;

  return isTauriCache;
}

export function isWebEnvironment(): boolean {
  return !isTauriEnvironment();
}

export function getPlatformType(): 'tauri' | 'web' {
  return isTauriEnvironment() ? 'tauri' : 'web';
}
