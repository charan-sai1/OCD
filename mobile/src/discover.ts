/**
 * A very small LAN probe for OCD Manager on the same Wi-Fi. The phone cannot
 * ask "who is running OCD?" without multicast support the app does not have,
 * so it walks the /24 of the address it already knows (the saved computer, or
 * the development machine's address) and asks each host for /api/version.
 *
 * Nothing is uploaded. The scan only runs when the user taps the button, and
 * it is bounded to 254 addresses with a short timeout and a small concurrency
 * so the phone does not disappear into a minute of sockets.
 */

export const OCD_PORT = 8090;
const SCAN_TIMEOUT = 900;
const SCAN_CONCURRENCY = 20;

export type FoundComputer = {
  url: string;
  version: string;
  address: string;
};

export type ScanOptions = {
  /** A URL or host that hints at the network, usually the saved server. */
  hint?: string | null;
  port?: number;
  signal?: AbortSignal;
  onProgress?: (done: number, total: number, found: FoundComputer[]) => void;
};

function splitAddress(raw: string | null | undefined): {
  host: string;
  port: number;
} | null {
  if (!raw) return null;
  const text = raw.trim();
  if (!text) return null;
  const withoutScheme = text.replace(/^https?:\/\//i, '');
  const authority = withoutScheme.split('/')[0].split('?')[0];
  if (!authority) return null;

  // Keep bracketed IPv6 whole; this scan only speaks IPv4, so it returns null
  // for those rather than mangling the address.
  if (authority.startsWith('[')) return { host: authority, port: OCD_PORT };

  const colon = authority.lastIndexOf(':');
  if (colon > 0) {
    const portText = authority.slice(colon + 1);
    if (/^\d+$/.test(portText)) {
      return {
        host: authority.slice(0, colon),
        port: Number(portText) || OCD_PORT,
      };
    }
  }
  return { host: authority, port: OCD_PORT };
}

/** The 192.168.1 from 192.168.1.24, or null when the hint is not private IPv4. */
export function subnetFrom(hint: string | null | undefined): string | null {
  const parsed = splitAddress(hint);
  if (!parsed) return null;
  const parts = parsed.host.split('.');
  if (parts.length !== 4) return null;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  const [a, b] = nums;
  const isPrivate =
    a === 10 ||
    (a === 192 && b === 168) ||
    (a === 172 && b >= 16 && b <= 31);
  if (!isPrivate) return null;
  return `${nums[0]}.${nums[1]}.${nums[2]}`;
}

export function portFrom(hint: string | null | undefined): number {
  return splitAddress(hint)?.port ?? OCD_PORT;
}

/** A URL as a person would type it, without relying on the URL polyfill. */
export function cleanHost(hint: string | null | undefined): string | null {
  return splitAddress(hint)?.host ?? null;
}

async function ask(url: string, signal?: AbortSignal): Promise<string | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), SCAN_TIMEOUT);
  const forward = () => ctl.abort();
  signal?.addEventListener('abort', forward);
  try {
    const res = await fetch(url + '/api/version', {
      signal: ctl.signal,
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { current?: unknown };
    return typeof body?.current === 'string' ? body.current : null;
  } catch {
    // A quiet host, a different service, or a timeout: all mean "not here".
    return null;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', forward);
  }
}

export async function findComputers(opts: ScanOptions = {}): Promise<FoundComputer[]> {
  const subnet = subnetFrom(opts.hint);
  if (!subnet) return [];
  const port = opts.port ?? portFrom(opts.hint);
  const signal = opts.signal;

  const hosts = Array.from({ length: 254 }, (_, i) => `${subnet}.${i + 1}`);
  // Ask the hinted address first so the usual computer shows up immediately
  // instead of after the whole sweep.
  const hinted = cleanHost(opts.hint);
  if (hinted && hosts.includes(hinted)) {
    hosts.splice(hosts.indexOf(hinted), 1);
    hosts.unshift(hinted);
  }

  const found: FoundComputer[] = [];
  let next = 0;
  let done = 0;

  const worker = async () => {
    while (next < hosts.length) {
      if (signal?.aborted) return;
      const host = hosts[next++];
      const url = `http://${host}:${port}`;
      const version = await ask(url, signal);
      done += 1;
      if (version !== null) {
        found.push({ url, version, address: host });
        found.sort((a, b) => Number(a.address.split('.').pop()) - Number(b.address.split('.').pop()));
      }
      opts.onProgress?.(done, hosts.length, [...found]);
    }
  };

  await Promise.all(
    Array.from({ length: Math.min(SCAN_CONCURRENCY, hosts.length) }, worker),
  );
  return found.sort(
    (a, b) => Number(a.address.split('.').pop()) - Number(b.address.split('.').pop()),
  );
}
