// apps/desktop/src-tauri/src/database.rs
// Simple in-memory database for faces and people

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabaseFace {
    pub id: String,
    pub image_path: String,
    pub bounds: String,     // JSON string for FaceBounds
    pub embedding: Vec<u8>, // Compressed embedding
    pub confidence: f32,
    pub quality_score: f32,
    pub landmarks: String, // JSON string for FaceLandmarks
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DatabasePerson {
    pub id: String,
    pub name: Option<String>,
    pub face_count: usize,
    pub representative_face_id: String,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProcessingStatus {
    pub is_processing: bool,
    pub queue_length: usize,
    pub current_image: Option<String>,
    pub progress: f32,
    pub estimated_time_remaining: Option<u64>,
    pub current_stage: Option<String>,
    pub processed_images: Option<usize>,
    pub total_images: Option<usize>,
    pub faces_detected: Option<usize>,
    pub processing_speed: Option<f32>,
}

pub struct Database {
    faces: Mutex<HashMap<String, DatabaseFace>>,
    people: Mutex<HashMap<String, DatabasePerson>>,
    processing_status: Mutex<ProcessingStatus>,
}

impl Database {
    pub fn new() -> Self {
        Self {
            faces: Mutex::new(HashMap::new()),
            people: Mutex::new(HashMap::new()),
            processing_status: Mutex::new(ProcessingStatus {
                is_processing: false,
                queue_length: 0,
                current_image: None,
                progress: 0.0,
                estimated_time_remaining: None,
                current_stage: None,
                processed_images: None,
                total_images: None,
                faces_detected: None,
                processing_speed: None,
            }),
        }
    }

    pub fn initialize(&self) -> Result<(), anyhow::Error> {
        // In a real implementation, this would initialize the database connection
        // For now, we just ensure the mutexes are accessible
        drop(self.faces.lock());
        drop(self.people.lock());
        drop(self.processing_status.lock());
        Ok(())
    }

    pub fn add_face(&self, face: DatabaseFace) -> Result<(), anyhow::Error> {
        let mut faces = self
            .faces
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock faces"))?;
        faces.insert(face.id.clone(), face);
        Ok(())
    }

    pub fn add_person(&self, person: DatabasePerson) -> Result<(), anyhow::Error> {
        let mut people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        people.insert(person.id.clone(), person);
        Ok(())
    }

    pub fn get_faces(&self) -> Result<Vec<DatabaseFace>, anyhow::Error> {
        let faces = self
            .faces
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock faces"))?;
        Ok(faces.values().cloned().collect())
    }

    pub fn get_people(&self) -> Result<Vec<DatabasePerson>, anyhow::Error> {
        let people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        Ok(people.values().cloned().collect())
    }

    pub fn get_face(&self, face_id: &str) -> Result<Option<DatabaseFace>, anyhow::Error> {
        let faces = self
            .faces
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock faces"))?;
        Ok(faces.get(face_id).cloned())
    }

    pub fn get_person(&self, person_id: &str) -> Result<Option<DatabasePerson>, anyhow::Error> {
        let people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        Ok(people.get(person_id).cloned())
    }

    pub fn update_person(&self, person_id: &str, name: String) -> Result<(), anyhow::Error> {
        let mut people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        if let Some(person) = people.get_mut(person_id) {
            person.name = Some(name);
            Ok(())
        } else {
            Err(anyhow::anyhow!("Person not found: {}", person_id))
        }
    }

    pub fn get_face_count(&self) -> Result<usize, anyhow::Error> {
        let faces = self
            .faces
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock faces"))?;
        Ok(faces.len())
    }

    pub fn get_person_count(&self) -> Result<usize, anyhow::Error> {
        let people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        Ok(people.len())
    }

    pub fn update_processing_status(&self, status: ProcessingStatus) -> Result<(), anyhow::Error> {
        let mut current_status = self
            .processing_status
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock processing status"))?;
        *current_status = status;
        Ok(())
    }

    pub fn get_processing_status(&self) -> Result<ProcessingStatus, anyhow::Error> {
        let status = self
            .processing_status
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock processing status"))?;
        Ok(status.clone())
    }

    pub fn clear_all(&self) -> Result<(), anyhow::Error> {
        let mut faces = self
            .faces
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock faces"))?;
        let mut people = self
            .people
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock people"))?;
        let mut status = self
            .processing_status
            .lock()
            .map_err(|_| anyhow::anyhow!("Failed to lock processing status"))?;

        faces.clear();
        people.clear();
        *status = ProcessingStatus {
            is_processing: false,
            queue_length: 0,
            current_image: None,
            progress: 0.0,
            estimated_time_remaining: None,
            current_stage: None,
            processed_images: None,
            total_images: None,
            faces_detected: None,
            processing_speed: None,
        };

        Ok(())
    }
}
