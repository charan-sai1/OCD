// apps/desktop/src-tauri/src/database_enhanced.rs
// Enhanced database schema with media metadata, albums, and sync support

use anyhow::Result;
use chrono::{DateTime, Utc};
use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use image::DynamicImage;

// ============================================================================
// Data Models
// ============================================================================

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaItem {
    pub id: String,
    pub path: String,
    pub hash: String,                    // SHA-256 for deduplication
    pub perceptual_hash: Option<String>, // Perceptual hash for similarity
    pub media_type: MediaType,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub size_bytes: i64,
    pub created_at: Option<DateTime<Utc>>,  // EXIF creation date
    pub modified_at: DateTime<Utc>,         // File modification date
    pub taken_at: Option<DateTime<Utc>>,    // When photo was taken
    pub timezone: Option<String>,
    pub gps_lat: Option<f64>,
    pub gps_lon: Option<f64>,
    pub device_make: Option<String>,
    pub device_model: Option<String>,
    pub orientation: Option<i32>,
    pub duration: Option<f64>,           // For videos
    pub thumbnail_path: Option<String>,
    pub is_favorite: bool,
    pub is_hidden: bool,
    pub is_deleted: bool,
    pub deleted_at: Option<DateTime<Utc>>,
    pub album_ids: Vec<String>,          // JSON array
    pub person_ids: Vec<String>,         // JSON array
    pub scene_tags: Vec<String>,         // JSON array from AI
    pub object_tags: Vec<String>,        // JSON array from AI
    pub color_dominant: Option<String>,  // Hex color
    pub embedding_clip: Option<Vec<u8>>, // CLIP embedding for semantic search
    pub sync_status: SyncStatus,
    pub device_id: String,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum MediaType {
    Image,
    Video,
    LivePhoto,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum SyncStatus {
    Local,
    Synced,
    PendingUpload,
    PendingDownload,
    Conflict,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Face {
    pub id: String,
    pub media_id: String,
    pub image_path: String,
    pub image_hash: String,
    pub bounds: FaceBounds,
    pub embedding: Vec<u8>,              // Compressed 128D embedding
    pub confidence: f32,
    pub quality_score: f32,
    pub landmarks: Option<FaceLandmarks>,
    pub person_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub device_id: String,
    pub sync_status: SyncStatus,
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
pub struct Person {
    pub id: String,
    pub name: Option<String>,
    pub face_count: i32,
    pub representative_face_id: String,
    pub confidence: f32,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub device_id: String,
    pub sync_status: SyncStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Album {
    pub id: String,
    pub name: String,
    pub album_type: AlbumType,
    pub cover_media_id: Option<String>,
    pub created_at: DateTime<Utc>,
    pub updated_at: DateTime<Utc>,
    pub rules: Option<String>,           // JSON for smart albums
    pub sync_status: SyncStatus,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum AlbumType {
    User,
    Smart,
    Folder,
    Person,
    Recent,
    Favorites,
    Places,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SyncMetadata {
    pub device_id: String,
    pub device_name: String,
    pub device_type: DeviceType,
    pub last_sync_at: Option<DateTime<Utc>>,
    pub sync_token: Option<String>,
    pub capabilities: DeviceCapabilities,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub enum DeviceType {
    Desktop,
    Mobile,
    Server,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct DeviceCapabilities {
    pub can_process_ai: bool,
    pub ai_score: f32,
    pub storage_gb: f64,
    pub cpu_cores: i32,
    pub memory_gb: f64,
    pub has_gpu: bool,
}

// ============================================================================
// Database Implementation
// ============================================================================

pub struct EnhancedDatabase {
    conn: Connection,
    db_path: PathBuf,
}

impl EnhancedDatabase {
    pub fn new(db_path: PathBuf) -> Result<Self> {
        let conn = Connection::open(&db_path)?;
        
        let db = Self { conn, db_path };
        db.initialize_schema()?;
        
        Ok(db)
    }

    fn initialize_schema(&self) -> Result<()> {
        // Media items table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS media_items (
                id TEXT PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                hash TEXT NOT NULL UNIQUE,
                perceptual_hash TEXT,
                media_type TEXT NOT NULL,
                width INTEGER,
                height INTEGER,
                size_bytes INTEGER NOT NULL,
                created_at TEXT,
                modified_at TEXT NOT NULL,
                taken_at TEXT,
                timezone TEXT,
                gps_lat REAL,
                gps_lon REAL,
                device_make TEXT,
                device_model TEXT,
                orientation INTEGER,
                duration REAL,
                thumbnail_path TEXT,
                is_favorite INTEGER DEFAULT 0,
                is_hidden INTEGER DEFAULT 0,
                is_deleted INTEGER DEFAULT 0,
                deleted_at TEXT,
                album_ids TEXT DEFAULT '[]',
                person_ids TEXT DEFAULT '[]',
                scene_tags TEXT DEFAULT '[]',
                object_tags TEXT DEFAULT '[]',
                color_dominant TEXT,
                embedding_clip BLOB,
                sync_status TEXT DEFAULT 'local',
                device_id TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Faces table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS faces (
                id TEXT PRIMARY KEY,
                media_id TEXT NOT NULL,
                image_path TEXT NOT NULL,
                image_hash TEXT NOT NULL,
                bounds TEXT NOT NULL,
                embedding BLOB NOT NULL,
                confidence REAL NOT NULL,
                quality_score REAL NOT NULL,
                landmarks TEXT,
                person_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                sync_status TEXT DEFAULT 'local',
                FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE,
                FOREIGN KEY (person_id) REFERENCES people(id) ON DELETE SET NULL
            )",
            [],
        )?;

        // People table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS people (
                id TEXT PRIMARY KEY,
                name TEXT,
                face_count INTEGER DEFAULT 0,
                representative_face_id TEXT NOT NULL,
                confidence REAL NOT NULL,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                device_id TEXT NOT NULL,
                sync_status TEXT DEFAULT 'local',
                FOREIGN KEY (representative_face_id) REFERENCES faces(id)
            )",
            [],
        )?;

        // Albums table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS albums (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                album_type TEXT NOT NULL,
                cover_media_id TEXT,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL,
                rules TEXT,
                sync_status TEXT DEFAULT 'local',
                FOREIGN KEY (cover_media_id) REFERENCES media_items(id)
            )",
            [],
        )?;

        // Album-Media junction table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS album_media (
                album_id TEXT NOT NULL,
                media_id TEXT NOT NULL,
                added_at TEXT NOT NULL,
                PRIMARY KEY (album_id, media_id),
                FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE CASCADE,
                FOREIGN KEY (media_id) REFERENCES media_items(id) ON DELETE CASCADE
            )",
            [],
        )?;

        // Sync metadata table
        self.conn.execute(
            "CREATE TABLE IF NOT EXISTS sync_metadata (
                device_id TEXT PRIMARY KEY,
                device_name TEXT NOT NULL,
                device_type TEXT NOT NULL,
                last_sync_at TEXT,
                sync_token TEXT,
                capabilities TEXT NOT NULL,
                updated_at TEXT NOT NULL
            )",
            [],
        )?;

        // Create indexes for performance
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_hash ON media_items(hash)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_perceptual_hash ON media_items(perceptual_hash)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_created ON media_items(created_at)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_taken ON media_items(taken_at)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_media_persons ON media_items(person_ids)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_faces_media ON faces(media_id)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_faces_person ON faces(person_id)",
            [],
        )?;
        self.conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_album_type ON albums(album_type)",
            [],
        )?;

        Ok(())
    }

    // ============================================================================
    // Media Item Operations
    // ============================================================================

    pub fn add_media_item(&self, item: &MediaItem) -> Result<()> {
        self.conn.execute(
            "INSERT INTO media_items (
                id, path, hash, perceptual_hash, media_type, width, height, size_bytes,
                created_at, modified_at, taken_at, timezone, gps_lat, gps_lon,
                device_make, device_model, orientation, duration, thumbnail_path,
                is_favorite, is_hidden, is_deleted, deleted_at, album_ids, person_ids,
                scene_tags, object_tags, color_dominant, embedding_clip, sync_status,
                device_id, updated_at
            ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16,
                ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27, ?28, ?29, ?30, ?31, ?32
            )",
            params![
                item.id,
                item.path,
                item.hash,
                item.perceptual_hash,
                serde_json::to_string(&item.media_type)?,
                item.width,
                item.height,
                item.size_bytes,
                item.created_at.map(|d| d.to_rfc3339()),
                item.modified_at.to_rfc3339(),
                item.taken_at.map(|d| d.to_rfc3339()),
                item.timezone,
                item.gps_lat,
                item.gps_lon,
                item.device_make,
                item.device_model,
                item.orientation,
                item.duration,
                item.thumbnail_path,
                item.is_favorite as i32,
                item.is_hidden as i32,
                item.is_deleted as i32,
                item.deleted_at.map(|d| d.to_rfc3339()),
                serde_json::to_string(&item.album_ids)?,
                serde_json::to_string(&item.person_ids)?,
                serde_json::to_string(&item.scene_tags)?,
                serde_json::to_string(&item.object_tags)?,
                item.color_dominant,
                item.embedding_clip.as_ref().map(|e| e.as_slice()),
                serde_json::to_string(&item.sync_status)?,
                item.device_id,
                item.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn get_media_item(&self, id: &str) -> Result<Option<MediaItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM media_items WHERE id = ?1 AND is_deleted = 0"
        )?;
        
        let item = stmt.query_row([id], |row| {
            self.row_to_media_item(row)
        }).optional()?;
        
        Ok(item)
    }

    pub fn get_media_item_by_hash(&self, hash: &str) -> Result<Option<MediaItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM media_items WHERE hash = ?1 AND is_deleted = 0"
        )?;
        
        let item = stmt.query_row([hash], |row| {
            self.row_to_media_item(row)
        }).optional()?;
        
        Ok(item)
    }

    pub fn get_media_items_by_perceptual_hash(&self, perceptual_hash: &str, threshold: f64) -> Result<Vec<MediaItem>> {
        // This is a simplified version - in production, you'd use Hamming distance
        let mut stmt = self.conn.prepare(
            "SELECT * FROM media_items WHERE perceptual_hash = ?1 AND is_deleted = 0"
        )?;
        
        let items: Vec<MediaItem> = stmt.query_map([perceptual_hash], |row| {
            self.row_to_media_item(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(items)
    }

    pub fn update_media_item(&self, item: &MediaItem) -> Result<()> {
        self.conn.execute(
            "UPDATE media_items SET
                path = ?2,
                hash = ?3,
                perceptual_hash = ?4,
                media_type = ?5,
                width = ?6,
                height = ?7,
                size_bytes = ?8,
                created_at = ?9,
                modified_at = ?10,
                taken_at = ?11,
                timezone = ?12,
                gps_lat = ?13,
                gps_lon = ?14,
                device_make = ?15,
                device_model = ?16,
                orientation = ?17,
                duration = ?18,
                thumbnail_path = ?19,
                is_favorite = ?20,
                is_hidden = ?21,
                is_deleted = ?22,
                deleted_at = ?23,
                album_ids = ?24,
                person_ids = ?25,
                scene_tags = ?26,
                object_tags = ?27,
                color_dominant = ?28,
                embedding_clip = ?29,
                sync_status = ?30,
                device_id = ?31,
                updated_at = ?32
            WHERE id = ?1",
            params![
                item.id,
                item.path,
                item.hash,
                item.perceptual_hash,
                serde_json::to_string(&item.media_type)?,
                item.width,
                item.height,
                item.size_bytes,
                item.created_at.map(|d| d.to_rfc3339()),
                item.modified_at.to_rfc3339(),
                item.taken_at.map(|d| d.to_rfc3339()),
                item.timezone,
                item.gps_lat,
                item.gps_lon,
                item.device_make,
                item.device_model,
                item.orientation,
                item.duration,
                item.thumbnail_path,
                item.is_favorite as i32,
                item.is_hidden as i32,
                item.is_deleted as i32,
                item.deleted_at.map(|d| d.to_rfc3339()),
                serde_json::to_string(&item.album_ids)?,
                serde_json::to_string(&item.person_ids)?,
                serde_json::to_string(&item.scene_tags)?,
                serde_json::to_string(&item.object_tags)?,
                item.color_dominant,
                item.embedding_clip.as_ref().map(|e| e.as_slice()),
                serde_json::to_string(&item.sync_status)?,
                item.device_id,
                item.updated_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub fn delete_media_item(&self, id: &str, soft_delete: bool) -> Result<()> {
        if soft_delete {
            self.conn.execute(
                "UPDATE media_items SET is_deleted = 1, deleted_at = ?2, updated_at = ?2 WHERE id = ?1",
                params![id, Utc::now().to_rfc3339()],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM media_items WHERE id = ?1",
                [id],
            )?;
        }
        Ok(())
    }

    // ============================================================================
    // Face Operations
    // ============================================================================

    pub fn add_face(&self, face: &Face) -> Result<()> {
        self.conn.execute(
            "INSERT INTO faces (
                id, media_id, image_path, image_hash, bounds, embedding,
                confidence, quality_score, landmarks, person_id, created_at,
                updated_at, device_id, sync_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
            params![
                face.id,
                face.media_id,
                face.image_path,
                face.image_hash,
                serde_json::to_string(&face.bounds)?,
                face.embedding.as_slice(),
                face.confidence,
                face.quality_score,
                face.landmarks.as_ref().map(|l| serde_json::to_string(l).unwrap()),
                face.person_id,
                face.created_at.to_rfc3339(),
                face.updated_at.to_rfc3339(),
                face.device_id,
                serde_json::to_string(&face.sync_status)?,
            ],
        )?;
        Ok(())
    }

    pub fn get_faces_by_media(&self, media_id: &str) -> Result<Vec<Face>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM faces WHERE media_id = ?1"
        )?;
        
        let faces: Vec<Face> = stmt.query_map([media_id], |row| {
            self.row_to_face(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(faces)
    }

    pub fn get_faces_by_person(&self, person_id: &str) -> Result<Vec<Face>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM faces WHERE person_id = ?1"
        )?;
        
        let faces: Vec<Face> = stmt.query_map([person_id], |row| {
            self.row_to_face(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(faces)
    }

    pub fn get_all_faces(&self) -> Result<Vec<Face>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM faces ORDER BY created_at DESC"
        )?;
        
        let faces: Vec<Face> = stmt.query_map([], |row| {
            self.row_to_face(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(faces)
    }

    pub fn get_face(&self, id: &str) -> Result<Option<Face>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM faces WHERE id = ?1"
        )?;
        
        let face = stmt.query_row([id], |row| {
            self.row_to_face(row)
        }).optional()?;
        
        Ok(face)
    }

    pub fn update_face(&self, face: &Face) -> Result<()> {
        self.conn.execute(
            "UPDATE faces SET
                media_id = ?2,
                image_path = ?3,
                image_hash = ?4,
                bounds = ?5,
                embedding = ?6,
                confidence = ?7,
                quality_score = ?8,
                landmarks = ?9,
                person_id = ?10,
                updated_at = ?11,
                sync_status = ?12
            WHERE id = ?1",
            params![
                face.id,
                face.media_id,
                face.image_path,
                face.image_hash,
                serde_json::to_string(&face.bounds)?,
                face.embedding.as_slice(),
                face.confidence,
                face.quality_score,
                face.landmarks.as_ref().map(|l| serde_json::to_string(l).unwrap()),
                face.person_id,
                face.updated_at.to_rfc3339(),
                serde_json::to_string(&face.sync_status)?,
            ],
        )?;
        Ok(())
    }

    pub fn update_face_person(&self, face_id: &str, person_id: Option<&str>) -> Result<()> {
        self.conn.execute(
            "UPDATE faces SET person_id = ?2, updated_at = ?3 WHERE id = ?1",
            params![face_id, person_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn delete_face(&self, id: &str, soft_delete: bool) -> Result<()> {
        if soft_delete {
            self.conn.execute(
                "UPDATE faces SET updated_at = ?2 WHERE id = ?1",
                params![id, Utc::now().to_rfc3339()],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM faces WHERE id = ?1",
                [id],
            )?;
        }
        Ok(())
    }

    // ============================================================================
    // Person Operations
    // ============================================================================

    pub fn add_person(&self, person: &Person) -> Result<()> {
        self.conn.execute(
            "INSERT INTO people (
                id, name, face_count, representative_face_id, confidence,
                created_at, updated_at, device_id, sync_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                person.id,
                person.name,
                person.face_count,
                person.representative_face_id,
                person.confidence,
                person.created_at.to_rfc3339(),
                person.updated_at.to_rfc3339(),
                person.device_id,
                serde_json::to_string(&person.sync_status)?,
            ],
        )?;
        Ok(())
    }

    pub fn get_person(&self, id: &str) -> Result<Option<Person>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM people WHERE id = ?1"
        )?;
        
        let person = stmt.query_row([id], |row| {
            self.row_to_person(row)
        }).optional()?;
        
        Ok(person)
    }

    pub fn get_all_people(&self) -> Result<Vec<Person>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM people ORDER BY face_count DESC"
        )?;
        
        let people: Vec<Person> = stmt.query_map([], |row| {
            self.row_to_person(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(people)
    }

    pub fn update_person(&self, person: &Person) -> Result<()> {
        self.conn.execute(
            "UPDATE people SET
                name = ?2,
                face_count = ?3,
                representative_face_id = ?4,
                confidence = ?5,
                updated_at = ?6,
                sync_status = ?7
            WHERE id = ?1",
            params![
                person.id,
                person.name,
                person.face_count,
                person.representative_face_id,
                person.confidence,
                person.updated_at.to_rfc3339(),
                serde_json::to_string(&person.sync_status)?,
            ],
        )?;
        Ok(())
    }

    pub fn delete_person(&self, id: &str, soft_delete: bool) -> Result<()> {
        if soft_delete {
            self.conn.execute(
                "UPDATE people SET updated_at = ?2 WHERE id = ?1",
                params![id, Utc::now().to_rfc3339()],
            )?;
        } else {
            self.conn.execute(
                "DELETE FROM people WHERE id = ?1",
                [id],
            )?;
        }
        Ok(())
    }

    // ============================================================================
    // Album Operations
    // ============================================================================

    pub fn add_album(&self, album: &Album) -> Result<()> {
        self.conn.execute(
            "INSERT INTO albums (
                id, name, album_type, cover_media_id, created_at,
                updated_at, rules, sync_status
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                album.id,
                album.name,
                serde_json::to_string(&album.album_type)?,
                album.cover_media_id,
                album.created_at.to_rfc3339(),
                album.updated_at.to_rfc3339(),
                album.rules,
                serde_json::to_string(&album.sync_status)?,
            ],
        )?;
        Ok(())
    }

    pub fn get_album(&self, id: &str) -> Result<Option<Album>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM albums WHERE id = ?1"
        )?;
        
        let album = stmt.query_row([id], |row| {
            self.row_to_album(row)
        }).optional()?;
        
        Ok(album)
    }

    pub fn get_all_albums(&self) -> Result<Vec<Album>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM albums ORDER BY created_at DESC"
        )?;
        
        let albums: Vec<Album> = stmt.query_map([], |row| {
            self.row_to_album(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(albums)
    }

    pub fn add_media_to_album(&self, album_id: &str, media_id: &str) -> Result<()> {
        self.conn.execute(
            "INSERT OR IGNORE INTO album_media (album_id, media_id, added_at) VALUES (?1, ?2, ?3)",
            params![album_id, media_id, Utc::now().to_rfc3339()],
        )?;
        Ok(())
    }

    pub fn get_album_media(&self, album_id: &str) -> Result<Vec<MediaItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT m.* FROM media_items m
             INNER JOIN album_media am ON m.id = am.media_id
             WHERE am.album_id = ?1 AND m.is_deleted = 0
             ORDER BY am.added_at DESC"
        )?;
        
        let items: Vec<MediaItem> = stmt.query_map([album_id], |row| {
            self.row_to_media_item(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(items)
    }

    // ============================================================================
    // Search Operations
    // ============================================================================

    pub fn search_by_tags(&self, tags: &[String]) -> Result<Vec<MediaItem>> {
        // For simplicity, search with a single tag using LIKE
        if tags.is_empty() {
            return Ok(Vec::new());
        }
        
        let sql = "SELECT DISTINCT m.* FROM media_items m
             WHERE (m.scene_tags LIKE '%' || ?1 || '%' OR m.object_tags LIKE '%' || ?1 || '%')
             AND m.is_deleted = 0
             ORDER BY m.taken_at DESC";
        
        let mut stmt = self.conn.prepare(sql)?;
        
        let items: Vec<MediaItem> = stmt.query_map([tags[0].clone()], |row| {
            self.row_to_media_item(row)
        })?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(items)
    }

    pub fn search_by_date_range(&self, start: DateTime<Utc>, end: DateTime<Utc>) -> Result<Vec<MediaItem>> {
        let mut stmt = self.conn.prepare(
            "SELECT * FROM media_items
             WHERE taken_at >= ?1 AND taken_at <= ?2 AND is_deleted = 0
             ORDER BY taken_at DESC"
        )?;
        
        let items: Vec<MediaItem> = stmt.query_map(
            params![start.to_rfc3339(), end.to_rfc3339()],
            |row| self.row_to_media_item(row)
        )?.collect::<Result<Vec<_>, _>>()?;
        
        Ok(items)
    }

    // ============================================================================
    // Helper Methods
    // ============================================================================

    fn row_to_media_item(&self, row: &rusqlite::Row) -> Result<MediaItem, rusqlite::Error> {
        Ok(MediaItem {
            id: row.get(0)?,
            path: row.get(1)?,
            hash: row.get(2)?,
            perceptual_hash: row.get(3)?,
            media_type: serde_json::from_str(&row.get::<_, String>(4)?).unwrap_or(MediaType::Image),
            width: row.get(5)?,
            height: row.get(6)?,
            size_bytes: row.get(7)?,
            created_at: row.get::<_, Option<String>>(8)?.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc))),
            modified_at: row.get::<_, String>(9)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            taken_at: row.get::<_, Option<String>>(10)?.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc))),
            timezone: row.get(11)?,
            gps_lat: row.get(12)?,
            gps_lon: row.get(13)?,
            device_make: row.get(14)?,
            device_model: row.get(15)?,
            orientation: row.get(16)?,
            duration: row.get(17)?,
            thumbnail_path: row.get(18)?,
            is_favorite: row.get::<_, i32>(19)? != 0,
            is_hidden: row.get::<_, i32>(20)? != 0,
            is_deleted: row.get::<_, i32>(21)? != 0,
            deleted_at: row.get::<_, Option<String>>(22)?.and_then(|s| DateTime::parse_from_rfc3339(&s).ok().map(|d| d.with_timezone(&Utc))),
            album_ids: serde_json::from_str(&row.get::<_, String>(23)?).unwrap_or_default(),
            person_ids: serde_json::from_str(&row.get::<_, String>(24)?).unwrap_or_default(),
            scene_tags: serde_json::from_str(&row.get::<_, String>(25)?).unwrap_or_default(),
            object_tags: serde_json::from_str(&row.get::<_, String>(26)?).unwrap_or_default(),
            color_dominant: row.get(27)?,
            embedding_clip: row.get(28)?,
            sync_status: serde_json::from_str(&row.get::<_, String>(29)?).unwrap_or(SyncStatus::Local),
            device_id: row.get(30)?,
            updated_at: row.get::<_, String>(31)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
        })
    }

    fn row_to_face(&self, row: &rusqlite::Row) -> Result<Face, rusqlite::Error> {
        Ok(Face {
            id: row.get(0)?,
            media_id: row.get(1)?,
            image_path: row.get(2)?,
            image_hash: row.get(3)?,
            bounds: serde_json::from_str(&row.get::<_, String>(4)?).unwrap(),
            embedding: row.get(5)?,
            confidence: row.get(6)?,
            quality_score: row.get(7)?,
            landmarks: row.get::<_, Option<String>>(8)?.and_then(|s| serde_json::from_str(&s).ok()),
            person_id: row.get(9)?,
            created_at: row.get::<_, String>(10)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            updated_at: row.get::<_, String>(11)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            device_id: row.get(12)?,
            sync_status: serde_json::from_str(&row.get::<_, String>(13)?).unwrap_or(SyncStatus::Local),
        })
    }

    fn row_to_person(&self, row: &rusqlite::Row) -> Result<Person, rusqlite::Error> {
        Ok(Person {
            id: row.get(0)?,
            name: row.get(1)?,
            face_count: row.get(2)?,
            representative_face_id: row.get(3)?,
            confidence: row.get(4)?,
            created_at: row.get::<_, String>(5)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            updated_at: row.get::<_, String>(6)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            device_id: row.get(7)?,
            sync_status: serde_json::from_str(&row.get::<_, String>(8)?).unwrap_or(SyncStatus::Local),
        })
    }

    fn row_to_album(&self, row: &rusqlite::Row) -> Result<Album, rusqlite::Error> {
        Ok(Album {
            id: row.get(0)?,
            name: row.get(1)?,
            album_type: serde_json::from_str(&row.get::<_, String>(2)?).unwrap_or(AlbumType::User),
            cover_media_id: row.get(3)?,
            created_at: row.get::<_, String>(4)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            updated_at: row.get::<_, String>(5)?.parse::<DateTime<Utc>>().unwrap_or_else(|_| Utc::now()),
            rules: row.get(6)?,
            sync_status: serde_json::from_str(&row.get::<_, String>(7)?).unwrap_or(SyncStatus::Local),
        })
    }
}

// ============================================================================
// Utility Functions
// ============================================================================

pub fn generate_id() -> String {
    uuid::Uuid::new_v4().to_string()
}

pub fn calculate_sha256(path: &Path) -> Result<String> {
    use std::io::Read;
    
    let mut file = std::fs::File::open(path)?;
    let mut hasher = blake3::Hasher::new();
    let mut buffer = [0u8; 8192];
    
    loop {
        let bytes_read = file.read(&mut buffer)?;
        if bytes_read == 0 {
            break;
        }
        hasher.update(&buffer[..bytes_read]);
    }
    
    Ok(hasher.finalize().to_hex().to_string())
}

pub fn calculate_perceptual_hash(img: &DynamicImage) -> Result<String> {
    // Simplified perceptual hash using average hash
    // In production, use a more robust algorithm like pHash
    let resized = img.resize_exact(8, 8, image::imageops::FilterType::Lanczos3);
    let gray = resized.to_luma8();
    
    let pixels: Vec<u8> = gray.pixels().map(|p| p[0]).collect();
    let avg = pixels.iter().sum::<u8>() as f32 / pixels.len() as f32;
    
    let mut hash = String::new();
    for pixel in pixels {
        hash.push(if pixel as f32 > avg { '1' } else { '0' });
    }
    
    Ok(hash)
}
