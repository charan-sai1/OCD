use anyhow::Result;

// Stub module for compilation
pub struct EnhancedDatabase;

impl EnhancedDatabase {
    pub fn new(_path: std::path::PathBuf) -> Result<Self> {
        Ok(Self)
    }
    
    pub fn add_face(&self, _face: &Face) -> Result<()> {
        Ok(())
    }
    
    pub fn get_face(&self, _id: &str) -> Result<Option<Face>> {
        Ok(None)
    }
    
    pub fn update_face(&self, _face: &Face) -> Result<()> {
        Ok(())
    }
    
    pub fn get_all_faces(&self) -> Result<Vec<Face>> {
        Ok(vec![])
    }
    
    pub fn add_person(&self, _person: &Person) -> Result<()> {
        Ok(())
    }
    
    pub fn get_person(&self, _id: &str) -> Result<Option<Person>> {
        Ok(None)
    }
    
    pub fn update_person(&self, _person: &Person) -> Result<()> {
        Ok(())
    }
    
    pub fn get_all_people(&self) -> Result<Vec<Person>> {
        Ok(vec![])
    }
    
    pub fn update_face_person(&self, _face_id: &str, _person_id: Option<&str>) -> Result<()> {
        Ok(())
    }
    
    pub fn delete_face(&self, _id: &str, _sync: bool) -> Result<()> {
        Ok(())
    }
    
    pub fn delete_person(&self, _id: &str, _sync: bool) -> Result<()> {
        Ok(())
    }
}

#[derive(Clone)]
pub struct FaceBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Clone)]
pub struct FaceLandmarks {
    pub left_eye: Point,
    pub right_eye: Point,
    pub nose: Point,
    pub left_mouth: Point,
    pub right_mouth: Point,
    pub is_estimated: bool,
}

#[derive(Clone)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Clone)]
pub struct Face {
    pub id: String,
    pub media_id: String,
    pub image_path: String,
    pub image_hash: String,
    pub bounds: FaceBounds,
    pub embedding: Vec<u8>,
    pub confidence: f32,
    pub quality_score: f32,
    pub landmarks: Option<FaceLandmarks>,
    pub person_id: Option<String>,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub device_id: String,
    pub sync_status: SyncStatus,
}

#[derive(Clone)]
pub struct Person {
    pub id: String,
    pub name: Option<String>,
    pub face_count: i32,
    pub representative_face_id: String,
    pub confidence: f32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub updated_at: chrono::DateTime<chrono::Utc>,
    pub device_id: String,
    pub sync_status: SyncStatus,
}

#[derive(Clone, Copy)]
pub enum SyncStatus {
    Local,
    Synced,
    Pending,
}

pub enum MediaType {
    Image,
    Video,
    Document,
}

pub enum AlbumType {
    Person,
    Event,
    Location,
    Manual,
}

pub enum DeviceType {
    Desktop,
    Mobile,
    ExternalDrive,
}

#[derive(Clone)]
pub struct SyncMetadata {
    pub last_sync: chrono::DateTime<chrono::Utc>,
    pub sync_count: i32,
    pub conflicts: i32,
}

pub fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn calculate_sha256(data: &[u8]) -> String {
    use sha2::{Sha256, Digest};
    let mut hasher = Sha256::new();
    hasher.update(data);
    format!("{:x}", hasher.finalize())
}

