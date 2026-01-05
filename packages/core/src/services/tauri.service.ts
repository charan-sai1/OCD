import { invoke } from "@tauri-apps/api/core";
import type { Device, SyncStatus, FileSystemNode, SyncOptions } from "../types";

export async function getDevices(): Promise<Device[]> {
  return invoke("get_devices");
}

export async function scanDevice(path: string): Promise<FileSystemNode> {
  return invoke("scan_directory", { path });
}

export async function startSync(options: SyncOptions): Promise<void> {
  return invoke("start_sync", { options });
}

export async function cancelSync(): Promise<void> {
  return invoke("cancel_sync");
}

export async function getSyncStatus(): Promise<SyncStatus> {
  return invoke("get_sync_status");
}

export async function readFile(path: string): Promise<ArrayBuffer> {
  return invoke("read_file", { path });
}

export async function writeFile(path: string, content: string): Promise<void> {
  return invoke("write_file", { path, content });
}

export async function deleteFile(path: string): Promise<void> {
  return invoke("delete_file", { path });
}

export async function createDirectory(path: string): Promise<void> {
  return invoke("create_directory", { path });
}

export async function getFileMetadata(path: string): Promise<FileSystemNode> {
  return invoke("get_file_metadata", { path });
}
