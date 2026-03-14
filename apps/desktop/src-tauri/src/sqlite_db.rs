// apps/desktop/src-tauri/src/sqlite_db.rs
// SQLite database implementation for persistent face/people data

use anyhow::{Result, anyhow};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::sync::Mutex;

// Note: Face and PersonGroup types defined locally to avoid dependency on face_recognition module
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Face {
    pub id: String,
    pub image_path: String,
    pub bounds: FaceBounds,
    pub confidence: f32,
    pub landmarks: Option<FaceLandmarks>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceLandmarks {
    pub left_eye: Point,
    pub right_eye: Point,
    pub nose: Point,
    pub left_mouth: Point,
    pub right_mouth: Point,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Point {
    pub x: f32,
    pub y: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonGroup {
    pub id: String,
    pub name: Option<String>,
    pub face_ids: Vec<String>,
    pub representative_face_id: String,
    pub confidence: f32,
    pub created_at: chrono::DateTime<chrono::Utc>,
    pub generation: Option<String>,
    pub is_admin: Option<bool>,
}

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

pub struct SqliteDatabase {
    conn: Mutex<Connection>,
}

impl SqliteDatabase {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(db_path)?;

        // Create tables
        conn.execute(
            "CREATE TABLE IF NOT EXISTS faces (
                id TEXT PRIMARY KEY,
                image_path TEXT NOT NULL,
                bounds TEXT NOT NULL,
                embedding BLOB,
                confidence REAL NOT NULL,
                quality_score REAL NOT NULL,
                landmarks TEXT,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS people (
                id TEXT PRIMARY KEY,
                name TEXT,
                face_count INTEGER NOT NULL,
                representative_face_id TEXT NOT NULL,
                created_at TEXT NOT NULL
            )",
            [],
        )?;

        conn.execute(
            "CREATE TABLE IF NOT EXISTS processing_status (
                key TEXT PRIMARY KEY,
                value TEXT NOT NULL
            )",
            [],
        )?;

        Ok(Self {
            conn: Mutex::new(conn),
        })
    }

    pub fn initialize(&self) -> Result<()> {
        // Database is already initialized in new()
        Ok(())
    }

    pub fn add_face(&self, face: DatabaseFace) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        conn.execute(
            "INSERT OR REPLACE INTO faces (id, image_path, bounds, embedding, confidence, quality_score, landmarks, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            params![
                face.id,
                face.image_path,
                face.bounds,
                face.embedding,
                face.confidence,
                face.quality_score,
                face.landmarks,
                face.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn add_person(&self, person: DatabasePerson) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        conn.execute(
            "INSERT OR REPLACE INTO people (id, name, face_count, representative_face_id, created_at)
             VALUES (?, ?, ?, ?, ?)",
            params![
                person.id,
                person.name,
                person.face_count as i64,
                person.representative_face_id,
                person.created_at.to_rfc3339()
            ],
        )?;
        Ok(())
    }

    pub fn get_faces(&self) -> Result<Vec<DatabaseFace>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let mut stmt = conn.prepare("SELECT id, image_path, bounds, embedding, confidence, quality_score, landmarks, created_at FROM faces")?;

        let faces_iter = stmt.query_map([], |row| {
            let created_at_str: String = row.get(7)?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .map_err(|_| {
                    rusqlite::Error::InvalidColumnType(
                        7,
                        "created_at".to_string(),
                        rusqlite::types::Type::Text,
                    )
                })?
                .with_timezone(&chrono::Utc);

            Ok(DatabaseFace {
                id: row.get(0)?,
                image_path: row.get(1)?,
                bounds: row.get(2)?,
                embedding: row.get(3)?,
                confidence: row.get(4)?,
                quality_score: row.get(5)?,
                landmarks: row.get(6)?,
                created_at,
            })
        })?;

        let mut faces = Vec::new();
        for face in faces_iter {
            faces.push(face?);
        }

        Ok(faces)
    }

    pub fn get_people(&self) -> Result<Vec<DatabasePerson>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let mut stmt = conn.prepare(
            "SELECT id, name, face_count, representative_face_id, created_at FROM people",
        )?;

        let people_iter = stmt.query_map([], |row| {
            let created_at_str: String = row.get(4)?;
            let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                .map_err(|_| {
                    rusqlite::Error::InvalidColumnType(
                        4,
                        "created_at".to_string(),
                        rusqlite::types::Type::Text,
                    )
                })?
                .with_timezone(&chrono::Utc);

            Ok(DatabasePerson {
                id: row.get(0)?,
                name: row.get(1)?,
                face_count: row.get::<_, i64>(2)? as usize,
                representative_face_id: row.get(3)?,
                created_at,
            })
        })?;

        let mut people = Vec::new();
        for person in people_iter {
            people.push(person?);
        }

        Ok(people)
    }

    pub fn get_face(&self, face_id: &str) -> Result<Option<DatabaseFace>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let mut stmt = conn.prepare("SELECT id, image_path, bounds, embedding, confidence, quality_score, landmarks, created_at FROM faces WHERE id = ?")?;

        let result = stmt
            .query_row(params![face_id], |row| {
                let created_at_str: String = row.get(7)?;
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map_err(|_| {
                        rusqlite::Error::InvalidColumnType(
                            7,
                            "created_at".to_string(),
                            rusqlite::types::Type::Text,
                        )
                    })?
                    .with_timezone(&chrono::Utc);

                Ok(DatabaseFace {
                    id: row.get(0)?,
                    image_path: row.get(1)?,
                    bounds: row.get(2)?,
                    embedding: row.get(3)?,
                    confidence: row.get(4)?,
                    quality_score: row.get(5)?,
                    landmarks: row.get(6)?,
                    created_at,
                })
            })
            .optional()?;

        Ok(result)
    }

    pub fn get_person(&self, person_id: &str) -> Result<Option<DatabasePerson>> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let mut stmt = conn.prepare("SELECT id, name, face_count, representative_face_id, created_at FROM people WHERE id = ?")?;

        let result = stmt
            .query_row(params![person_id], |row| {
                let created_at_str: String = row.get(4)?;
                let created_at = chrono::DateTime::parse_from_rfc3339(&created_at_str)
                    .map_err(|_| {
                        rusqlite::Error::InvalidColumnType(
                            4,
                            "created_at".to_string(),
                            rusqlite::types::Type::Text,
                        )
                    })?
                    .with_timezone(&chrono::Utc);

                Ok(DatabasePerson {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    face_count: row.get::<_, i64>(2)? as usize,
                    representative_face_id: row.get(3)?,
                    created_at,
                })
            })
            .optional()?;

        Ok(result)
    }

    pub fn update_person(&self, person_id: &str, name: String) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        conn.execute(
            "UPDATE people SET name = ? WHERE id = ?",
            params![name, person_id],
        )?;
        Ok(())
    }

    pub fn get_face_count(&self) -> Result<usize> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM faces", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn get_person_count(&self) -> Result<usize> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let count: i64 = conn.query_row("SELECT COUNT(*) FROM people", [], |row| row.get(0))?;
        Ok(count as usize)
    }

    pub fn update_processing_status(&self, status: ProcessingStatus) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        let status_json = serde_json::to_string(&status)?;

        conn.execute(
            "INSERT OR REPLACE INTO processing_status (key, value) VALUES (?, ?)",
            params!["status", status_json],
        )?;
        Ok(())
    }

    pub fn get_processing_status(&self) -> Result<ProcessingStatus> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;

        let status_json: Option<String> = conn
            .query_row(
                "SELECT value FROM processing_status WHERE key = ?",
                params!["status"],
                |row| row.get(0),
            )
            .optional()?;

        match status_json {
            Some(json) => {
                let status: ProcessingStatus = serde_json::from_str(&json)?;
                Ok(status)
            }
            None => Ok(ProcessingStatus {
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

    pub fn clear_all(&self) -> Result<()> {
        let conn = self
            .conn
            .lock()
            .map_err(|_| anyhow!("Failed to lock database"))?;
        conn.execute("DELETE FROM faces", [])?;
        conn.execute("DELETE FROM people", [])?;
        conn.execute("DELETE FROM processing_status", [])?;
        Ok(())
    }
}

// Conversion implementations
impl From<Face> for DatabaseFace {
    fn from(face: Face) -> Self {
        let bounds_json = serde_json::to_string(&face.bounds).unwrap_or_default();
        let landmarks_json = if let Some(landmarks) = face.landmarks {
            serde_json::to_string(&landmarks).unwrap_or_default()
        } else {
            "{}".to_string()
        };

        // Compress embedding (placeholder - in real implementation, use quantization)
        let embedding_bytes = Vec::new(); // Empty for now since Face doesn't have embedding

        DatabaseFace {
            id: face.id,
            image_path: "".to_string(), // Will be set when storing
            bounds: bounds_json,
            embedding: embedding_bytes,
            confidence: face.confidence,
            quality_score: 1.0, // Default quality
            landmarks: landmarks_json,
            created_at: chrono::Utc::now(),
        }
    }
}

impl From<PersonGroup> for DatabasePerson {
    fn from(person: PersonGroup) -> Self {
        DatabasePerson {
            id: person.id,
            name: person.name,
            face_count: person.face_ids.len(),
            representative_face_id: person.representative_face_id,
            created_at: person.created_at,
        }
    }
}

impl From<DatabasePerson> for PersonGroup {
    fn from(person: DatabasePerson) -> Self {
        PersonGroup {
            id: person.id,
            name: person.name,
            face_ids: Vec::new(), // Would need to be populated from relationships
            representative_face_id: person.representative_face_id,
            confidence: 1.0, // Default confidence
            created_at: person.created_at,
            generation: None,
            is_admin: None,
        }
    }
}
