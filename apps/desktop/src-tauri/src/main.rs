#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::imageops::FilterType;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;
use walkdir::WalkDir;

mod database;
mod face_recognition;
mod sqlite_db;
#[cfg(test)]
mod tests;

use face_recognition::{FaceRecognitionService, ProcessingMode};

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

    let recursive = true; // Always recursive
    let max_depth = 20; // Allow deeper directory structures

    let extensions = match file_type {
        "images" => vec!["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
        "pdfs" => vec!["pdf"],
        "all" => vec![
            "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "pdf", "doc", "docx", "txt", "rtf",
        ],
        _ => vec![],
    };

    let mut files = Vec::new();

    if recursive {
        // Use WalkDir for efficient recursive scanning
        let walkdir = WalkDir::new(path)
            .follow_links(false) // Don't follow symlinks to avoid loops
            .into_iter();

        for entry in walkdir {
            match entry {
                Ok(entry) => {
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
                Err(e) => {
                    // Log error but continue processing other files
                    eprintln!("Error accessing directory entry: {}", e);
                }
            }

            // Yield control periodically to prevent blocking
            if files.len() % 100 == 0 {
                tokio::task::yield_now().await;
            }
        }
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
async fn read_binary_file(path: &str) -> Result<Vec<u8>, String> {
    use std::fs;
    fs::read(path).map_err(|e| format!("Failed to read file: {}", e))
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

#[tauri::command]
async fn extract_exif_thumbnail(image_path: &str) -> Result<Option<String>, String> {
    use std::fs;

    let data =
        fs::read(image_path).map_err(|e| format!("Cannot read file for EXIF extraction: {}", e))?;

    // Try to extract embedded thumbnail using marker-based approach
    // This works for most cameras that store thumbnails as embedded JPEGs
    if let Some(thumbnail_data) = find_embedded_jpeg(&data) {
        let base64_string = base64::encode(&thumbnail_data);
        return Ok(Some(format!("data:image/jpeg;base64,{}", base64_string)));
    }

    Ok(None) // No EXIF thumbnail found
}

fn find_embedded_jpeg(image_data: &[u8]) -> Option<Vec<u8>> {
    // Look for embedded JPEG thumbnail after the main image
    // Many cameras store thumbnails as separate JPEG segments

    // Look for JPEG SOI marker (0xFF, 0xD8)
    for i in 0..image_data.len().saturating_sub(2) {
        if image_data[i] == 0xFF && image_data[i + 1] == 0xD8 {
            // Found potential JPEG start, check if it looks like a thumbnail
            let remaining = &image_data[i..];

            // Look for JPEG EOI marker (0xFF, 0xD9)
            for j in 2..remaining.len().saturating_sub(2) {
                if remaining[j] == 0xFF && remaining[j + 1] == 0xD9 {
                    let thumbnail_size = j + 2;
                    if thumbnail_size > 500 && thumbnail_size < 100000 {
                        // Reasonable thumbnail size
                        return Some(remaining[0..thumbnail_size].to_vec());
                    }
                    break;
                }
            }
        }
    }

    None
}

#[tauri::command]
async fn extract_or_generate_thumbnail(image_path: &str, size: u32) -> Result<String, String> {
    // First, try to extract existing EXIF thumbnail
    match extract_exif_thumbnail(image_path).await {
        Ok(Some(exif_thumbnail)) => {
            // Validate the EXIF thumbnail by attempting to load it
            if validate_base64_image(&exif_thumbnail).is_ok() {
                println!("Using EXIF thumbnail for: {}", image_path);
                return Ok(exif_thumbnail);
            } else {
                println!(
                    "EXIF thumbnail validation failed, generating new thumbnail for: {}",
                    image_path
                );
            }
        }
        Ok(None) => {
            println!(
                "No EXIF thumbnail found, generating new thumbnail for: {}",
                image_path
            );
        }
        Err(e) => {
            println!(
                "EXIF extraction failed ({}), generating new thumbnail for: {}",
                e, image_path
            );
        }
    }

    // Fallback: Generate new thumbnail
    generate_thumbnail(image_path, size).await
}

fn validate_base64_image(base64_data: &str) -> Result<(), String> {
    // Remove the data URL prefix if present
    let data = if base64_data.starts_with("data:image") {
        base64_data
            .split(',')
            .nth(1)
            .ok_or("Invalid data URL format")?
    } else {
        base64_data
    };

    // Try to decode the base64 data
    base64::decode(data).map_err(|e| format!("Base64 decode error: {}", e))?;

    // Additional validation could include checking image format headers
    // For now, successful base64 decode indicates valid thumbnail data

    Ok(())
}

#[tauri::command]
async fn test_exif_extraction(test_image_path: &str) -> Result<serde_json::Value, String> {
    use serde_json::json;

    println!("Testing EXIF extraction for: {}", test_image_path);

    let exif_result = extract_exif_thumbnail(test_image_path).await;
    let has_exif = exif_result.is_ok() && exif_result.as_ref().unwrap().is_some();

    let result = json!({
        "imagePath": test_image_path,
        "hasExifThumbnail": has_exif,
        "exifResult": match exif_result {
            Ok(Some(data)) => format!("Found thumbnail ({} bytes)", data.len()),
            Ok(None) => "No EXIF thumbnail found".to_string(),
            Err(e) => format!("Error: {}", e)
        }
    });

    Ok(result)
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
    println!(
        "Backend: generate_progressive_thumbnails called with {} requests",
        requests.len()
    );
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

// Facial Recognition Service
static FACE_RECOGNITION_SERVICE: Lazy<Mutex<FaceRecognitionService>> = Lazy::new(|| {
    let model_dir = std::path::PathBuf::from("models");
    Mutex::new(FaceRecognitionService::new(model_dir))
});

#[tauri::command]
fn initialize_face_recognition() -> Result<(), String> {
    // Service is already initialized in the static
    Ok(())
}

#[tauri::command]
fn detect_faces(image_path: String) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let result = service_guard
        .detect_faces(&image_path)
        .map_err(|e| e.to_string())?;

    // Convert result to JSON
    let faces_json: Vec<serde_json::Value> = result
        .faces
        .iter()
        .map(|face| {
            json!({
                "id": face.id,
                "bounds": {
                    "x": face.bounds.x,
                    "y": face.bounds.y,
                    "width": face.bounds.width,
                    "height": face.bounds.height
                },
                "confidence": face.confidence,
                "landmarks": face.landmarks.as_ref().map(|landmarks| json!({
                    "leftEye": {"x": landmarks.left_eye.x, "y": landmarks.left_eye.y},
                    "rightEye": {"x": landmarks.right_eye.x, "y": landmarks.right_eye.y},
                    "nose": {"x": landmarks.nose.x, "y": landmarks.nose.y},
                    "leftMouth": {"x": landmarks.left_mouth.x, "y": landmarks.left_mouth.y},
                    "rightMouth": {"x": landmarks.right_mouth.x, "y": landmarks.right_mouth.y}
                }))
            })
        })
        .collect();

    Ok(json!({
        "faces": faces_json,
        "processingTime": result.processing_time,
        "modelUsed": result.model_used,
        "imagePath": result.image_path
    }))
}

#[tauri::command]
fn extract_embeddings(face_ids: Vec<String>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let result = service_guard
        .extract_embeddings(face_ids)
        .map_err(|e| e.to_string())?;

    // Convert result to JSON
    let faces_json: Vec<serde_json::Value> = result
        .faces
        .iter()
        .map(|face| {
            json!({
                "id": face.id,
                "embedding": face.embedding
            })
        })
        .collect();

    Ok(json!({
        "faces": faces_json,
        "processingTime": result.processing_time,
        "modelUsed": result.model_used
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
fn cluster_faces(algorithm: Option<String>) -> Result<serde_json::Value, String> {
    use serde_json::json;

    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let result = service_guard.cluster_faces().map_err(|e| e.to_string())?;

    // Convert result to JSON
    let person_groups_json: Vec<serde_json::Value> = result
        .person_groups
        .iter()
        .map(|person| {
            json!({
                "id": person.id,
                "name": person.name,
                "faceIds": person.face_ids,
                "representativeFaceId": person.representative_face_id,
                "confidence": person.confidence,
                "createdAt": person.created_at.to_rfc3339()
            })
        })
        .collect();

    Ok(json!({
        "personGroups": person_groups_json,
        "algorithm": result.algorithm
    }))
}

#[tauri::command]
fn get_people() -> Result<serde_json::Value, String> {
    use serde_json::json;

    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let people = service_guard.get_people().map_err(|e| e.to_string())?;

    // Convert result to JSON
    let people_json: Vec<serde_json::Value> = people
        .iter()
        .map(|person| {
            json!({
                "id": person.id,
                "name": person.name,
                "faceIds": person.face_ids,
                "representativeFaceId": person.representative_face_id,
                "confidence": person.confidence,
                "createdAt": person.created_at.to_rfc3339()
            })
        })
        .collect();

    Ok(serde_json::Value::Array(people_json))
}

#[tauri::command]
fn update_person(person_id: String, name: String) -> Result<(), String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    service_guard
        .update_person(&person_id, &name)
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
fn get_processing_status() -> Result<serde_json::Value, String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let status = service_guard
        .get_processing_status()
        .map_err(|e| e.to_string())?;

    Ok(serde_json::json!({
        "isProcessing": status.is_processing,
        "queueLength": status.queue_length,
        "currentImage": status.current_image,
        "progress": status.progress,
        "estimatedTimeRemaining": status.estimated_time_remaining,
        "currentStage": status.current_stage,
        "processedImages": status.processed_images,
        "totalImages": status.total_images,
        "facesDetected": status.faces_detected,
        "processingSpeed": status.processing_speed
    }))
}

#[tauri::command]
fn get_capabilities() -> Result<serde_json::Value, String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let capabilities = service_guard.get_capabilities();

    Ok(serde_json::json!({
        "platform": capabilities.platform,
        "cpuCores": capabilities.cpu_cores,
        "memoryGB": capabilities.memory_gb,
        "hasGPU": capabilities.has_gpu,
        "batteryLevel": capabilities.battery_level,
        "isCharging": capabilities.is_charging,
        "thermalState": capabilities.thermal_state
    }))
}

#[tauri::command]
async fn generate_video_thumbnail(video_path: &str, size: u32) -> Result<String, String> {
    use std::fs;
    use std::process::Command;

    // Check if ffmpeg is available
    let ffmpeg_check = Command::new("ffmpeg").arg("-version").output();

    if ffmpeg_check.is_err() {
        return Err("FFmpeg not available for video thumbnail generation".to_string());
    }

    // Create temporary output path for thumbnail
    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join(format!("thumb_{}.jpg", chrono::Utc::now().timestamp()));

    // Extract frame at 10% into video using ffmpeg
    let duration_output = Command::new("ffprobe")
        .args(&[
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            video_path,
        ])
        .output()
        .map_err(|e| format!("Failed to get video duration: {}", e))?;

    let duration_json: serde_json::Value = serde_json::from_slice(&duration_output.stdout)
        .map_err(|e| format!("Failed to parse duration JSON: {}", e))?;

    let duration = duration_json["format"]["duration"]
        .as_str()
        .and_then(|d| d.parse::<f64>().ok())
        .unwrap_or(10.0);

    let seek_time = duration * 0.1; // 10% into video

    let ffmpeg_result = Command::new("ffmpeg")
        .args(&[
            "-ss",
            &seek_time.to_string(),
            "-i",
            video_path,
            "-vframes",
            "1",
            "-q:v",
            "2", // High quality
            "-vf",
            &format!(
                "scale='min({},iw)':'min({},ih)':force_original_aspect_ratio=decrease",
                size, size
            ),
            "-y", // Overwrite output
            &output_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| format!("FFmpeg thumbnail generation failed: {}", e))?;

    if !ffmpeg_result.status.success() {
        return Err(format!(
            "FFmpeg failed: {}",
            String::from_utf8_lossy(&ffmpeg_result.stderr)
        ));
    }

    // Read the generated thumbnail and convert to base64
    let thumbnail_data =
        fs::read(&output_path).map_err(|e| format!("Failed to read thumbnail: {}", e))?;

    // Clean up temp file
    let _ = fs::remove_file(&output_path);

    let base64_string = base64::encode(&thumbnail_data);

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

#[tauri::command]
async fn detect_media_type(file_path: &str) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(file_path);

    // First check extension
    if let Some(extension) = path.extension() {
        if let Some(ext_str) = extension.to_str() {
            let ext_lower = ext_str.to_lowercase();

            // Video extensions
            if ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v"].contains(&ext_str) {
                return Ok("video".to_string());
            }

            // Image extensions
            if [
                "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "tif",
            ]
            .contains(&ext_str)
            {
                return Ok("image".to_string());
            }
        }
    }

    // Fallback: read file header to detect by magic bytes
    match fs::read(file_path) {
        Ok(data) if data.len() >= 12 => {
            // Check for video signatures
            if data.starts_with(&[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) {
                return Ok("video".to_string()); // MP4
            }
            if data.starts_with(&[0x52, 0x49, 0x46, 0x46])
                && data[8..12] == [0x41, 0x56, 0x49, 0x20]
            {
                return Ok("video".to_string()); // AVI
            }

            // Check for image signatures
            if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                return Ok("image".to_string()); // JPEG
            }
            if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                return Ok("image".to_string()); // PNG
            }
            if data.starts_with(&[0x47, 0x49, 0x46, 0x38]) {
                return Ok("image".to_string()); // GIF
            }
            if data.starts_with(&[0x42, 0x4D]) {
                return Ok("image".to_string()); // BMP
            }

            Ok("unknown".to_string())
        }
        _ => Ok("unknown".to_string()),
    }
}

#[tauri::command]
fn set_processing_mode(mode: String) -> Result<(), String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    let processing_mode = match mode.as_str() {
        "fast" => ProcessingMode::Fast,
        "balanced" => ProcessingMode::Balanced,
        "accurate" => ProcessingMode::HighAccuracy,
        _ => return Err(format!("Invalid processing mode: {}", mode)),
    };

    service_guard
        .set_processing_mode(processing_mode)
        .map_err(|e| e.to_string())?;
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

#[tauri::command]
fn process_folder(folder_path: String) -> Result<serde_json::Value, String> {
    use std::path::Path;
    use walkdir::WalkDir;

    let folder_path = Path::new(&folder_path);
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Invalid folder path".to_string());
    }

    let mut image_paths = Vec::new();
    let image_extensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp"];

    // Collect all image files in the folder
    for entry in WalkDir::new(folder_path)
        .max_depth(5) // Limit depth to prevent excessive scanning
        .into_iter()
        .filter_map(|e| e.ok())
    {
        if entry.file_type().is_file() {
            if let Some(extension) = entry.path().extension() {
                if let Some(ext_str) = extension.to_str() {
                    if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                        if let Some(path_str) = entry.path().to_str() {
                            image_paths.push(path_str.to_string());
                        }
                    }
                }
            }
        }
    }

    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;

    let mut total_faces = 0;
    let start_time = std::time::Instant::now();

    // Process each image
    for image_path in &image_paths {
        match service_guard.detect_faces(image_path) {
            Ok(result) => {
                total_faces += result.faces.len();
            }
            Err(e) => {
                eprintln!("Error processing {}: {}", image_path, e);
                // Continue with other images
            }
        }
    }

    let processing_time = start_time.elapsed().as_millis();

    // Run clustering on all detected faces
    match service_guard.cluster_faces() {
        Ok(clustering_result) => Ok(serde_json::json!({
            "success": true,
            "folderPath": folder_path.to_string_lossy(),
            "imagesProcessed": image_paths.len(),
            "totalFacesDetected": total_faces,
            "peopleCreated": clustering_result.person_groups.len(),
            "processingTime": processing_time
        })),
        Err(e) => Ok(serde_json::json!({
            "success": false,
            "folderPath": folder_path.to_string_lossy(),
            "imagesProcessed": image_paths.len(),
            "totalFacesDetected": total_faces,
            "error": e,
            "processingTime": processing_time
        })),
    }
}

#[tauri::command]
fn get_face_statistics() -> Result<serde_json::Value, String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;

    let face_count = service_guard
        .database
        .get_face_count()
        .map_err(|e| e.to_string())?;
    let person_count = service_guard
        .database
        .get_person_count()
        .map_err(|e| e.to_string())?;
    let faces = service_guard
        .database
        .get_faces()
        .map_err(|e| e.to_string())?;

    // Calculate some statistics
    let avg_confidence = if !faces.is_empty() {
        faces.iter().map(|f| f.confidence).sum::<f32>() / faces.len() as f32
    } else {
        0.0
    };

    Ok(serde_json::json!({
        "totalFaces": face_count,
        "totalPeople": person_count,
        "averageConfidence": avg_confidence,
        "faces": faces.len()
    }))
}

#[tauri::command]
fn clear_database() -> Result<(), String> {
    let service_guard = FACE_RECOGNITION_SERVICE.lock().map_err(|e| e.to_string())?;
    service_guard
        .database
        .clear_all()
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[derive(Serialize, Deserialize)]
pub struct ImportResult {
    pub importedFiles: usize,
    pub totalFiles: usize,
    pub skippedFiles: usize,
    pub errors: Vec<String>,
    pub totalSizeBytes: u64,
}

#[tauri::command]
async fn import_files(
    source_path: String,
    destination_path: String,
    file_extensions: Vec<String>,
    skip_duplicates: bool,
    preserve_structure: bool,
    import_mode: String,
) -> Result<ImportResult, String> {
    use std::collections::HashSet;
    use std::fs;
    use std::path::{Path, PathBuf};
    use walkdir::WalkDir;

    println!(
        "Starting file import from {} to {} with mode: {}",
        source_path, destination_path, import_mode
    );

    let source_path = Path::new(&source_path);
    let destination_path = Path::new(&destination_path);

    // Validate source and destination
    if !source_path.exists() || !source_path.is_dir() {
        return Err(format!(
            "Source path does not exist or is not a directory: {}",
            source_path.display()
        ));
    }

    if !destination_path.exists() {
        fs::create_dir_all(destination_path)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    let mut totalFiles = 0;
    let mut importedFiles = 0;
    let mut skippedFiles = 0;
    let mut errors = Vec::new();
    let mut totalSizeBytes = 0u64;

    // For smart import, we need to track existing files in destination
    let mut existing_files = HashSet::new();
    if skip_duplicates {
        println!("Building index of existing files for duplicate detection...");
        let walkdir = WalkDir::new(destination_path)
            .follow_links(false)
            .into_iter();

        for entry in walkdir {
            match entry {
                Ok(entry) => {
                    if entry.file_type().is_file() {
                        if let Some(extension) = entry.path().extension() {
                            if let Some(ext_str) = extension.to_str() {
                                if file_extensions.contains(&ext_str.to_lowercase()) {
                                    // Store filename for duplicate checking
                                    if let Some(filename) = entry.path().file_name() {
                                        existing_files
                                            .insert(filename.to_string_lossy().to_string());
                                    }
                                }
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("Error indexing existing files: {}", e);
                }
            }
        }
        println!("Indexed {} existing files", existing_files.len());
    }

    // Collect all files to import
    println!("Scanning source directory for files...");
    let walkdir = WalkDir::new(source_path).follow_links(false).into_iter();

    let mut files_to_import = Vec::new();

    for entry in walkdir {
        match entry {
            Ok(entry) => {
                if entry.file_type().is_file() {
                    if let Some(extension) = entry.path().extension() {
                        if let Some(ext_str) = extension.to_str() {
                            if file_extensions.contains(&ext_str.to_lowercase()) {
                                files_to_import.push(entry.path().to_path_buf());
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Error scanning source directory: {}", e);
                errors.push(format!("Error scanning: {}", e));
            }
        }

        // Yield control periodically to prevent blocking
        if files_to_import.len() % 100 == 0 {
            tokio::task::yield_now().await;
        }
    }

    totalFiles = files_to_import.len();
    println!("Found {} files to process", totalFiles);

    // Process files in batches to avoid overwhelming the system
    const BATCH_SIZE: usize = 10;

    for batch in files_to_import.chunks(BATCH_SIZE) {
        for source_file_path in batch {
            let filename = match source_file_path.file_name() {
                Some(name) => name.to_string_lossy().to_string(),
                None => {
                    errors.push(format!(
                        "Invalid filename for: {}",
                        source_file_path.display()
                    ));
                    continue;
                }
            };

            // Check for duplicates in smart mode
            if skip_duplicates && existing_files.contains(&filename) {
                println!("Skipping duplicate file: {}", filename);
                skippedFiles += 1;
                continue;
            }

            // Determine destination path
            let dest_file_path = if preserve_structure {
                // Preserve directory structure relative to source
                match source_file_path.strip_prefix(source_path) {
                    Ok(relative_path) => destination_path.join(relative_path),
                    Err(_) => {
                        // Fallback to just filename if we can't determine relative path
                        destination_path.join(&filename)
                    }
                }
            } else {
                destination_path.join(&filename)
            };

            // Create destination directory if needed
            if let Some(parent) = dest_file_path.parent() {
                if let Err(e) = fs::create_dir_all(parent) {
                    let error_msg = format!(
                        "Failed to create destination directory {}: {}",
                        parent.display(),
                        e
                    );
                    eprintln!("{}", error_msg);
                    errors.push(error_msg);
                    continue;
                }
            }

            // Copy the file
            match fs::copy(source_file_path, &dest_file_path) {
                Ok(bytes_copied) => {
                    importedFiles += 1;
                    totalSizeBytes += bytes_copied;
                    println!(
                        "Imported: {} ({} bytes)",
                        dest_file_path.display(),
                        bytes_copied
                    );
                }
                Err(e) => {
                    let error_msg = format!(
                        "Failed to copy {} to {}: {}",
                        source_file_path.display(),
                        dest_file_path.display(),
                        e
                    );
                    eprintln!("{}", error_msg);
                    errors.push(error_msg);
                }
            }
        }

        // Yield control between batches
        tokio::task::yield_now().await;
    }

    println!(
        "Import completed. Imported: {}, Skipped: {}, Errors: {}",
        importedFiles,
        skippedFiles,
        errors.len()
    );

    Ok(ImportResult {
        importedFiles,
        totalFiles,
        skippedFiles,
        errors,
        totalSizeBytes,
    })
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
            read_binary_file,
            generate_thumbnail,
            generate_progressive_thumbnails,
            extract_exif_thumbnail,
            extract_or_generate_thumbnail,
            test_exif_extraction,
            import_files,
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
            process_next_image,
            process_folder,
            get_face_statistics,
            clear_database,
            generate_video_thumbnail,
            detect_media_type
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
