// apps/desktop/src-tauri/src/lib.rs
// Library exports for testing

pub mod database_enhanced;
pub mod sqlite_db;
pub mod database;
pub mod face_detection_ml;
pub mod face_embedding_ml;
pub mod face_clustering;
pub mod intelligent_organization;
pub mod metadata_extractor;

// Re-export main types for convenience
pub use database_enhanced::{
    EnhancedDatabase, MediaItem, Face, Person, Album, SyncMetadata,
    MediaType, AlbumType, DeviceType, SyncStatus, DeviceCapabilities,
    generate_id, calculate_sha256
};

pub use face_detection_ml::{MLFaceDetector, FaceDetectionResult, Face as DetectedFace};
pub use face_embedding_ml::{MobileFaceNetEmbedder, EmbeddingResult, EmbeddedFace, FaceCrop};
pub use face_clustering::{FaceClustering, ClusteringResult, PersonGroup};
pub use intelligent_organization::{IntelligentOrganizer, OrganizationResult};
pub use metadata_extractor::MetadataExtractor;
