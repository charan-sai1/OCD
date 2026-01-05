#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub mount_point: String,
    pub device_type: String,
    pub total_space: Option<u64>,
    pub available_space: Option<u64>,
}

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
fn read_directory(path: &str) -> Result<Vec<String>, String> {
    use std::fs;
    fs::read_dir(path)
        .map_err(|e| e.to_string())
        .and_then(|entries| {
            entries
                .map(|entry| entry.map(|e| e.path().to_string_lossy().to_string()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())
        })
}

#[tauri::command]
fn list_images(path: &str) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    let image_extensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"];

    fs::read_dir(path)
        .map_err(|e| e.to_string())
        .and_then(|entries| {
            let mut images = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if let Some(ext_str) = extension.to_str() {
                            if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                                images.push(path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            Ok(images)
        })
}

#[tauri::command]
fn list_files(path: &str, file_type: &str) -> Result<Vec<String>, String> {
    use std::fs;
    use std::path::Path;

    let extensions = match file_type {
        "images" => vec!["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
        "pdfs" => vec!["pdf"],
        "all" => vec![
            "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "pdf", "doc", "docx", "txt", "rtf",
        ],
        _ => vec![],
    };

    fs::read_dir(path)
        .map_err(|e| e.to_string())
        .and_then(|entries| {
            let mut files = Vec::new();
            for entry in entries {
                let entry = entry.map_err(|e| e.to_string())?;
                let path = entry.path();
                if path.is_file() {
                    if let Some(extension) = path.extension() {
                        if let Some(ext_str) = extension.to_str() {
                            if extensions.contains(&ext_str.to_lowercase().as_str()) {
                                files.push(path.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            }
            Ok(files)
        })
}

#[tauri::command]
async fn list_connected_devices() -> Result<Vec<Device>, String> {
    use sysinfo::{Disks, System};

    let mut system = System::new_all();
    system.refresh_all();

    let disks = Disks::new_with_refreshed_list();

    let mut devices = Vec::new();

    for disk in disks.list() {
        let mount_point = disk.mount_point().to_string_lossy().to_string();
        let name = disk.name().to_string_lossy().to_string();
        let device_type = if mount_point.contains("/Volumes/") || mount_point.contains(":\\") {
            "External Drive"
        } else if mount_point == "/" || mount_point.starts_with("C:") {
            "System Drive"
        } else {
            "Removable Drive"
        };

        let total_space = Some(disk.total_space());
        let available_space = Some(disk.available_space());

        devices.push(Device {
            name,
            mount_point,
            device_type: device_type.to_string(),
            total_space,
            available_space,
        });
    }

    // On macOS, also check for iOS devices (simplified - would need libimobiledevice for full support)
    #[cfg(target_os = "macos")]
    {
        // This is a placeholder - full iOS device detection would require additional libraries
        // For now, we'll just return the disk-based devices
    }

    Ok(devices)
}

#[tauri::command]
fn get_device_info(mount_point: &str) -> Result<Device, String> {
    use sysinfo::Disks;

    let disks = Disks::new_with_refreshed_list();

    for disk in disks.list() {
        if disk.mount_point().to_string_lossy() == mount_point {
            let name = disk.name().to_string_lossy().to_string();
            let device_type = if mount_point.contains("/Volumes/") || mount_point.contains(":\\") {
                "External Drive"
            } else if mount_point == "/" || mount_point.starts_with("C:") {
                "System Drive"
            } else {
                "Removable Drive"
            };

            return Ok(Device {
                name,
                mount_point: mount_point.to_string(),
                device_type: device_type.to_string(),
                total_space: Some(disk.total_space()),
                available_space: Some(disk.available_space()),
            });
        }
    }

    Err(format!("Device not found: {}", mount_point))
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            read_directory,
            list_images,
            list_files,
            list_connected_devices,
            get_device_info
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
