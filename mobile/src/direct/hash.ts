export function fnv1a64(s: string): string {
  // Same hash the Go side uses for catalog thumbnail names. Written in BigInt
  // because RN has no 64-bit number that survives a round trip.
  let h = 14695981039346656037n;
  const prime = 1099511628211n;
  const mask = (1n << 64n) - 1n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * prime) & mask;
  }
  return h.toString(16).padStart(16, '0');
}

// thumbName matches the Go exporter byte for byte: the preview for one catalog
// entry is thumbs/<hash>.jpg, where the hash covers volumeId, volume-relative
// path, size and mtime. Always use forward slashes here too.
export function thumbName(volumeId: string, rel: string, size: number, mtime: number): string {
  return fnv1a64(volumeId + '\x00' + rel + '\x00' + size + '\x00' + mtime) + '.jpg';
}
