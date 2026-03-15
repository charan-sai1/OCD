#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use image::imageops::FilterType;
use once_cell::sync::Lazy;
use serde::{Deserialize, Serialize};
use std::sync::{Mutex, Arc};
use std::path::PathBuf;
use walkdir::WalkDir;
use anyhow::Result;

mod database;
mod database_enhanced;
mod sqlite_db;
mod face_detection_ml;
mod face_embedding_ml;
mod face_clustering;
mod intelligent_organization;
mod metadata_extractor;

use face_detection_ml::{MLFaceDetector, FaceDetectionResult};
use face_embedding_ml::{MobileFaceNetEmbedder, FaceCrop, FaceBounds};
use face_clustering::{FaceClustering, ClusteringResult};
use database_enhanced::{EnhancedDatabase, Face, Person, SyncStatus};
use intelligent_organization::IntelligentOrganizer;
use metadata_extractor::MetadataExtractor;

#[derive(Serialize, Deserialize)]
pub struct Device {
    pub name: String,
    pub mount_point: String,
    pub device_type: String,
    pub total_space: Option<u64>,
    pub available_space: Option<u64>,
}

// Global state for ML models and database
static FACE_DETECTOR: Lazy<Mutex<Option<MLFaceDetector>>> = Lazy::new(|| {
    Mutex::new(None)
});

static FACE_EMBEDDER: Lazy<Mutex<Option<MobileFaceNetEmbedder>>> = Lazy::new(|| {
    Mutex::new(None)
});

static DATABASE: Lazy<Mutex<Option<EnhancedDatabase>>> = Lazy::new(|| {
    Mutex::new(None)
});

static FACE_CLUSTERING: Lazy<Mutex<Option<FaceClustering>>> = Lazy::new(|| {
    Mutex::new(None)
});

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}!", name)
}

#[tauri::command]
fn initialize_face_recognition() -> Result<(), String> {
    // Initialize face detector
    let mut detector = FACE_DETECTOR.lock().map_err(|e| e.to_string())?;
    if detector.is_none() {
        let mut new_detector = MLFaceDetector::new().map_err(|e| e.to_string())?;
        
        // Load model from models directory
        let model_path = PathBuf::from("models").join("face-detection").join("yolov5s-face.onnx");
        if model_path.exists() {
            new_detector.load_model(&model_path).map_err(|e| e.to_string())?;
        }
        
        *detector = Some(new_detector);
    }
    
    // Initialize face embedder
    let mut embedder = FACE_EMBEDDER.lock().map_err(|e| e.to_string())?;
    if embedder.is_none() {
        let mut new_embedder = MobileFaceNetEmbedder::new().map_err(|e| e.to_string())?;
        
        // Load model from models directory
        let model_path = PathBuf::from("models").join("face-embedding").join("mobilefacenet.onnx");
        if model_path.exists() {
            new_embedder.load_model(&model_path).map_err(|e| e.to_string())?;
        }
        
        *embedder = Some(new_embedder);
    }
    
    // Initialize database
    let mut db = DATABASE.lock().map_err(|e| e.to_string())?;
    if db.is_none() {
        let db_path = PathBuf::from("ocd_gallery.db");
        let new_db = EnhancedDatabase::new(db_path).map_err(|e| e.to_string())?;
        *db = Some(new_db);
    }
    
    // Initialize face clustering
    let mut clustering = FACE_CLUSTERING.lock().map_err(|e| e.to_string())?;
    if clustering.is_none() {
        *clustering = Some(FaceClustering::new());
    }
    
    Ok(())
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
    let extensions = match file_type {
        "images" => vec!["jpg", "jpeg", "png", "gif", "bmp", "webp", "svg"],
        "pdfs" => vec!["pdf"],
        "all" => vec![
            "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "pdf", "doc", "docx", "txt", "rtf",
        ],
        _ => vec![],
    };

    let mut files = Vec::new();

    let walkdir = WalkDir::new(path)
        .follow_links(false)
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
                eprintln!("Error accessing directory entry: {}", e);
            }
        }

        if files.len() % 100 == 0 {
            tokio::task::yield_now().await;
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

    Ok(devices)
}

#[tauri::command]
fn get_file_info(path: &str) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::fs;

    let metadata = fs::metadata(path).map_err(|e| format!("Failed to get file metadata: {}", e))?;

    let modified = metadata
        .modified()
        .map_err(|e| format!("Failed to get modification time: {}", e))?
        .duration_since(std::time::UNIX_EPOCH)
        .map_err(|e| format!("Failed to convert time: {}", e))?
        .as_secs()
        * 1000;

    Ok(json!({
        "modified": modified,
        "size": metadata.len(),
        "is_dir": metadata.is_dir(),
        "is_file": metadata.is_file()
    }))
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
    use std::io::Cursor;

    let img = image::open(image_path).map_err(|e| format!("Failed to open image: {}", e))?;

    let thumbnail = img.resize(size, size, FilterType::Lanczos3);

    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

#[tauri::command]
async fn extract_exif_thumbnail(image_path: &str) -> Result<Option<String>, String> {
    use std::fs;

    let data =
        fs::read(image_path).map_err(|e| format!("Cannot read file for EXIF extraction: {}", e))?;

    if let Some(thumbnail_data) = find_embedded_jpeg(&data) {
        let base64_string = base64::encode(&thumbnail_data);
        return Ok(Some(format!("data:image/jpeg;base64,{}", base64_string)));
    }

    Ok(None)
}

fn find_embedded_jpeg(image_data: &[u8]) -> Option<Vec<u8>> {
    for i in 0..image_data.len().saturating_sub(2) {
        if image_data[i] == 0xFF && image_data[i + 1] == 0xD8 {
            let remaining = &image_data[i..];

            for j in 2..remaining.len().saturating_sub(2) {
                if remaining[j] == 0xFF && remaining[j + 1] == 0xD9 {
                    let thumbnail_size = j + 2;
                    if thumbnail_size > 500 && thumbnail_size < 100000 {
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
    match extract_exif_thumbnail(image_path).await {
        Ok(Some(exif_thumbnail)) => {
            if validate_base64_image(&exif_thumbnail).is_ok() {
                return Ok(exif_thumbnail);
            }
        }
        _ => {}
    }

    generate_thumbnail(image_path, size).await
}

fn validate_base64_image(base64_data: &str) -> Result<(), String> {
    let data = if base64_data.starts_with("data:image") {
        base64_data
            .split(',')
            .nth(1)
            .ok_or("Invalid data URL format")?
    } else {
        base64_data
    };

    base64::decode(data).map_err(|e| format!("Base64 decode error: {}", e))?;

    Ok(())
}

#[tauri::command]
async fn test_exif_extraction(test_image_path: &str) -> Result<serde_json::Value, String> {
    use serde_json::json;

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
    use std::io::Cursor;

    let mut results = Vec::new();

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

            let img_result = image::open(&request.image_path);

            match img_result {
                Ok(img) => {
                    if let Some(thumbnail_size) = request.thumbnail_size {
                        match generate_single_thumbnail(&img, thumbnail_size).await {
                            Ok(thumbnail_data) => result.thumbnail = Some(thumbnail_data),
                            Err(e) => result.error = Some(format!("Thumbnail error: {}", e)),
                        }
                    }

                    if let Some(preview_size) = request.preview_size {
                        match generate_single_thumbnail(&img, preview_size).await {
                            Ok(preview_data) => result.preview = Some(preview_data),
                            Err(e) => {
                                if result.error.is_none() {
                                    result.error = Some(format!("Preview error: {}", e));
                                }
                            }
                        }
                    }

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

        tokio::task::yield_now().await;
    }

    Ok(results)
}

async fn generate_single_thumbnail(img: &image::DynamicImage, size: u32) -> Result<String, String> {
    use std::io::Cursor;

    let thumbnail = img.resize(size, size, FilterType::Lanczos3);

    let mut buffer = Cursor::new(Vec::new());
    thumbnail
        .write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode thumbnail: {}", e))?;

    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

fn generate_full_quality(img: &image::DynamicImage) -> Result<String, String> {
    use std::io::Cursor;

    let mut buffer = Cursor::new(Vec::new());
    img.write_to(&mut buffer, image::ImageFormat::Jpeg)
        .map_err(|e| format!("Failed to encode full quality image: {}", e))?;

    let base64_string = base64::encode(buffer.get_ref());

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

// Real face recognition commands
#[tauri::command]
fn detect_faces(image_path: String) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::path::Path;
    
    let path = Path::new(&image_path);
    if image_path.is_empty() {
        return Err("Image path cannot be empty".to_string());
    }
    if !path.exists() {
        return Err(format!("Image file does not exist: {}", image_path));
    }
    if !path.is_file() {
        return Err(format!("Path is not a file: {}", image_path));
    }
    
    // Get the face detector
    let mut detector_guard = FACE_DETECTOR.lock().map_err(|e| e.to_string())?;
    
    // Initialize if not already done
    if detector_guard.is_none() {
        drop(detector_guard);
        initialize_face_recognition()?;
        detector_guard = FACE_DETECTOR.lock().map_err(|e| e.to_string())?;
    }
    
    let detector = detector_guard.as_ref().ok_or("Face detector not initialized")?;
    
    // Perform real face detection
    let result = detector.detect_faces(&image_path).map_err(|e| e.to_string())?;
    
    // Store faces in database
    let mut db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    if let Some(ref db) = *db_guard {
        for face in &result.faces {
            let db_face = Face {
                id: face.id.clone(),
                media_id: image_path.clone(),
                image_path: image_path.clone(),
                image_hash: "".to_string(), // Would calculate from image
                bounds: database_enhanced::FaceBounds {
                    x: face.bounds.x,
                    y: face.bounds.y,
                    width: face.bounds.width,
                    height: face.bounds.height,
                },
                embedding: Vec::new(), // Will be filled by extract_embeddings
                confidence: face.confidence,
                quality_score: face.quality_score,
                landmarks: face.landmarks.as_ref().map(|l| database_enhanced::FaceLandmarks {
                    left_eye: database_enhanced::Point { x: l.left_eye.x, y: l.left_eye.y },
                    right_eye: database_enhanced::Point { x: l.right_eye.x, y: l.right_eye.y },
                    nose: database_enhanced::Point { x: l.nose.x, y: l.nose.y },
                    left_mouth: database_enhanced::Point { x: l.left_mouth.x, y: l.left_mouth.y },
                    right_mouth: database_enhanced::Point { x: l.right_mouth.x, y: l.right_mouth.y },
                    is_estimated: l.is_estimated,
                }),
                person_id: None,
                created_at: chrono::Utc::now(),
                updated_at: chrono::Utc::now(),
                device_id: "desktop".to_string(),
                sync_status: SyncStatus::Local,
            };
            
            if let Err(e) = db.add_face(&db_face) {
                eprintln!("Warning: Failed to add face to database: {}", e);
            }
        }
    }
    
    Ok(json!({
        "faces": result.faces,
        "processingTime": result.processing_time,
        "modelUsed": result.model_used,
        "imagePath": result.image_path
    }))
}

#[tauri::command]
fn extract_embeddings(face_ids: Vec<String>) -> Result<serde_json::Value, String> {
    use serde_json::json;
    
    // Get the face embedder
    let mut embedder_guard = FACE_EMBEDDER.lock().map_err(|e| e.to_string())?;
    
    // Initialize if not already done
    if embedder_guard.is_none() {
        drop(embedder_guard);
        initialize_face_recognition()?;
        embedder_guard = FACE_EMBEDDER.lock().map_err(|e| e.to_string())?;
    }
    
    let embedder = embedder_guard.as_mut().ok_or("Face embedder not initialized")?;
    
    // Get faces from database
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    
    let mut face_crops = Vec::new();
    let mut face_id_map = std::collections::HashMap::new();
    
    for face_id in &face_ids {
        // Get face from database
        if let Ok(Some(face)) = db.get_face(face_id) {
            // Load image and crop face
            if let Ok(img) = image::open(&face.image_path) {
                let bounds = FaceBounds {
                    x: face.bounds.x,
                    y: face.bounds.y,
                    width: face.bounds.width,
                    height: face.bounds.height,
                };
                
                // Crop face from image
                let x = face.bounds.x.max(0.0) as u32;
                let y = face.bounds.y.max(0.0) as u32;
                let width = face.bounds.width.min(img.width() as f32 - x as f32) as u32;
                let height = face.bounds.height.min(img.height() as f32 - y as f32) as u32;
                
                if width > 0 && height > 0 {
                    let cropped = img.crop_imm(x, y, width, height);
                    let face_crop = FaceCrop {
                        face_id: face_id.clone(),
                        image_data: image::DynamicImage::ImageRgba8(cropped.to_rgba8()),
                        bounds,
                    };
                    face_crops.push(face_crop);
                    face_id_map.insert(face_id.clone(), face.clone());
                }
            }
        }
    }
    
    // Extract embeddings
    let result = embedder.extract_embeddings(face_crops).map_err(|e| e.to_string())?;
    
    // Update faces in database with embeddings
    drop(db_guard);
    let mut db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    if let Some(ref db) = *db_guard {
        for embedded_face in &result.faces {
            if let Some(mut face) = face_id_map.get(&embedded_face.id).cloned() {
                if embedded_face.embedding.is_empty() {
                    return Err("Embedding is empty for face".to_string());
                }
                let embedding_bytes: Vec<u8> = embedded_face.embedding.iter()
                    .flat_map(|&f| f.to_le_bytes().to_vec())
                    .collect();
                face.embedding = embedding_bytes;
                if let Err(e) = db.update_face(&face) {
                    eprintln!("Warning: Failed to update face in database: {}", e);
                }
            }
        }
    }
    
    Ok(json!({
        "faces": result.faces,
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
    use serde_json::json;
    
    let threshold = threshold.unwrap_or(0.6) as f32;
    let max_results = max_results.unwrap_or(10);
    
    // Get database
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    
    let query_face = db.get_face(&query_face_id)
        .map_err(|e| e.to_string())?
        .ok_or("Query face not found")?;
    
    if query_face.embedding.is_empty() {
        return Err("Query face has no embedding".to_string());
    }
    if query_face.embedding.len() % 4 != 0 {
        return Err(format!("Query face embedding has invalid size: {}", query_face.embedding.len()));
    }
    
    let query_embedding: Vec<f32> = query_face.embedding.chunks(4)
        .filter(|chunk| chunk.len() == 4)
        .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
        .collect();
    
    if query_embedding.is_empty() {
        return Err("Failed to parse query face embedding".to_string());
    }
    
    let all_faces = db.get_all_faces().map_err(|e| e.to_string())?;
    
    let mut similar_faces = Vec::new();
    
    for face in all_faces {
        if face.id == query_face_id {
            continue;
        }
        
        if face.embedding.is_empty() || face.embedding.len() % 4 != 0 {
            continue;
        }
        
        let face_embedding: Vec<f32> = face.embedding.chunks(4)
            .filter(|chunk| chunk.len() == 4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        
        if query_embedding.len() == face_embedding.len() && !face_embedding.is_empty() {
            // Calculate cosine similarity
            let dot_product: f32 = query_embedding.iter()
                .zip(face_embedding.iter())
                .map(|(a, b)| a * b)
                .sum();
            
            let norm_a: f32 = query_embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
            let norm_b: f32 = face_embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
            
            let similarity = if norm_a > 0.0 && norm_b > 0.0 {
                dot_product / (norm_a * norm_b)
            } else {
                0.0
            };
            
            if similarity >= threshold {
                similar_faces.push(json!({
                    "faceId": face.id,
                    "similarity": similarity,
                    "imagePath": face.image_path
                }));
            }
        }
    }
    
    // Sort by similarity and limit results
    similar_faces.sort_by(|a, b| {
        let a_sim: f32 = a["similarity"].as_f64().unwrap_or(0.0) as f32;
        let b_sim: f32 = b["similarity"].as_f64().unwrap_or(0.0) as f32;
        b_sim.partial_cmp(&a_sim).unwrap_or(std::cmp::Ordering::Equal)
    });
    
    similar_faces.truncate(max_results);
    
    Ok(json!({
        "similarFaces": similar_faces,
        "queryFaceId": query_face_id,
        "threshold": threshold
    }))
}

#[tauri::command]
fn cluster_faces(algorithm: Option<String>) -> Result<serde_json::Value, String> {
    use serde_json::json;
    
    let algorithm = algorithm.unwrap_or_else(|| "DBSCAN".to_string());
    
    // Get database
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    let db = db_guard.as_ref().ok_or("Database not initialized")?;
    
    // Get all faces with embeddings
    let all_faces = db.get_all_faces().map_err(|e| e.to_string())?;
    
    // Convert to embedded faces format
    let mut embedded_faces = Vec::new();
    for face in &all_faces {
        if face.embedding.is_empty() || face.embedding.len() % 4 != 0 {
            continue;
        }
        let embedding: Vec<f32> = face.embedding.chunks(4)
            .filter(|chunk| chunk.len() == 4)
            .map(|chunk| f32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
            .collect();
        
        if !embedding.is_empty() {
            embedded_faces.push(face_embedding_ml::EmbeddedFace {
                id: face.id.clone(),
                embedding,
                quality_score: face.quality_score,
            });
        }
    }
    
    // Perform clustering
    let clustering_guard = FACE_CLUSTERING.lock().map_err(|e| e.to_string())?;
    let clustering = clustering_guard.as_ref().ok_or("Face clustering not initialized")?;
    
    let result = clustering.cluster_faces(&embedded_faces).map_err(|e| e.to_string())?;
    
    // Store person groups in database
    drop(db_guard);
    let mut db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    if let Some(ref db) = *db_guard {
        for group in &result.person_groups {
            let person = Person {
                id: group.id.clone(),
                name: group.name.clone(),
                face_count: group.face_ids.len() as i32,
                representative_face_id: group.representative_face_id.clone(),
                confidence: group.confidence,
                created_at: group.created_at,
                updated_at: chrono::Utc::now(),
                device_id: "desktop".to_string(),
                sync_status: SyncStatus::Local,
            };
            
            if let Err(e) = db.add_person(&person) {
                eprintln!("Warning: Failed to add person to database: {}", e);
            }
            
            for face_id in &group.face_ids {
                if let Err(e) = db.update_face_person(face_id, Some(&group.id)) {
                    eprintln!("Warning: Failed to update face person_id: {}", e);
                }
            }
        }
    }
    
    Ok(json!({
        "personGroups": result.person_groups,
        "algorithm": result.algorithm,
        "processingTime": result.processing_time
    }))
}

#[tauri::command]
fn get_people() -> Result<serde_json::Value, String> {
    use serde_json::json;
    
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref db) = *db_guard {
        let people = db.get_all_people().map_err(|e| e.to_string())?;
        Ok(json!(people))
    } else {
        Ok(json!([]))
    }
}

#[tauri::command]
fn update_person(person_id: String, name: String) -> Result<(), String> {
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref db) = *db_guard {
        if let Some(mut person) = db.get_person(&person_id).map_err(|e| e.to_string())? {
            person.name = Some(name);
            person.updated_at = chrono::Utc::now();
            db.update_person(&person).map_err(|e| e.to_string())?;
        }
    }
    
    Ok(())
}

#[tauri::command]
fn get_processing_status() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "isProcessing": false,
        "queueLength": 0,
        "currentImage": null,
        "progress": 0.0,
        "estimatedTimeRemaining": null,
        "currentStage": null,
        "processedImages": 0,
        "totalImages": 0,
        "facesDetected": 0,
        "processingSpeed": 0.0
    }))
}

#[tauri::command]
fn get_capabilities() -> Result<serde_json::Value, String> {
    use sysinfo::{System, CpuRefreshKind};
    
    let mut system = System::new();
    system.refresh_cpu_specifics(CpuRefreshKind::everything());
    
    let cpu_cores = system.cpus().len() as u32;
    let memory_gb = system.total_memory() as f64 / 1024.0 / 1024.0 / 1024.0;
    
    Ok(serde_json::json!({
        "platform": "desktop",
        "cpuCores": cpu_cores,
        "memoryGB": memory_gb,
        "hasGPU": false,
        "batteryLevel": null,
        "isCharging": null,
        "thermalState": "nominal"
    }))
}

#[tauri::command]
fn set_processing_mode(_mode: String) -> Result<(), String> {
    // TODO: Implement processing mode configuration
    Ok(())
}

#[tauri::command]
async fn queue_images_for_processing(_image_paths: Vec<String>) -> Result<(), String> {
    // TODO: Implement batch processing queue
    Ok(())
}

#[tauri::command]
async fn process_next_image() -> Result<bool, String> {
    // TODO: Implement single image processing from queue
    Ok(false)
}

#[tauri::command]
fn process_folder(folder_path: String) -> Result<serde_json::Value, String> {
    use serde_json::json;
    use std::path::Path;
    use walkdir::WalkDir;
    
    let start_time = std::time::Instant::now();
    
    let mut images_processed = 0;
    let mut total_faces_detected = 0;
    let mut people_created = 0;
    
    // Initialize face recognition
    initialize_face_recognition()?;
    
    // Process all images in folder
    let image_extensions = ["jpg", "jpeg", "png", "gif", "bmp", "webp"];
    
    for entry in WalkDir::new(&folder_path).follow_links(false) {
        match entry {
            Ok(entry) => {
                if entry.file_type().is_file() {
                    if let Some(extension) = entry.path().extension() {
                        if let Some(ext_str) = extension.to_str() {
                            if image_extensions.contains(&ext_str.to_lowercase().as_str()) {
                                let image_path = entry.path().to_string_lossy().to_string();
                                
                                // Detect faces
                                if let Ok(result) = detect_faces(image_path.clone()) {
                                    let faces = result["faces"].as_array().unwrap_or(&Vec::new()).clone();
                                    total_faces_detected += faces.len();
                                    images_processed += 1;
                                }
                            }
                        }
                    }
                }
            }
            Err(e) => {
                eprintln!("Error accessing directory entry: {}", e);
            }
        }
    }
    
    // Extract embeddings for all detected faces
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    if let Some(ref db) = *db_guard {
        let all_faces = db.get_all_faces().map_err(|e| e.to_string())?;
        let face_ids: Vec<String> = all_faces.iter().map(|f| f.id.clone()).collect();
        drop(db_guard);
        
        if !face_ids.is_empty() {
            if let Err(e) = extract_embeddings(face_ids) {
                eprintln!("Warning: Failed to extract embeddings: {}", e);
            }
        }
    }
    
    // Cluster faces into people
    if let Ok(cluster_result) = cluster_faces(Some("DBSCAN".to_string())) {
        let empty_vec = Vec::new();
        let groups = cluster_result["personGroups"].as_array().unwrap_or(&empty_vec);
        people_created = groups.len();
    }
    
    let processing_time = start_time.elapsed().as_millis();
    
    Ok(json!({
        "success": true,
        "folderPath": folder_path,
        "imagesProcessed": images_processed,
        "totalFacesDetected": total_faces_detected,
        "peopleCreated": people_created,
        "processingTime": processing_time
    }))
}

#[tauri::command]
fn get_face_statistics() -> Result<serde_json::Value, String> {
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref db) = *db_guard {
        let all_faces = db.get_all_faces().map_err(|e| e.to_string())?;
        let all_people = db.get_all_people().map_err(|e| e.to_string())?;
        
        let total_faces = all_faces.len();
        let total_people = all_people.len();
        
        let avg_confidence = if !all_faces.is_empty() {
            all_faces.iter().map(|f| f.confidence).sum::<f32>() / all_faces.len() as f32
        } else {
            0.0
        };
        
        Ok(serde_json::json!({
            "totalFaces": total_faces,
            "totalPeople": total_people,
            "averageConfidence": avg_confidence,
            "faces": total_faces
        }))
    } else {
        Ok(serde_json::json!({
            "totalFaces": 0,
            "totalPeople": 0,
            "averageConfidence": 0.0,
            "faces": 0
        }))
    }
}

#[tauri::command]
fn clear_database() -> Result<(), String> {
    let db_guard = DATABASE.lock().map_err(|e| e.to_string())?;
    
    if let Some(ref db) = *db_guard {
        let all_faces = db.get_all_faces().map_err(|e| e.to_string())?;
        for face in all_faces {
            if let Err(e) = db.delete_face(&face.id, false) {
                eprintln!("Warning: Failed to delete face: {}", e);
            }
        }
        
        let all_people = db.get_all_people().map_err(|e| e.to_string())?;
        for person in all_people {
            if let Err(e) = db.delete_person(&person.id, false) {
                eprintln!("Warning: Failed to delete person: {}", e);
            }
        }
    }
    
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

#[derive(Serialize, Deserialize, Clone)]
pub struct ImportProgress {
    pub isImporting: bool,
    pub currentFile: usize,
    pub totalFiles: usize,
    pub importedFiles: usize,
    pub skippedFiles: usize,
    pub currentFileName: String,
    pub estimatedTimeRemaining: Option<String>,
}

static IMPORT_PROGRESS: Lazy<Mutex<ImportProgress>> = Lazy::new(|| {
    Mutex::new(ImportProgress {
        isImporting: false,
        currentFile: 0,
        totalFiles: 0,
        importedFiles: 0,
        skippedFiles: 0,
        currentFileName: String::new(),
        estimatedTimeRemaining: None,
    })
});

static CANCEL_IMPORT: Lazy<Mutex<bool>> = Lazy::new(|| Mutex::new(false));

#[tauri::command]
fn get_import_progress() -> Result<ImportProgress, String> {
    let progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
    Ok((*progress).clone())
}

#[tauri::command]
fn cancel_import() -> Result<(), String> {
    let mut cancel_flag = CANCEL_IMPORT.lock().map_err(|e| e.to_string())?;
    *cancel_flag = true;
    Ok(())
}

#[tauri::command]
async fn import_files(
    source_path: String,
    destination_path: String,
    file_extensions: Vec<String>,
    skip_duplicates: bool,
    preserve_structure: bool,
    _import_mode: String,
) -> Result<ImportResult, String> {
    use std::collections::HashSet;
    use std::fs;
    use std::path::Path;

    {
        let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
        *progress = ImportProgress {
            isImporting: true,
            currentFile: 0,
            totalFiles: 0,
            importedFiles: 0,
            skippedFiles: 0,
            currentFileName: "Scanning files...".to_string(),
            estimatedTimeRemaining: None,
        };
    }

    {
        let mut cancel_flag = CANCEL_IMPORT.lock().map_err(|e| e.to_string())?;
        *cancel_flag = false;
    }

    let source_path = Path::new(&source_path);
    let destination_path = Path::new(&destination_path);

    if !source_path.exists() || !source_path.is_dir() {
        {
            let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
            progress.isImporting = false;
        }
        return Err(format!(
            "Source path does not exist or is not a directory: {}",
            source_path.display()
        ));
    }

    if !destination_path.exists() {
        fs::create_dir_all(destination_path)
            .map_err(|e| format!("Failed to create destination directory: {}", e))?;
    }

    let mut total_files = 0;
    let mut imported_files = 0;
    let mut skipped_files = 0;
    let mut errors = Vec::new();
    let mut total_size_bytes = 0u64;

    let mut existing_files = HashSet::new();
    if skip_duplicates {
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
    }

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

        if files_to_import.len() % 100 == 0 {
            tokio::task::yield_now().await;
        }
    }

    total_files = files_to_import.len();

    {
        let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
        progress.totalFiles = total_files;
    }

    const BATCH_SIZE: usize = 10;

    for batch in files_to_import.chunks(BATCH_SIZE) {
        {
            let cancel_flag = CANCEL_IMPORT.lock().map_err(|e| e.to_string())?;
            if *cancel_flag {
                break;
            }
        }

        for source_file_path in batch {
            {
                let cancel_flag = CANCEL_IMPORT.lock().map_err(|e| e.to_string())?;
                if *cancel_flag {
                    break;
                }
            }

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

            {
                let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
                progress.currentFile += 1;
                progress.currentFileName = filename.clone();
            }

            if skip_duplicates && existing_files.contains(&filename) {
                skipped_files += 1;
                {
                    let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
                    progress.skippedFiles = skipped_files;
                }
                continue;
            }

            let dest_file_path = if preserve_structure {
                match source_file_path.strip_prefix(source_path) {
                    Ok(relative_path) => destination_path.join(relative_path),
                    Err(_) => destination_path.join(&filename),
                }
            } else {
                destination_path.join(&filename)
            };

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

            match fs::copy(source_file_path, &dest_file_path) {
                Ok(bytes_copied) => {
                    imported_files += 1;
                    total_size_bytes += bytes_copied;

                    {
                        let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
                        progress.importedFiles = imported_files;
                    }
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

        tokio::task::yield_now().await;
    }

    let was_cancelled = {
        let cancel_flag = CANCEL_IMPORT.lock().map_err(|e| e.to_string())?;
        *cancel_flag
    };

    {
        let mut progress = IMPORT_PROGRESS.lock().map_err(|e| e.to_string())?;
        progress.isImporting = false;
        progress.currentFileName = String::new();
    }

    Ok(ImportResult {
        importedFiles: imported_files,
        totalFiles: total_files,
        skippedFiles: skipped_files,
        errors,
        totalSizeBytes: total_size_bytes,
    })
}

#[tauri::command]
async fn generate_video_thumbnail(video_path: &str, size: u32) -> Result<String, String> {
    use std::process::Command;

    let ffmpeg_check = Command::new("ffmpeg").arg("-version").output();

    if ffmpeg_check.is_err() {
        return Err("FFmpeg not available for video thumbnail generation".to_string());
    }

    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir.join(format!("thumb_{}.jpg", chrono::Utc::now().timestamp()));

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

    let seek_time = duration * 0.1;

    let ffmpeg_result = Command::new("ffmpeg")
        .args(&[
            "-ss",
            &seek_time.to_string(),
            "-i",
            video_path,
            "-vframes",
            "1",
            "-q:v",
            "2",
            "-vf",
            &format!(
                "scale='min({},iw)':'min({},ih)':force_original_aspect_ratio=decrease",
                size, size
            ),
            "-y",
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

    let thumbnail_data =
        std::fs::read(&output_path).map_err(|e| format!("Failed to read thumbnail: {}", e))?;

    let _ = std::fs::remove_file(&output_path);

    let base64_string = base64::encode(&thumbnail_data);

    Ok(format!("data:image/jpeg;base64,{}", base64_string))
}

#[tauri::command]
async fn detect_media_type(file_path: &str) -> Result<String, String> {
    use std::fs;
    use std::path::Path;

    let path = Path::new(file_path);

    if let Some(extension) = path.extension() {
        if let Some(ext_str) = extension.to_str() {
            let ext_lower = ext_str.to_lowercase();

            if ["mp4", "avi", "mov", "mkv", "wmv", "flv", "webm", "m4v"].contains(&ext_lower.as_str()) {
                return Ok("video".to_string());
            }

            if [
                "jpg", "jpeg", "png", "gif", "bmp", "webp", "svg", "tiff", "tif",
            ]
            .contains(&ext_lower.as_str())
            {
                return Ok("image".to_string());
            }
        }
    }

    match fs::read(file_path) {
        Ok(data) if data.len() >= 12 => {
            if data.starts_with(&[0x00, 0x00, 0x00, 0x20, 0x66, 0x74, 0x79, 0x70]) {
                return Ok("video".to_string());
            }
            if data.starts_with(&[0x52, 0x49, 0x46, 0x46])
                && data[8..12] == [0x41, 0x56, 0x49, 0x20]
            {
                return Ok("video".to_string());
            }

            if data.starts_with(&[0xFF, 0xD8, 0xFF]) {
                return Ok("image".to_string());
            }
            if data.starts_with(&[0x89, 0x50, 0x4E, 0x47]) {
                return Ok("image".to_string());
            }
            if data.starts_with(&[0x47, 0x49, 0x46, 0x38]) {
                return Ok("image".to_string());
            }
            if data.starts_with(&[0x42, 0x4D]) {
                return Ok("image".to_string());
            }

            Ok("unknown".to_string())
        }
        _ => Ok("unknown".to_string()),
    }
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
            get_file_info,
            get_device_info,
            read_binary_file,
            generate_thumbnail,
            generate_progressive_thumbnails,
            extract_exif_thumbnail,
            extract_or_generate_thumbnail,
            test_exif_extraction,
            import_files,
            get_import_progress,
            cancel_import,
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
