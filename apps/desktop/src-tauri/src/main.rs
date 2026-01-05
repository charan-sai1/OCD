#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::imageops::FilterType;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

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
async fn list_files(path: &str, file_type: &str) -> Result<Vec<String>, String> {
    use std::path::Path;
    use tokio::fs;

    let extensions = match file_type {
        "images" => vec!["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
        "pdfs" => vec!["pdf"],
        "all" => vec![
            "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "pdf", "doc", "docx", "txt", "rtf",
        ],
        _ => vec![],
    };

    let mut entries = fs::read_dir(path).await.map_err(|e| e.to_string())?;

    let mut files = Vec::new();

    while let Some(entry) = entries.next_entry().await.map_err(|e| e.to_string())? {
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

        // Yield control to prevent blocking for too long
        tokio::task::yield_now().await;
    }

    Ok(files)
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

#[tauri::command]
async fn generate_thumbnail(image_path: &str, size: u32) -> Result<String, String> {
    use std::fs;
    use std::io::Cursor;

    // Load image
    let img = image::open(image_path).map_err(|e| format!("Failed to open image: {}", e))?;

    // Resize to thumbnail
    let thumbnail = img.resize(size, size, FilterType::Lanczos3);

    // Convert to JPEG bytes
    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    // Convert to base64
    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

#[derive(Serialize, Deserialize)]
pub struct QualityRequest {
    pub image_path: String,
    pub thumbnail_size: Option<u32>,
    pub preview_size: Option<u32>,
    pub full_quality: Option<bool>,
}

#[derive(Serialize, Deserialize)]
pub struct QualityResult {
    pub image_path: String,
    pub thumbnail: Option<String>,
    pub preview: Option<String>,
    pub full: Option<String>,
    pub error: Option<String>,
}

#[tauri::command]
async fn generate_progressive_thumbnails(
    requests: Vec<QualityRequest>,
) -> Result<Vec<QualityResult>, String> {
    use std::fs;
    use std::io::Cursor;

    let mut results = Vec::new();

    // Process requests in batches to prevent overwhelming the system
    const BATCH_SIZE: usize = 3;

    for batch in requests.chunks(BATCH_SIZE) {
        let batch_results = futures::future::join_all(batch.iter().map(|request| async {
            let mut result = QualityResult {
                image_path: request.image_path.clone(),
                thumbnail: None,
                preview: None,
                full: None,
                error: None,
            };

            // Load image once
            let img_result = image::open(&request.image_path);

            match img_result {
                Ok(img) => {
                    // Generate thumbnail if requested
                    if let Some(thumbnail_size) = request.thumbnail_size {
                        match generate_single_thumbnail(&img, thumbnail_size) {
                            Ok(thumbnail_data) => result.thumbnail = Some(thumbnail_data),
                            Err(e) => result.error = Some(format!("Thumbnail error: {}", e)),
                        }
                    }

                    // Generate preview if requested
                    if let Some(preview_size) = request.preview_size {
                        match generate_single_thumbnail(&img, preview_size) {
                            Ok(preview_data) => result.preview = Some(preview_data),
                            Err(e) => {
                                if result.error.is_none() {
                                    result.error = Some(format!("Preview error: {}", e));
                                }
                            }
                        }
                    }

                    // Generate full quality if requested
                    if request.full_quality.unwrap_or(false) {
                        match generate_full_quality(&img) {
                            Ok(full_data) => result.full = Some(full_data),
                            Err(e) => {
                                if result.error.is_none() {
                                    result.error = Some(format!("Full quality error: {}", e));
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    result.error = Some(format!("Failed to load image: {}", e));
                }
            }

            result
        }))
        .await;

        results.extend(batch_results);

        // Yield control between batches
        tokio::task::yield_now().await;
    }

    Ok(results)
}

fn generate_single_thumbnail(img: &image::DynamicImage, size: u32) -> Result<String, String> {
    use std::io::Cursor;

    // Resize with high quality Lanczos3 filter
    let thumbnail = img.resize(size, size, FilterType::Lanczos3);

    // Convert to JPEG with quality based on size
    let quality = if size <= 150 { 70 } else { 85 }; // Lower quality for smaller thumbnails

    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    // Convert to base64
    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

fn generate_full_quality(img: &image::DynamicImage) -> Result<String, String> {
    use std::io::Cursor;

    // Keep original dimensions, convert to high-quality JPEG
    let mut buffer = Cursor::new(Vec::new());
    img.write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode full quality image: {}", e))?;

    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

// Facial Recognition Commands
static FACE_RECOGNITION_INITIALIZED: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

#[tauri::command]
async fn initialize_face_recognition() -> Result<(), String> {
    let mut initialized = FACE_RECOGNITION_INITIALIZED
        .lock()
        .map_err(|e| e.to_string())?;
    if *initialized {
        return Ok(());
    }

    // In a real implementation, this would initialize the face recognition system
    // For now, just mark as initialized
    *initialized = true;
    Ok(())
}

#[tauri::command]
async fn detect_faces(image_path: String) -> Result<serde_json::Value, String> {
    // Mock implementation - in real app this would call the face recognition API
    use serde_json::{Value, json};

    // Simulate face detection
    let faces = vec![json!({
        "id": format!("face_{}", chrono::Utc::now().timestamp()),
        "bounds": {
            "x": 100,
            "y": 100,
            "width": 150,
            "height": 150
        },
        "confidence": 0.95,
        "landmarks": {
            "leftEye": {"x": 125, "y": 125},
            "rightEye": {"x": 175, "y": 125},
            "nose": {"x": 150, "y": 150},
            "leftMouth": {"x": 140, "y": 175},
            "rightMouth": {"x": 160, "y": 175}
        }
    })];

    Ok(json!({
        "faces": faces,
        "processingTime": 150,
        "modelUsed": "MockFaceDetector",
        "imagePath": image_path
    }))
}

#[tauri::command]
async fn extract_embeddings(face_ids: Vec<String>) -> Result<serde_json::Value, String> {
    use serde_json::{Value, json};

    // Mock embedding extraction
    let faces = face_ids
        .into_iter()
        .map(|face_id| {
            // Generate mock 128D embedding
            let embedding: Vec<f32> = (0..128)
                .map(|_| (rand::random::<f32>() - 0.5) * 2.0)
                .collect();

            json!({
                "id": face_id,
                "embedding": embedding
            })
        })
        .collect::<Vec<Value>>();

    Ok(json!({
        "faces": faces,
        "processingTime": 200,
        "modelUsed": "MockEmbeddingExtractor"
    }))
}

#[tauri::command]
async fn find_similar_faces(
    query_face_id: String,
    threshold: Option<f64>,
    max_results: Option<usize>,
) -> Result<serde_json::Value, String> {
    use serde_json::{Value, json};

    let threshold = threshold.unwrap_or(0.6);
    let max_results = max_results.unwrap_or(10);

    // Mock similar faces
    let similar_faces = vec![json!({
        "face": {
            "id": format!("similar_face_{}", chrono::Utc::now().timestamp()),
            "bounds": {"x": 200, "y": 200, "width": 140, "height": 140},
            "confidence": 0.92
        },
        "similarity": 0.85,
        "imagePath": "/mock/path/image.jpg"
    })];

    Ok(json!({
        "similarFaces": similar_faces
    }))
}

#[tauri::command]
async fn cluster_faces(algorithm: Option<String>) -> Result<serde_json::Value, String> {
    use serde_json::{Value, json};

    let algorithm = algorithm.unwrap_or_else(|| "dbscan".to_string());

    // Mock person groups
    let person_groups = vec![json!({
        "id": "person_1",
        "name": null,
        "faceIds": ["face_1", "face_2", "face_3"],
        "representativeFaceId": "face_1",
        "confidence": 0.88,
        "createdAt": chrono::Utc::now().to_rfc3339()
    })];

    Ok(json!({
        "personGroups": person_groups,
        "algorithm": algorithm
    }))
}

#[tauri::command]
async fn get_people() -> Result<serde_json::Value, String> {
    use serde_json::{Value, json};

    let people = vec![json!({
        "id": "person_1",
        "name": "John Doe",
        "faceIds": ["face_1", "face_2", "face_3"],
        "representativeFaceId": "face_1",
        "confidence": 0.88,
        "createdAt": chrono::Utc::now().to_rfc3339()
    })];

    Ok(json!(people))
}

#[tauri::command]
async fn update_person(person_id: String, name: String) -> Result<(), String> {
    // Mock person update
    println!("Updating person {} with name {}", person_id, name);
    Ok(())
}

#[tauri::command]
async fn get_processing_status() -> Result<serde_json::Value, String> {
    use serde_json::json;

    Ok(json!({
        "isProcessing": false,
        "queueLength": 0,
        "progress": 100
    }))
}

#[tauri::command]
async fn get_capabilities() -> Result<serde_json::Value, String> {
    use serde_json::json;

    Ok(json!({
        "platform": "desktop",
        "cpuCores": 8,
        "memoryGB": 16.0,
        "hasGPU": true
    }))
}

#[tauri::command]
async fn set_processing_mode(mode: String) -> Result<(), String> {
    println!("Setting processing mode to: {}", mode);
    Ok(())
}

#[tauri::command]
async fn queue_images_for_processing(image_paths: Vec<String>) -> Result<(), String> {
    println!("Queueing {} images for processing", image_paths.len());
    Ok(())
}

#[tauri::command]
async fn process_next_image() -> Result<bool, String> {
    // Mock processing
    Ok(false) // No images in queue
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
            get_device_info,
            generate_thumbnail,
            generate_progressive_thumbnails,
            initialize_face_recognition,
            detect_faces,
            extract_embeddings,
            find_similar_faces,
            cluster_faces,
            get_people,
            update_person,
            get_processing_status,
            get_capabilities,
            set_processing_mode,
            queue_images_for_processing,
            process_next_image
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
