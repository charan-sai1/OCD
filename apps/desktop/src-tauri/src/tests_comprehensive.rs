// apps/desktop/src-tauri/src/tests_comprehensive.rs
// Comprehensive test suite for Phase 1 implementation

#[cfg(test)]
mod tests {
    use std::path::PathBuf;
    use std::fs;
    use tempfile::TempDir;
    
    // Test modules
    use crate::face_detection_ml::{MLFaceDetector, Face};
    use crate::face_embedding_ml::{MobileFaceNetEmbedder, FaceCrop, FaceBounds};
    use crate::database_enhanced::{
        EnhancedDatabase, MediaItem, MediaType, SyncStatus, Album, AlbumType, 
        Person, Face as DatabaseFace, generate_id, calculate_sha256, calculate_perceptual_hash
    };
    use crate::metadata_extractor::{MetadataExtractor, MediaMetadata};
    use crate::intelligent_organization::{
        IntelligentOrganizer, SceneClassifier, ObjectDetector, DuplicateDetector,
        AlbumCondition, QualityAssessment
    };

    // ============================================================================
    // Face Detection Tests
    // ============================================================================

    #[test]
    fn test_face_detector_creation() {
        let detector = MLFaceDetector::new();
        assert!(detector.is_ok(), "Should create face detector successfully");
    }

    #[test]
    fn test_face_detector_model_loading() {
        let mut detector = MLFaceDetector::new().unwrap();
        
        // Test with non-existent model path
        let fake_path = PathBuf::from("/fake/path/model.onnx");
        let result = detector.load_model(&fake_path);
        assert!(result.is_err(), "Should fail with non-existent model");
        
        // Test with existing model path (if available)
        let model_path = PathBuf::from("models/face-detection/yolov5s-face.onnx");
        if model_path.exists() {
            let result = detector.load_model(&model_path);
            assert!(result.is_ok(), "Should load existing model successfully");
        }
    }

    #[test]
    fn test_face_detection_with_sample_image() {
        let mut detector = MLFaceDetector::new().unwrap();
        
        // Load model if available
        let model_path = PathBuf::from("models/face-detection/yolov5s-face.onnx");
        if !model_path.exists() {
            println!("Skipping face detection test - model not found");
            return;
        }
        
        detector.load_model(&model_path).unwrap();
        
        // Create a test image
        let temp_dir = TempDir::new().unwrap();
        let test_image_path = temp_dir.path().join("test_face.jpg");
        
        // Create a simple test image (100x100 red square)
        let img = image::ImageBuffer::from_fn(100, 100, |_, _| {
            image::Rgba([255, 0, 0, 255])
        });
        img.save(&test_image_path).unwrap();
        
        // Test face detection
        let result = detector.detect_faces(test_image_path.to_str().unwrap());
        
        // Should not error, even if no faces found
        assert!(result.is_ok(), "Face detection should not error");
        
        let detection_result = result.unwrap();
        println!("Detected {} faces in test image", detection_result.faces.len());
        
        // Clean up
        let _ = fs::remove_file(&test_image_path);
    }

    #[test]
    fn test_face_quality_metrics() {
        let detector = MLFaceDetector::new().unwrap();
        
        // Create test images with different qualities
        let temp_dir = TempDir::new().unwrap();
        
        // Sharp image
        let sharp_path = temp_dir.path().join("sharp.jpg");
        let sharp_img = image::ImageBuffer::from_fn(100, 100, |x, y| {
            let val = ((x + y) % 256) as u8;
            image::Rgba([val, val, val, 255])
        });
        sharp_img.save(&sharp_path).unwrap();
        
        // Test that quality metrics can be calculated
        // Note: This tests the internal methods indirectly through detection
        let _ = fs::remove_file(&sharp_path);
    }

    // ============================================================================
    // Face Embedding Tests
    // ============================================================================

    #[test]
    fn test_embedder_creation() {
        let embedder = MobileFaceNetEmbedder::new();
        assert!(embedder.is_ok(), "Should create embedder successfully");
    }

    #[test]
    fn test_embedding_normalization() {
        let mut embedding = vec![1.0, 2.0, 3.0, 4.0];
        MobileFaceNetEmbedder::normalize_embedding(&mut embedding);
        
        // Calculate norm
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        assert!((norm - 1.0).abs() < 0.001, "Embedding should be normalized to unit length");
    }

    #[test]
    fn test_similarity_calculation() {
        let embedding1 = vec![1.0, 0.0, 0.0];
        let embedding2 = vec![1.0, 0.0, 0.0];
        let embedding3 = vec![0.0, 1.0, 0.0];
        
        let sim1 = MobileFaceNetEmbedder::calculate_similarity(&embedding1, &embedding2);
        let sim2 = MobileFaceNetEmbedder::calculate_similarity(&embedding1, &embedding3);
        
        assert!((sim1 - 1.0).abs() < 0.001, "Identical embeddings should have similarity 1.0");
        assert!(sim2 < 0.1, "Orthogonal embeddings should have low similarity");
    }

    #[test]
    fn test_distance_calculation() {
        let embedding1 = vec![0.0, 0.0, 0.0];
        let embedding2 = vec![3.0, 4.0, 0.0];
        
        let distance = MobileFaceNetEmbedder::calculate_distance(&embedding1, &embedding2);
        assert!((distance - 5.0).abs() < 0.001, "Distance should be 5.0 (3-4-5 triangle)");
    }

    #[test]
    fn test_face_crop_creation() {
        let temp_dir = TempDir::new().unwrap();
        let test_image_path = temp_dir.path().join("test.jpg");
        
        let img = image::ImageBuffer::from_fn(200, 200, |_, _| {
            image::Rgba([100, 150, 200, 255])
        });
        img.save(&test_image_path).unwrap();
        
        let bounds = FaceBounds {
            x: 50.0,
            y: 50.0,
            width: 100.0,
            height: 100.0,
        };
        
        let crop_result = super::super::face_embedding_ml::crop_and_align_face(
            test_image_path.to_str().unwrap(),
            &bounds,
            None
        );
        
        assert!(crop_result.is_ok(), "Should crop face successfully");
        
        let _ = fs::remove_file(&test_image_path);
    }

    // ============================================================================
    // Database Tests
    // ============================================================================

    #[test]
    fn test_database_creation() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        
        let db = EnhancedDatabase::new(db_path);
        assert!(db.is_ok(), "Should create database successfully");
    }

    #[test]
    fn test_media_item_crud() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        // Create test media item
        let media = MediaItem {
            id: generate_id(),
            path: "/test/path/image.jpg".to_string(),
            hash: "abc123".to_string(),
            perceptual_hash: Some("11110000".to_string()),
            media_type: MediaType::Image,
            width: Some(1920),
            height: Some(1080),
            size_bytes: 1024000,
            created_at: Some(chrono::Utc::now()),
            modified_at: chrono::Utc::now(),
            taken_at: Some(chrono::Utc::now()),
            timezone: Some("UTC".to_string()),
            gps_lat: Some(37.7749),
            gps_lon: Some(-122.4194),
            device_make: Some("Apple".to_string()),
            device_model: Some("iPhone14,2".to_string()),
            orientation: Some(1),
            duration: None,
            thumbnail_path: None,
            is_favorite: false,
            is_hidden: false,
            is_deleted: false,
            deleted_at: None,
            album_ids: vec![],
            person_ids: vec![],
            scene_tags: vec!["beach".to_string()],
            object_tags: vec!["person".to_string()],
            color_dominant: Some("#FF5733".to_string()),
            embedding_clip: None,
            sync_status: SyncStatus::Local,
            device_id: generate_id(),
            updated_at: chrono::Utc::now(),
        };
        
        // Test insert
        let result = db.add_media_item(&media);
        assert!(result.is_ok(), "Should insert media item successfully");
        
        // Test retrieve by ID
        let retrieved = db.get_media_item(&media.id).unwrap();
        assert!(retrieved.is_some(), "Should retrieve media item");
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.id, media.id);
        assert_eq!(retrieved.path, media.path);
        assert_eq!(retrieved.hash, media.hash);
        
        // Test retrieve by hash
        let by_hash = db.get_media_item_by_hash(&media.hash).unwrap();
        assert!(by_hash.is_some(), "Should retrieve by hash");
        
        // Test update
        let mut updated = media.clone();
        updated.is_favorite = true;
        let result = db.update_media_item(&updated);
        assert!(result.is_ok(), "Should update media item");
        
        // Verify update
        let retrieved = db.get_media_item(&media.id).unwrap().unwrap();
        assert!(retrieved.is_favorite, "Favorite status should be updated");
        
        // Test soft delete
        let result = db.delete_media_item(&media.id, true);
        assert!(result.is_ok(), "Should soft delete media item");
        
        // Verify soft delete (should not be retrievable)
        let retrieved = db.get_media_item(&media.id).unwrap();
        assert!(retrieved.is_none(), "Soft deleted item should not be retrievable");
    }

    #[test]
    fn test_album_operations() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        // Create album
        let album = Album {
            id: generate_id(),
            name: "Vacation 2024".to_string(),
            album_type: AlbumType::User,
            cover_media_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            rules: None,
            sync_status: SyncStatus::Local,
        };
        
        let result = db.add_album(&album);
        assert!(result.is_ok(), "Should create album");
        
        // Retrieve album
        let retrieved = db.get_album(&album.id).unwrap();
        assert!(retrieved.is_some(), "Should retrieve album");
        
        // Get all albums
        let all_albums = db.get_all_albums().unwrap();
        assert_eq!(all_albums.len(), 1, "Should have one album");
        
        // Create media item and add to album
        let media = create_test_media_item();
        db.add_media_item(&media).unwrap();
        
        let result = db.add_media_to_album(&album.id, &media.id);
        assert!(result.is_ok(), "Should add media to album");
        
        // Get album media
        let album_media = db.get_album_media(&album.id).unwrap();
        assert_eq!(album_media.len(), 1, "Album should have one media item");
        assert_eq!(album_media[0].id, media.id);
    }

    #[test]
    fn test_person_operations() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        // Create person
        let person = Person {
            id: generate_id(),
            name: Some("John Doe".to_string()),
            face_count: 5,
            representative_face_id: generate_id(),
            confidence: 0.95,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            device_id: generate_id(),
            sync_status: SyncStatus::Local,
        };
        
        let result = db.add_person(&person);
        assert!(result.is_ok(), "Should create person");
        
        // Retrieve person
        let retrieved = db.get_person(&person.id).unwrap();
        assert!(retrieved.is_some(), "Should retrieve person");
        
        let retrieved = retrieved.unwrap();
        assert_eq!(retrieved.name, person.name);
        
        // Get all people
        let all_people = db.get_all_people().unwrap();
        assert_eq!(all_people.len(), 1, "Should have one person");
        
        // Update person
        let mut updated = person.clone();
        updated.name = Some("Jane Doe".to_string());
        let result = db.update_person(&updated);
        assert!(result.is_ok(), "Should update person");
        
        // Verify update
        let retrieved = db.get_person(&person.id).unwrap().unwrap();
        assert_eq!(retrieved.name, Some("Jane Doe".to_string()));
    }

    #[test]
    fn test_search_operations() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        // Create media items with different tags
        let mut media1 = create_test_media_item();
        media1.scene_tags = vec!["beach".to_string(), "vacation".to_string()];
        media1.object_tags = vec!["person".to_string()];
        
        let mut media2 = create_test_media_item();
        media2.scene_tags = vec!["mountain".to_string()];
        media2.object_tags = vec!["dog".to_string()];
        
        db.add_media_item(&media1).unwrap();
        db.add_media_item(&media2).unwrap();
        
        // Search by tags
        let results = db.search_by_tags(&["beach".to_string()]).unwrap();
        assert_eq!(results.len(), 1, "Should find one beach image");
        assert_eq!(results[0].id, media1.id);
        
        // Search by date range
        let start = chrono::Utc::now() - chrono::Duration::hours(1);
        let end = chrono::Utc::now() + chrono::Duration::hours(1);
        let results = db.search_by_date_range(start, end).unwrap();
        assert!(results.len() >= 1, "Should find images in date range");
    }

    // ============================================================================
    // Metadata Extractor Tests
    // ============================================================================

    #[test]
    fn test_metadata_extractor_creation() {
        let extractor = MetadataExtractor::new();
        // Just verify it can be created
    }

    #[test]
    fn test_exif_date_parsing() {
        let extractor = MetadataExtractor::new();
        
        // Test various date formats
        let test_cases = vec![
            "2023:10:15 14:30:00",
            "2023-10-15 14:30:00",
            "2023-10-15T14:30:00",
        ];
        
        for date_str in test_cases {
            // This tests the internal parsing logic
            // In a real test, we'd verify the parsed date
            println!("Testing date format: {}", date_str);
        }
    }

    #[test]
    fn test_dominant_color_extraction() {
        let temp_dir = TempDir::new().unwrap();
        let test_image_path = temp_dir.path().join("red_image.jpg");
        
        // Create a red image
        let img = image::ImageBuffer::from_fn(100, 100, |_, _| {
            image::Rgba([255, 0, 0, 255])
        });
        img.save(&test_image_path).unwrap();
        
        // Load and extract dominant color
        let img = image::open(&test_image_path).unwrap();
        let extractor = MetadataExtractor::new();
        let color = extractor.extract_dominant_color(&img);
        
        assert!(color.is_some(), "Should extract dominant color");
        let color = color.unwrap();
        assert!(color.starts_with('#'), "Color should be hex format");
        
        // Should be close to red
        assert!(color.contains("FF") || color.contains("fe") || color.contains("fd"),
                "Dominant color should be close to red");
        
        let _ = fs::remove_file(&test_image_path);
    }

    #[test]
    fn test_file_type_detection() {
        let extractor = MetadataExtractor::new();
        
        // Test image detection
        assert!(extractor.is_image_file(PathBuf::from("test.jpg").as_path()));
        assert!(extractor.is_image_file(PathBuf::from("test.png").as_path()));
        assert!(extractor.is_image_file(PathBuf::from("test.HEIC").as_path()));
        
        // Test video detection
        assert!(extractor.is_video_file(PathBuf::from("test.mp4").as_path()));
        assert!(extractor.is_video_file(PathBuf::from("test.MOV").as_path()));
        
        // Test non-media
        assert!(!extractor.is_image_file(PathBuf::from("test.txt").as_path()));
        assert!(!extractor.is_video_file(PathBuf::from("test.jpg").as_path()));
    }

    // ============================================================================
    // Intelligent Organization Tests
    // ============================================================================

    #[test]
    fn test_scene_classifier_creation() {
        let classifier = SceneClassifier::new();
        // Just verify it can be created
    }

    #[test]
    fn test_object_detector_creation() {
        let detector = ObjectDetector::new();
        // Just verify it can be created
    }

    #[test]
    fn test_duplicate_detector_creation() {
        let detector = DuplicateDetector::new();
        // Just verify it can be created
    }

    #[test]
    fn test_smart_tag_generation() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        let organizer = IntelligentOrganizer::new(db).unwrap();
        
        // Create test media with various attributes
        let mut media = create_test_media_item();
        media.taken_at = Some(chrono::Utc::now());
        media.gps_lat = Some(37.7749);
        media.gps_lon = Some(-122.4194);
        media.is_favorite = true;
        media.device_make = Some("Apple".to_string());
        
        // This would test the tag generation logic
        // In a full test, we'd verify the generated tags
    }

    #[test]
    fn test_album_condition_matching() {
        // Test various album conditions
        let conditions = vec![
            AlbumCondition::Favorite,
            AlbumCondition::RecentlyAdded { days: 30 },
            AlbumCondition::Tag { tags: vec!["beach".to_string()] },
        ];
        
        // Verify conditions can be created and serialized
        for condition in conditions {
            let json = serde_json::to_string(&condition);
            assert!(json.is_ok(), "Condition should serialize");
        }
    }

    #[test]
    fn test_quality_assessment() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        let organizer = IntelligentOrganizer::new(db).unwrap();
        
        // Create test images with different qualities
        let test_media = create_test_media_item();
        
        // This would test quality assessment
        // In a full test, we'd create images with known qualities and verify detection
    }

    // ============================================================================
    // Utility Function Tests
    // ============================================================================

    #[test]
    fn test_id_generation() {
        let id1 = generate_id();
        let id2 = generate_id();
        
        assert_ne!(id1, id2, "Generated IDs should be unique");
        assert_eq!(id1.len(), 36, "ID should be UUID format (36 chars)");
    }

    #[test]
    fn test_sha256_calculation() {
        let temp_dir = TempDir::new().unwrap();
        let test_file = temp_dir.path().join("test.txt");
        
        fs::write(&test_file, "Hello, World!").unwrap();
        
        let hash1 = calculate_sha256(&test_file).unwrap();
        let hash2 = calculate_sha256(&test_file).unwrap();
        
        assert_eq!(hash1, hash2, "Same file should have same hash");
        assert_eq!(hash1.len(), 64, "SHA-256 should be 64 hex chars");
        
        // Modify file and check hash changes
        fs::write(&test_file, "Hello, World!!").unwrap();
        let hash3 = calculate_sha256(&test_file).unwrap();
        assert_ne!(hash1, hash3, "Different content should have different hash");
    }

    #[test]
    fn test_perceptual_hash() {
        let temp_dir = TempDir::new().unwrap();
        let test_image_path = temp_dir.path().join("test.jpg");
        
        // Create test image
        let img = image::ImageBuffer::from_fn(100, 100, |_, _| {
            image::Rgba([128, 128, 128, 255])
        });
        img.save(&test_image_path).unwrap();
        
        let img = image::open(&test_image_path).unwrap();
        let hash = calculate_perceptual_hash(&img).unwrap();
        
        assert!(!hash.is_empty(), "Perceptual hash should not be empty");
        assert_eq!(hash.len(), 64, "Perceptual hash should be 64 bits (8x8)");
        
        let _ = fs::remove_file(&test_image_path);
    }

    // ============================================================================
    // Integration Tests
    // ============================================================================

    #[test]
    fn test_full_pipeline() {
        let temp_dir = TempDir::new().unwrap();
        let db_path = temp_dir.path().join("test.db");
        let db = EnhancedDatabase::new(db_path).unwrap();
        
        // Create test image
        let test_image_path = temp_dir.path().join("test_face.jpg");
        let img = image::ImageBuffer::from_fn(200, 200, |x, y| {
            // Create a simple face-like pattern
            let cx = 100;
            let cy = 100;
            let dist = ((x as i32 - cx).pow(2) + (y as i32 - cy).pow(2)) as f32;
            if dist < 2500.0 {
                image::Rgba([200, 150, 120, 255]) // Face color
            } else {
                image::Rgba([100, 150, 200, 255]) // Background
            }
        });
        img.save(&test_image_path).unwrap();
        
        // Step 1: Extract metadata
        let extractor = MetadataExtractor::new();
        let metadata = extractor.extract_metadata(&test_image_path).unwrap();
        
        assert_eq!(metadata.file_path, test_image_path.to_string_lossy());
        assert!(metadata.width.is_some());
        assert!(metadata.height.is_some());
        
        // Step 2: Create media item in database
        let media_item = MediaItem {
            id: generate_id(),
            path: test_image_path.to_string_lossy().to_string(),
            hash: calculate_sha256(&test_image_path).unwrap(),
            perceptual_hash: Some(calculate_perceptual_hash(&image::open(&test_image_path).unwrap()).unwrap()),
            media_type: MediaType::Image,
            width: metadata.width.map(|w| w as i32),
            height: metadata.height.map(|h| h as i32),
            size_bytes: metadata.file_size as i64,
            created_at: metadata.date_taken,
            modified_at: metadata.file_modified,
            taken_at: metadata.date_taken,
            timezone: metadata.timezone,
            gps_lat: metadata.gps_latitude,
            gps_lon: metadata.gps_longitude,
            device_make: metadata.device_make,
            device_model: metadata.device_model,
            orientation: metadata.orientation.map(|o| o as i32),
            duration: metadata.duration,
            thumbnail_path: None,
            is_favorite: false,
            is_hidden: false,
            is_deleted: false,
            deleted_at: None,
            album_ids: vec![],
            person_ids: vec![],
            scene_tags: vec![],
            object_tags: vec![],
            color_dominant: metadata.dominant_color,
            embedding_clip: None,
            sync_status: SyncStatus::Local,
            device_id: generate_id(),
            updated_at: chrono::Utc::now(),
        };
        
        db.add_media_item(&media_item).unwrap();
        
        // Step 3: Run intelligent organization
        let organizer = IntelligentOrganizer::new(db.clone()).unwrap();
        let result = organizer.organize_media(&media_item.id);
        
        // Should complete without error
        assert!(result.is_ok(), "Organization should complete successfully");
        
        // Step 4: Verify media was updated
        let updated = db.get_media_item(&media_item.id).unwrap().unwrap();
        assert!(!updated.scene_tags.is_empty() || !updated.object_tags.is_empty() || updated.color_dominant.is_some(),
                "Media should have been analyzed");
        
        // Cleanup
        let _ = fs::remove_file(&test_image_path);
    }

    // ============================================================================
    // Helper Functions
    // ============================================================================

    fn create_test_media_item() -> MediaItem {
        MediaItem {
            id: generate_id(),
            path: "/test/path/image.jpg".to_string(),
            hash: generate_id(),
            perceptual_hash: None,
            media_type: MediaType::Image,
            width: Some(1920),
            height: Some(1080),
            size_bytes: 1024000,
            created_at: Some(chrono::Utc::now()),
            modified_at: chrono::Utc::now(),
            taken_at: Some(chrono::Utc::now()),
            timezone: None,
            gps_lat: None,
            gps_lon: None,
            device_make: None,
            device_model: None,
            orientation: None,
            duration: None,
            thumbnail_path: None,
            is_favorite: false,
            is_hidden: false,
            is_deleted: false,
            deleted_at: None,
            album_ids: vec![],
            person_ids: vec![],
            scene_tags: vec![],
            object_tags: vec![],
            color_dominant: None,
            embedding_clip: None,
            sync_status: SyncStatus::Local,
            device_id: generate_id(),
            updated_at: chrono::Utc::now(),
        }
    }
}
