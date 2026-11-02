export const colors = {
  bg: '#ffffff',
  surface: '#f3f4f6',
  surfacePressed: '#e7e9ec',
  text: '#111315',
  muted: '#6b7280',
  faint: '#9ca3af',
  line: '#e5e7eb',
  black: '#000000',
  white: '#ffffff',
  danger: '#b42318',
  dangerBg: '#fef3f2',
};

export const radius = {
  sm: 6,
  md: 10,
  lg: 14,
  pill: 999,
};

export const space = (n: number) => n * 4;

export function bytes(n: number): string {
  if (!n) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return (i === 0 ? String(Math.round(v)) : v.toFixed(v >= 10 ? 0 : 1)) + ' ' + units[i];
}

export function duration(seconds: number | undefined): string {
  if (!seconds || seconds <= 0) return '';
  const s = Math.round(seconds);
  const m = Math.floor(s / 60);
  return m + ':' + String(s % 60).padStart(2, '0');
}

export function takenOn(unix: number): string {
  if (!unix) return 'Date unknown';
  return new Date(unix * 1000).toLocaleDateString(undefined, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
}
