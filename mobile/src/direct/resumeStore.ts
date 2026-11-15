import * as FileSystem from 'expo-file-system/legacy';

import { decodeResume, encodeResume, type ResumeRecord } from './resume';

/**
 * The resume marker lives in the app's document folder, beside the send queue,
 * rather than on the drive. A drive can be unplugged or read-only, and the
 * marker must be readable before the drive is open again.
 */

const FILE = 'ocd-backup-resume.json';

function resumePath(): string | null {
  const dir = FileSystem.documentDirectory;
  if (!dir) return null;
  return dir.endsWith('/') ? `${dir}${FILE}` : `${dir}/${FILE}`;
}

export async function readResume(): Promise<ResumeRecord | null> {
  const path = resumePath();
  if (!path) return null;
  try {
    const text = await FileSystem.readAsStringAsync(path, { encoding: 'utf8' });
    return decodeResume(text);
  } catch {
    // No marker, or one written by a build that no longer matches. Either way
    // there is nothing to resume.
    return null;
  }
}

export async function writeResume(record: ResumeRecord): Promise<boolean> {
  const path = resumePath();
  if (!path) return false;
  const tmp = `${path}.tmp`;
  try {
    // Write beside the target, then copy over it. A kill before the copy leaves
    // the previous marker intact; a kill during it leaves the complete temp
    // copy readable.
    await FileSystem.writeAsStringAsync(tmp, encodeResume(record));
    await FileSystem.copyAsync({ from: tmp, to: path });
    await FileSystem.deleteAsync(tmp, { idempotent: true });
    return true;
  } catch {
    return false;
  }
}

export async function clearResume(): Promise<void> {
  const path = resumePath();
  if (!path) return;
  await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  await FileSystem.deleteAsync(`${path}.tmp`, { idempotent: true }).catch(() => {});
}
