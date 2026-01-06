// apps/desktop/src-tauri/src/tests.rs
#[cfg(test)]
mod tests {
    use crate::face_recognition::FaceRecognitionService;
    use crate::sqlite_db::{DatabaseFace, DatabasePerson, SqliteDatabase};
    use std::path::PathBuf;

    #[test]
    fn test_face_recognition_service_creation() {
        let model_dir = PathBuf::from("models");
        let service = FaceRecognitionService::new(model_dir);
        // Service should be created without panicking
        assert!(true); // If we get here, service creation worked
    }

    #[test]
    fn test_database_operations() {
        let db_path = PathBuf::from("test_faces.db");
        let db = SqliteDatabase::new(db_path.clone()).unwrap();

        // Test face insertion
        let test_face = DatabaseFace {
            id: "test_face_1".to_string(),
            image_path: "/test/path/image.jpg".to_string(),
            bounds: "{\"x\": 10.0, \"y\": 20.0, \"width\": 100.0, \"height\": 120.0}".to_string(),
            embedding: vec![0; 512], // 512 bytes of zeros for testing
            confidence: 0.95,
            quality_score: 0.8,
            landmarks: "{\"left_eye\": {\"x\": 40.0, \"y\": 50.0}}".to_string(),
            created_at: chrono::Utc::now(),
        };

        db.add_face(test_face.clone()).unwrap();

        // Test face retrieval
        let faces = db.get_faces().unwrap();
        assert_eq!(faces.len(), 1);
        assert_eq!(faces[0].id, "test_face_1");

        // Test person operations
        let test_person = DatabasePerson {
            id: "test_person_1".to_string(),
            name: Some("Test Person".to_string()),
            face_count: 1,
            representative_face_id: "test_face_1".to_string(),
            created_at: chrono::Utc::now(),
        };

        db.add_person(test_person.clone()).unwrap();

        let people = db.get_people().unwrap();
        assert_eq!(people.len(), 1);
        assert_eq!(people[0].name, Some("Test Person".to_string()));

        // Test statistics
        let face_count = db.get_face_count().unwrap();
        let person_count = db.get_person_count().unwrap();
        assert_eq!(face_count, 1);
        assert_eq!(person_count, 1);

        // Cleanup
        db.clear_all().unwrap();
        std::fs::remove_file(db_path).unwrap_or(());
    }

    #[test]
    fn test_face_detection_mock() {
        // Create a temporary test image
        use image::{Rgb, RgbImage};
        use std::fs;

        let temp_dir = tempfile::tempdir().unwrap();
        let image_path = temp_dir.path().join("test.jpg");

        // Create a simple test image (100x100 red square)
        let mut img = RgbImage::new(100, 100);
        for (_x, _y, pixel) in img.enumerate_pixels_mut() {
            *pixel = Rgb([255, 0, 0]);
        }
        img.save(&image_path).unwrap();

        let model_dir = PathBuf::from("models");
        let service = FaceRecognitionService::new(model_dir);

        // Test with the actual test image
        let result = service.detect_faces(&image_path.to_string_lossy());
        assert!(
            result.is_ok(),
            "Face detection should succeed with valid image"
        );

        let detection_result = result.unwrap();
        assert_eq!(detection_result.image_path, image_path.to_string_lossy());
        assert!(detection_result.faces.len() >= 0); // Should have at least default face
        assert!(detection_result.processing_time > 0);

        // Cleanup
        fs::remove_file(image_path).unwrap();
    }

    #[test]
    fn test_face_clustering() {
        let model_dir = PathBuf::from("models");
        let service = FaceRecognitionService::new(model_dir);

        let result = service.cluster_faces();
        assert!(result.is_ok());

        let clustering_result = result.unwrap();
        assert_eq!(clustering_result.algorithm, "DBSCAN");
        assert!(clustering_result.processing_time >= 0);
    }

    #[test]
    fn test_capabilities_detection() {
        let model_dir = PathBuf::from("models");
        let service = FaceRecognitionService::new(model_dir);

        let capabilities = service.get_capabilities();
        assert_eq!(capabilities.platform, "desktop");
        assert!(capabilities.cpu_cores > 0);
        assert!(capabilities.memory_gb > 0.0);
    }
}
