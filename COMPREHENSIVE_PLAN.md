# OCD Cross-Platform Gallery App - Comprehensive Implementation Plan

## 🎯 Vision
Build a privacy-first, cross-platform gallery application for iOS, macOS, iPadOS, Windows, and Android with intelligent local organization and distributed AI processing capabilities.

---

## 📊 Current State Analysis

### ✅ Existing Strengths
- **Tauri Desktop App**: React + TypeScript frontend, Rust backend
- **Face Recognition Pipeline**: Detection → Embedding → Clustering architecture
- **Performance Optimizations**: Web Workers, caching, lazy loading, thumbnail generation
- **Database**: SQLite for face/person data persistence
- **AI Models**: ONNX Runtime integration with YOLOv5 face detection
- **Import System**: Device import with duplicate detection
- **Hardware Detection**: Adaptive processing based on device capabilities

### ⚠️ Current Limitations
1. **Face Detection**: Uses heuristic algorithm (not ML-based yet)
2. **Embedding Extraction**: Mock implementation (random vectors)
3. **Mobile Support**: None - desktop only
4. **Distributed Processing**: No network-based AI offloading
5. **Cross-Platform**: Tauri only supports desktop (Windows, macOS, Linux)
6. **Sync**: No cross-device synchronization

---

## 🏗️ Architecture Strategy

### Multi-Platform Approach

```
┌─────────────────────────────────────────────────────────────┐
│                    SHARED CORE (Rust)                        │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐  │
│  │  Face Rec   │  │   Sync      │  │  Distributed AI     │  │
│  │  Engine     │  │   Engine    │  │  Client/Server      │  │
│  └─────────────┘  └─────────────┘  └─────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
                              │
        ┌─────────────────────┼─────────────────────┐
        ▼                     ▼                     ▼
┌───────────────┐    ┌───────────────┐    ┌───────────────┐
│   DESKTOP     │    │    MOBILE     │    │   SERVER      │
│   (Tauri)     │    │ (React Native)│    │  (Rust/Node)  │
│               │    │               │    │               │
│ • Windows     │    │ • iOS         │    │ • AI Worker   │
│ • macOS       │    │ • Android     │    │ • Sync Node   │
│ • Linux       │    │ • iPadOS      │    │ • Media Proc  │
└───────────────┘    └───────────────┘    └───────────────┘
```

---

## 📋 Phase-by-Phase Implementation Plan

### Phase 1: Foundation & Core AI (Weeks 1-4)

#### 1.1 Complete Face Recognition System
**Priority: CRITICAL**

Current: Heuristic-based detection, mock embeddings
Target: Full ML-based pipeline

```rust
// apps/desktop/src-tauri/src/face_detection_ml.rs
pub struct MLFaceDetector {
    yolo_model: OrtSession,
    mtcnn_model: Option<MtcnnSession>,
}

impl MLFaceDetector {
    pub fn new(model_path: &Path) -> Result<Self, FaceError> {
        // Load YOLOv5s-face model
        let yolo = Session::builder()?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .commit_from_file(model_path.join("yolov5s-face.onnx"))?;
            
        Ok(Self { yolo_model: yolo, mtcnn_model: None })
    }
    
    pub fn detect(&self, image: &DynamicImage) -> Result<Vec<Face>, FaceError> {
        // Preprocess: Resize to 640x640
        let input = self.preprocess(image);
        
        // Run YOLO inference
        let outputs = self.yolo_model.run(inputs!["images" => input])?;
        
        // Post-process: NMS, confidence filtering
        let faces = self.postprocess(outputs);
        
        Ok(faces)
    }
}
```

**Tasks:**
- [ ] Integrate real YOLOv5s-face ONNX model for detection
- [ ] Implement MobileFaceNet for 128D embedding extraction
- [ ] Add face quality assessment (blur, brightness, angle)
- [ ] Optimize for different hardware (CPU/GPU)
- [ ] Add face alignment using 5-point landmarks

#### 1.2 Database Schema Enhancement
**Priority: HIGH**

```sql
-- Enhanced schema for cross-platform sync
CREATE TABLE faces (
    id TEXT PRIMARY KEY,
    image_path TEXT NOT NULL,
    image_hash TEXT NOT NULL,  -- For deduplication
    bounds TEXT NOT NULL,
    embedding BLOB,              -- 128D float32 array
    confidence REAL NOT NULL,
    quality_score REAL NOT NULL,
    landmarks TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    device_id TEXT,             -- For sync
    sync_status TEXT DEFAULT 'local' -- 'local', 'synced', 'pending'
);

CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT,
    face_count INTEGER NOT NULL,
    representative_face_id TEXT NOT NULL,
    confidence REAL NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    device_id TEXT,
    sync_status TEXT DEFAULT 'local'
);

-- New: Media metadata for intelligent organization
CREATE TABLE media_items (
    id TEXT PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    hash TEXT NOT NULL UNIQUE,  -- SHA-256 for deduplication
    type TEXT NOT NULL,         -- 'image', 'video', 'live_photo'
    width INTEGER,
    height INTEGER,
    size_bytes INTEGER,
    created_at TEXT,            -- EXIF creation date
    modified_at TEXT,
    taken_at TEXT,              -- When photo was taken
    timezone TEXT,
    gps_lat REAL,
    gps_lon REAL,
    device_make TEXT,
    device_model TEXT,
    orientation INTEGER,
    duration REAL,              -- For videos
    thumbnail_path TEXT,
    is_favorite BOOLEAN DEFAULT 0,
    is_hidden BOOLEAN DEFAULT 0,
    is_deleted BOOLEAN DEFAULT 0,
    deleted_at TEXT,
    album_ids TEXT,             -- JSON array
    person_ids TEXT,            -- JSON array
    scene_tags TEXT,            -- JSON array from AI
    object_tags TEXT,           -- JSON array from AI
    color_dominant TEXT,        -- Hex color
    embedding_clip BLOB,        -- CLIP embedding for semantic search
    sync_status TEXT DEFAULT 'local',
    device_id TEXT
);

-- New: Albums
CREATE TABLE albums (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    type TEXT,                  -- 'user', 'smart', 'folder', 'person'
    cover_image_id TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    rules TEXT,                 -- JSON for smart albums
    sync_status TEXT DEFAULT 'local'
);

-- New: Sync metadata
CREATE TABLE sync_metadata (
    device_id TEXT PRIMARY KEY,
    device_name TEXT NOT NULL,
    device_type TEXT,           -- 'desktop', 'mobile', 'server'
    last_sync_at TEXT,
    sync_token TEXT,            -- For incremental sync
    capabilities TEXT           -- JSON: {can_process_ai, storage_gb, etc}
);
```

**Tasks:**
- [ ] Migrate existing database schema
- [ ] Add media metadata extraction (EXIF, XMP)
- [ ] Implement content-based deduplication (perceptual hashing)
- [ ] Add CLIP embeddings for semantic search
- [ ] Create album management system

#### 1.3 Intelligent Organization Engine
**Priority: HIGH**

```typescript
// packages/core/src/organization/IntelligentOrganizer.ts
export class IntelligentOrganizer {
  constructor(
    private mediaDB: MediaDatabase,
    private faceEngine: FaceRecognitionEngine,
    private sceneClassifier: SceneClassifier,
    private objectDetector: ObjectDetector
  ) {}

  async organizeMedia(mediaId: string): Promise<OrganizationResult> {
    const media = await this.mediaDB.getMedia(mediaId);
    
    // Parallel analysis
    const [faces, scenes, objects, colors] = await Promise.all([
      this.faceEngine.detectFaces(media.path),
      this.sceneClassifier.classify(media.path),
      this.objectDetector.detect(media.path),
      this.extractDominantColors(media.path)
    ]);

    // Generate smart tags
    const tags = this.generateSmartTags({ faces, scenes, objects, colors });
    
    // Suggest albums
    const albumSuggestions = await this.suggestAlbums(media, tags);
    
    // Update database
    await this.mediaDB.updateMetadata(mediaId, {
      personIds: faces.map(f => f.personId),
      sceneTags: scenes,
      objectTags: objects,
      colorDominant: colors[0],
      embeddingClip: await this.generateClipEmbedding(media.path)
    });

    return { tags, albumSuggestions };
  }

  private generateSmartTags(analysis: AnalysisResult): string[] {
    const tags: string[] = [];
    
    // Time-based tags
    const hour = new Date(analysis.media.takenAt).getHours();
    if (hour < 6) tags.push('night', 'late');
    else if (hour < 12) tags.push('morning');
    else if (hour < 18) tags.push('afternoon');
    else tags.push('evening', 'sunset');
    
    // Season tags
    const month = new Date(analysis.media.takenAt).getMonth();
    if (month >= 2 && month <= 4) tags.push('spring');
    else if (month >= 5 && month <= 7) tags.push('summer');
    else if (month >= 8 && month <= 10) tags.push('fall');
    else tags.push('winter');
    
    // Content tags
    if (analysis.faces.length > 0) tags.push('people', `people:${analysis.faces.length}`);
    if (analysis.scenes.includes('beach')) tags.push('beach', 'vacation');
    if (analysis.scenes.includes('mountain')) tags.push('mountain', 'nature');
    if (analysis.objects.includes('dog')) tags.push('pets', 'dog');
    if (analysis.objects.includes('cat')) tags.push('pets', 'cat');
    
    // Quality tags
    if (analysis.media.isBlurred) tags.push('blurry');
    if (analysis.media.isDark) tags.push('dark');
    if (analysis.media.isScreenshot) tags.push('screenshot');
    
    return tags;
  }
}
```

**Tasks:**
- [ ] Implement scene classification (beach, mountain, city, etc.)
- [ ] Add object detection (pets, vehicles, food, documents)
- [ ] Create smart album suggestions (Recent, Favorites, People, Places)
- [ ] Build duplicate detection system
- [ ] Add semantic search using CLIP embeddings

---

### Phase 2: Mobile Platform (Weeks 5-10)

#### 2.1 React Native Foundation
**Priority: CRITICAL**

```
apps/
├── desktop/          # Existing Tauri app
└── mobile/           # NEW: React Native app
    ├── ios/          # iOS native modules
    ├── android/      # Android native modules
    ├── src/
    │   ├── components/   # Shared UI components
    │   ├── screens/      # Screen components
    │   ├── navigation/   # React Navigation setup
    │   ├── hooks/        # Shared hooks
    │   ├── services/     # API services
    │   └── utils/        # Utilities
    ├── package.json
    └── metro.config.js
```

**Tasks:**
- [ ] Initialize React Native project with TypeScript
- [ ] Set up React Navigation (bottom tabs + stack)
- [ ] Configure Metro bundler for monorepo
- [ ] Set up shared package imports
- [ ] Create platform-specific native modules for Rust integration

#### 2.2 Rust Core for Mobile
**Priority: CRITICAL**

```rust
// packages/rust-mobile/src/lib.rs
use jni::JNIEnv;
use jni::objects::JString;
use jni::signature::JavaType;
use std::ffi::CStr;

// Android JNI bindings
#[no_mangle]
pub extern "C" fn Java_com_ocd_rust_FaceRecognition_detectFaces(
    env: &mut JNIEnv,
    _class: jni::objects::JClass,
    image_path: JString,
) -> jni::sys::jstring {
    let path: String = env.get_string(&image_path).unwrap().into();
    
    let detector = FaceDetector::new();
    let faces = detector.detect(&path).unwrap();
    
    let json = serde_json::to_string(&faces).unwrap();
    env.new_string(json).unwrap().into_raw()
}

// iOS FFI bindings
#[no_mangle]
pub extern "C" fn ocd_detect_faces(image_path: *const c_char) -> *const c_char {
    let path = unsafe { CStr::from_ptr(image_path).to_string_lossy() };
    
    let detector = FaceDetector::new();
    let faces = detector.detect(&path).unwrap();
    
    let json = serde_json::to_string(&faces).unwrap();
    CString::new(json).unwrap().into_raw()
}
```

**Tasks:**
- [ ] Set up UniFFI for cross-platform Rust bindings
- [ ] Create Android JNI wrapper
- [ ] Create iOS FFI wrapper
- [ ] Build React Native modules for both platforms
- [ ] Optimize Rust code for mobile (ARM NEON, smaller models)

#### 2.3 Mobile UI/UX
**Priority: HIGH**

**Screen Structure:**
```
├── Tabs
│   ├── Photos (grid view)
│   ├── Albums (collection view)
│   ├── Search (semantic search)
│   └── Settings
├── Screens
│   ├── PhotoDetail (fullscreen viewer)
│   ├── AlbumDetail
│   ├── PersonDetail (face grouping)
│   ├── Import (device import)
│   ├── SearchResults
│   └── Settings
│       ├── Storage
│       ├── Privacy
│       ├── AI Processing
│       └── Sync
```

**Key Features:**
- [ ] Native photo grid with momentum scrolling
- [ ] Pinch-to-zoom image viewer
- [ ] Swipe gestures for navigation
- [ ] Native share sheet integration
- [ ] iOS Live Photos support
- [ ] Android Motion Photos support
- [ ] Background upload/download
- [ ] Offline mode support

#### 2.4 Mobile-Specific Optimizations
**Priority: MEDIUM**

```typescript
// apps/mobile/src/utils/MobileOptimizer.ts
export class MobileOptimizer {
  // Adaptive quality based on device
  static getThumbnailSize(): number {
    const { width } = Dimensions.get('window');
    if (width <= 375) return 150;  // Small phones
    if (width <= 414) return 200;  // Large phones
    return 300;                     // Tablets
  }

  // Battery-aware processing
  static async shouldProcessAI(): Promise<boolean> {
    const battery = await Battery.getLevel();
    const isCharging = await Battery.isCharging();
    
    // Only process if charging or >50% battery
    return isCharging || battery > 0.5;
  }

  // Thermal throttling
  static async getProcessingMode(): Promise<ProcessingMode> {
    const thermalState = await DeviceInfo.getThermalState();
    
    switch (thermalState) {
      case 'serious':
      case 'critical':
        return ProcessingMode.Fast; // Minimal processing
      case 'fair':
        return ProcessingMode.Balanced;
      default:
        return ProcessingMode.HighAccuracy;
    }
  }

  // Storage management
  static async optimizeStorage(): Promise<void> {
    const freeSpace = await RNFS.getFSInfo();
    const cacheSize = await this.calculateCacheSize();
    
    if (freeSpace < 2 * 1024 * 1024 * 1024) { // < 2GB free
      // Clear old thumbnails
      await ThumbnailCache.clearOld(7); // 7 days
    }
    
    if (freeSpace < 1 * 1024 * 1024 * 1024) { // < 1GB free
      // Clear all thumbnails, keep only metadata
      await ThumbnailCache.clear();
    }
  }
}
```

---

### Phase 3: Distributed AI Processing (Weeks 11-14)

#### 3.1 Network Protocol Design
**Priority: CRITICAL**

```protobuf
// proto/distributed_ai.proto
syntax = "proto3";

package ocd.distributed;

// Service discovery
message DeviceInfo {
  string device_id = 1;
  string device_name = 2;
  DeviceType type = 3;
  DeviceCapabilities capabilities = 4;
  string ip_address = 5;
  int32 port = 6;
}

enum DeviceType {
  DESKTOP = 0;
  MOBILE = 1;
  SERVER = 2;
}

message DeviceCapabilities {
  int32 cpu_cores = 1;
  int64 memory_bytes = 2;
  bool has_gpu = 3;
  string gpu_model = 4;
  bool can_process_ai = 5;
  float ai_score = 6;  // Benchmark score
}

// Task distribution
message ProcessingTask {
  string task_id = 1;
  TaskType type = 2;
  bytes image_data = 3;  // Or reference
  string image_hash = 4;
  ProcessingMode mode = 5;
  int32 priority = 6;
}

enum TaskType {
  FACE_DETECTION = 0;
  FACE_EMBEDDING = 1;
  SCENE_CLASSIFICATION = 2;
  OBJECT_DETECTION = 3;
  CLIP_EMBEDDING = 4;
}

message ProcessingResult {
  string task_id = 1;
  bool success = 2;
  bytes result_data = 3;
  string error_message = 4;
  int32 processing_time_ms = 5;
}

// Service definition
service DistributedAI {
  rpc DiscoverDevices(Empty) returns (stream DeviceInfo);
  rpc SubmitTask(ProcessingTask) returns (TaskAccepted);
  rpc GetResult(TaskId) returns (ProcessingResult);
  rpc StreamResults(stream TaskId) returns (stream ProcessingResult);
  rpc HealthCheck(Empty) returns (HealthStatus);
}
```

#### 3.2 Local Network Discovery
**Priority: HIGH**

```rust
// packages/rust-service/src/network/discovery.rs
pub struct DeviceDiscovery {
    mdns: ServiceDaemon,
    known_devices: Arc<RwLock<HashMap<String, DeviceInfo>>>,
}

impl DeviceDiscovery {
    pub fn new() -> Result<Self, DiscoveryError> {
        let mdns = ServiceDaemon::new()?;
        Ok(Self { mdns, known_devices: Arc::new(RwLock::new(HashMap::new())) })
    }

    pub async fn start_discovery(&self) -> Result<(), DiscoveryError> {
        // Register self
        let my_info = self.get_my_info();
        self.register_service(&my_info).await?;
        
        // Browse for other OCD devices
        let receiver = self.mdns.browse("_ocd._tcp")?;
        
        tokio::spawn(async move {
            while let Ok(event) = receiver.recv().await {
                match event {
                    ServiceEvent::ServiceResolved(info) => {
                        self.handle_discovered_device(info).await;
                    }
                    ServiceEvent::ServiceRemoved(name) => {
                        self.handle_device_removed(name).await;
                    }
                    _ => {}
                }
            }
        });
        
        Ok(())
    }

    async fn handle_discovered_device(&self, info: ServiceInfo) {
        let device = DeviceInfo::from_mdns(&info);
        
        // Check if device can help with AI
        if device.capabilities.can_process_ai {
            let mut devices = self.known_devices.write().await;
            devices.insert(device.device_id.clone(), device);
            
            // Notify UI
            self.emit_event(DiscoveryEvent::DeviceFound(device));
        }
    }
}
```

#### 3.3 Task Distribution Engine
**Priority: HIGH**

```rust
// packages/rust-service/src/network/task_distributor.rs
pub struct TaskDistributor {
    devices: Arc<RwLock<Vec<RemoteDevice>>>,
    task_queue: Arc<RwLock<VecDeque<ProcessingTask>>>,
    results: Arc<RwLock<HashMap<String, ProcessingResult>>>,
}

impl TaskDistributor {
    pub async fn distribute_task(&self, task: ProcessingTask) -> Result<String, DistributionError> {
        // Find best device for this task
        let device = self.select_optimal_device(&task).await?;
        
        if device.is_local() {
            // Process locally
            self.process_locally(task).await
        } else {
            // Send to remote device
            self.send_to_remote(device, task).await
        }
    }

    async fn select_optimal_device(&self, task: &ProcessingTask) -> Result<RemoteDevice, DistributionError> {
        let devices = self.devices.read().await;
        
        // Score each device
        let scored: Vec<(f32, &RemoteDevice)> = devices
            .iter()
            .filter(|d| d.is_available() && d.can_handle(&task.type))
            .map(|d| {
                let score = self.calculate_score(d, task);
                (score, d)
            })
            .collect();
        
        // Pick highest score
        scored.into_iter()
            .max_by(|a, b| a.0.partial_cmp(&b.0).unwrap())
            .map(|(_, d)| d.clone())
            .ok_or(DistributionError::NoAvailableDevices)
    }

    fn calculate_score(&self, device: &RemoteDevice, task: &ProcessingTask) -> f32 {
        let mut score = 0.0;
        
        // AI capability weight: 40%
        score += device.capabilities.ai_score * 0.4;
        
        // Network latency weight: 30%
        let latency_score = 1.0 - (device.latency_ms as f32 / 1000.0).min(1.0);
        score += latency_score * 0.3;
        
        // Load weight: 20%
        let load_score = 1.0 - device.current_load;
        score += load_score * 0.2;
        
        // Battery weight: 10% (prefer plugged-in devices)
        if device.is_charging {
            score += 0.1;
        } else {
            score += (device.battery_level / 100.0) * 0.1;
        }
        
        score
    }
}
```

#### 3.4 Security & Privacy
**Priority: CRITICAL**

```rust
// packages/rust-service/src/network/security.rs
pub struct SecureChannel {
    local_key: X25519SecretKey,
    remote_key: Option<X25519PublicKey>,
    cipher: Option<Aes256Gcm>,
}

impl SecureChannel {
    pub fn new() -> Self {
        let local_key = X25519SecretKey::new(&mut OsRng);
        Self { local_key, remote_key: None, cipher: None }
    }

    pub async fn handshake(&mut self, device: &RemoteDevice) -> Result<(), SecurityError> {
        // Perform X25519 key exchange
        let public_key = self.local_key.public_key();
        
        // Send public key to remote
        let response = device.send_public_key(&public_key).await?;
        
        // Derive shared secret
        let shared_secret = self.local_key.diffie_hellman(&response.public_key);
        
        // Use HKDF to derive encryption keys
        let hkdf = Hkdf::<Sha256>::new(None, shared_secret.as_bytes());
        let mut keys = [0u8; 64];
        hkdf.expand(b"ocd-v1", &mut keys).map_err(|_| SecurityError::KeyDerivationFailed)?;
        
        // Initialize AES-GCM
        let cipher = Aes256Gcm::new_from_slice(&keys[..32])
            .map_err(|_| SecurityError::CipherInitFailed)?;
        
        self.remote_key = Some(response.public_key);
        self.cipher = Some(cipher);
        
        Ok(())
    }

    pub fn encrypt(&self, data: &[u8]) -> Result<Vec<u8>, SecurityError> {
        let cipher = self.cipher.as_ref().ok_or(SecurityError::NotInitialized)?;
        
        let nonce = Nonce::from_slice(&[0u8; 12]); // Use proper nonce generation
        let ciphertext = cipher.encrypt(nonce, data)
            .map_err(|_| SecurityError::EncryptionFailed)?;
        
        Ok(ciphertext)
    }

    pub fn decrypt(&self, data: &[u8]) -> Result<Vec<u8>, SecurityError> {
        let cipher = self.cipher.as_ref().ok_or(SecurityError::NotInitialized)?;
        
        let nonce = Nonce::from_slice(&[0u8; 12]);
        let plaintext = cipher.decrypt(nonce, data)
            .map_err(|_| SecurityError::DecryptionFailed)?;
        
        Ok(plaintext)
    }
}
```

**Security Features:**
- [ ] mTLS for all device-to-device communication
- [ ] End-to-end encryption for image data
- [ ] Local network only (no cloud)
- [ ] Device pairing with QR codes
- [ ] Certificate pinning
- [ ] Automatic key rotation

---

### Phase 4: Cross-Device Sync (Weeks 15-18)

#### 4.1 Sync Engine
**Priority: HIGH**

```rust
// packages/rust-service/src/sync/engine.rs
pub struct SyncEngine {
    local_db: Arc<Database>,
    remote_devices: Arc<RwLock<Vec<RemoteDevice>>>,
    conflict_resolver: ConflictResolver,
}

impl SyncEngine {
    pub async fn sync(&self) -> Result<SyncResult, SyncError> {
        let mut results = Vec::new();
        
        for device in self.remote_devices.read().await.iter() {
            if !device.is_available() {
                continue;
            }
            
            // 1. Exchange sync tokens
            let remote_token = device.get_sync_token().await?;
            let local_token = self.local_db.get_sync_token().await?;
            
            // 2. Get changes since last sync
            let local_changes = self.local_db.get_changes_since(&remote_token).await?;
            let remote_changes = device.get_changes_since(&local_token).await?;
            
            // 3. Resolve conflicts
            let (to_apply_local, to_apply_remote) = self.conflict_resolver.resolve(
                &local_changes,
                &remote_changes
            );
            
            // 4. Apply remote changes locally
            for change in to_apply_local {
                self.apply_change(&change).await?;
            }
            
            // 5. Send local changes to remote
            device.apply_changes(&to_apply_remote).await?;
            
            // 6. Update sync tokens
            let new_token = generate_sync_token();
            self.local_db.update_sync_token(&new_token).await?;
            device.update_sync_token(&new_token).await?;
            
            results.push(SyncDeviceResult {
                device_id: device.id.clone(),
                uploaded: to_apply_remote.len(),
                downloaded: to_apply_local.len(),
                conflicts: to_apply_local.iter().filter(|c| c.is_conflict).count(),
            });
        }
        
        Ok(SyncResult { devices: results })
    }

    async fn apply_change(&self, change: &Change) -> Result<(), SyncError> {
        match change.change_type {
            ChangeType::Create => {
                self.local_db.insert(&change.table, &change.data).await?;
            }
            ChangeType::Update => {
                self.local_db.update(&change.table, &change.id, &change.data).await?;
            }
            ChangeType::Delete => {
                self.local_db.soft_delete(&change.table, &change.id).await?;
            }
            ChangeType::MediaUpload => {
                // Download media file from remote
                self.download_media(&change.media_hash).await?;
            }
        }
        Ok(())
    }
}
```

#### 4.2 Conflict Resolution
**Priority: MEDIUM**

```rust
// packages/rust-service/src/sync/conflict_resolver.rs
pub struct ConflictResolver;

impl ConflictResolver {
    pub fn resolve(
        &self,
        local_changes: &[Change],
        remote_changes: &[Change]
    ) -> (Vec<Change>, Vec<Change>) {
        let mut to_apply_local = Vec::new();
        let mut to_apply_remote = Vec::new();
        
        // Index by ID for O(1) lookup
        let local_index: HashMap<_, _> = local_changes.iter()
            .map(|c| ((c.table.clone(), c.id.clone()), c))
            .collect();
        
        let remote_index: HashMap<_, _> = remote_changes.iter()
            .map(|c| ((c.table.clone(), c.id.clone()), c))
            .collect();
        
        // Find conflicts
        let all_ids: HashSet<_> = local_index.keys()
            .chain(remote_index.keys())
            .cloned()
            .collect();
        
        for id in all_ids {
            match (local_index.get(&id), remote_index.get(&id)) {
                (Some(local), None) => {
                    // Only local changed, push to remote
                    to_apply_remote.push(local.clone());
                }
                (None, Some(remote)) => {
                    // Only remote changed, apply locally
                    to_apply_local.push(remote.clone());
                }
                (Some(local), Some(remote)) => {
                    // Conflict! Resolve based on rules
                    let resolved = self.resolve_conflict(local, remote);
                    to_apply_local.push(resolved.remote_version);
                    to_apply_remote.push(resolved.local_version);
                }
                (None, None) => unreachable!(),
            }
        }
        
        (to_apply_local, to_apply_remote)
    }

    fn resolve_conflict(&self, local: &Change, remote: &Change) -> ConflictResolution {
        // Last-write-wins based on timestamp
        if local.timestamp > remote.timestamp {
            ConflictResolution {
                local_version: local.clone(),
                remote_version: local.clone(), // Remote should accept local
            }
        } else {
            ConflictResolution {
                local_version: remote.clone(), // Local should accept remote
                remote_version: remote.clone(),
            }
        }
    }
}
```

---

### Phase 5: Advanced Features (Weeks 19-22)

#### 5.1 Semantic Search
**Priority: HIGH**

```typescript
// packages/core/src/search/SemanticSearch.ts
export class SemanticSearch {
  constructor(
    private clipModel: CLIPModel,
    private vectorDB: VectorDatabase
  ) {}

  async indexMedia(mediaId: string, imagePath: string): Promise<void> {
    // Generate CLIP embedding
    const embedding = await this.clipModel.encodeImage(imagePath);
    
    // Store in vector database
    await this.vectorDB.upsert({
      id: mediaId,
      vector: embedding,
      metadata: { type: 'image', path: imagePath }
    });
  }

  async search(query: string, options: SearchOptions): Promise<SearchResult[]> {
    // Encode text query
    const textEmbedding = await this.clipModel.encodeText(query);
    
    // Search vector database
    const results = await this.vectorDB.search({
      vector: textEmbedding,
      topK: options.limit || 50,
      filter: options.filter
    });
    
    // Rerank based on additional signals
    const reranked = await this.rerank(results, query);
    
    return reranked;
  }

  async searchByImage(imagePath: string): Promise<SearchResult[]> {
    // Visual similarity search
    const imageEmbedding = await this.clipModel.encodeImage(imagePath);
    
    return this.vectorDB.search({
      vector: imageEmbedding,
      topK: 50
    });
  }
}
```

#### 5.2 Smart Albums
**Priority: MEDIUM**

```typescript
// packages/core/src/albums/SmartAlbums.ts
export class SmartAlbumEngine {
  private rules: Map<string, SmartAlbumRule>;

  async evaluateAll(mediaId: string): Promise<string[]> {
    const media = await this.getMedia(mediaId);
    const matchingAlbums: string[] = [];

    for (const [albumId, rule] of this.rules) {
      if (this.matchesRule(media, rule)) {
        matchingAlbums.push(albumId);
      }
    }

    return matchingAlbums;
  }

  private matchesRule(media: MediaItem, rule: SmartAlbumRule): boolean {
    switch (rule.type) {
      case 'date_range':
        return media.takenAt >= rule.start && media.takenAt <= rule.end;
      
      case 'person':
        return media.personIds?.includes(rule.personId);
      
      case 'location':
        return this.isWithinRadius(media.gps, rule.center, rule.radiusKm);
      
      case 'tag':
        return media.tags?.some(tag => rule.tags.includes(tag));
      
      case 'camera':
        return media.deviceMake === rule.make && media.deviceModel === rule.model;
      
      case 'quality':
        return media.qualityScore >= rule.minQuality;
      
      case 'content':
        // AI-detected content
        return media.sceneTags?.some(tag => rule.scenes.includes(tag)) ||
               media.objectTags?.some(tag => rule.objects.includes(tag));
      
      default:
        return false;
    }
  }
}
```

#### 5.3 Video Processing
**Priority: MEDIUM**

```rust
// packages/rust-service/src/video/processor.rs
pub struct VideoProcessor {
    ffmpeg: FFmpeg,
    scene_detector: SceneDetector,
}

impl VideoProcessor {
    pub async fn process(&self, path: &Path) -> Result<VideoMetadata, VideoError> {
        // Extract metadata
        let metadata = self.ffmpeg.probe(path).await?;
        
        // Generate thumbnails at key frames
        let keyframes = self.detect_keyframes(path).await?;
        let thumbnails = self.generate_thumbnails(path, &keyframes).await?;
        
        // Extract scenes for chapter detection
        let scenes = self.scene_detector.detect(path).await?;
        
        // Generate preview video (low-res)
        let preview = self.generate_preview(path).await?;
        
        Ok(VideoMetadata {
            duration: metadata.duration,
            resolution: (metadata.width, metadata.height),
            fps: metadata.fps,
            codec: metadata.codec,
            thumbnails,
            scenes,
            preview_path: preview,
        })
    }

    pub async fn extract_faces(&self, path: &Path) -> Result<Vec<FaceExtraction>, VideoError> {
        // Sample frames every N seconds
        let frames = self.sample_frames(path, 1.0).await?;
        
        let mut all_faces = Vec::new();
        
        for (timestamp, frame_path) in frames {
            let faces = self.face_detector.detect(&frame_path).await?;
            
            for face in faces {
                all_faces.push(FaceExtraction {
                    face,
                    timestamp,
                    frame_path: frame_path.clone(),
                });
            }
        }
        
        // Track faces across frames
        let tracked = self.track_faces(all_faces).await?;
        
        Ok(tracked)
    }
}
```

---

### Phase 6: Polish & Release (Weeks 23-26)

#### 6.1 Performance Optimization
**Priority: HIGH**

- [ ] Implement progressive JPEG loading
- [ ] Add memory-mapped file I/O for large libraries
- [ ] Optimize SQLite queries with proper indexing
- [ ] Implement connection pooling
- [ ] Add request coalescing for duplicate operations
- [ ] Implement predictive caching based on user behavior

#### 6.2 Testing & QA
**Priority: CRITICAL**

- [ ] Unit tests for all Rust modules (>80% coverage)
- [ ] Integration tests for sync engine
- [ ] End-to-end tests for critical user flows
- [ ] Performance benchmarks (target: <100ms for 10k photos)
- [ ] Memory leak detection
- [ ] Battery drain testing on mobile
- [ ] Network resilience testing

#### 6.3 Documentation
**Priority: MEDIUM**

- [ ] API documentation for all public interfaces
- [ ] Architecture decision records (ADRs)
- [ ] User guides for each platform
- [ ] Troubleshooting guides
- [ ] Privacy and security whitepaper

---

## 🛠️ Technology Stack Summary

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Desktop** | Tauri (Rust + React) | Windows, macOS, Linux |
| **Mobile** | React Native + Rust | iOS, Android |
| **Shared Core** | Rust | Face rec, sync, distributed AI |
| **AI/ML** | ONNX Runtime | Model inference |
| **Database** | SQLite + rusqlite | Local data storage |
| **Vector Search** | SQLite-vss or HNSW | Semantic search |
| **Networking** | gRPC + mDNS | Device discovery & communication |
| **Crypto** | ring, rustls | Encryption & security |
| **Sync** | CRDT + custom | Conflict-free sync |

---

## 📱 Platform-Specific Considerations

### iOS
- Use PhotoKit for native photo access
- Background processing with BGTaskScheduler
- iCloud backup exclusion for privacy
- Face ID/Touch ID for app lock

### Android
- MediaStore API for photo access
- WorkManager for background tasks
- Scoped storage compliance
- Biometric authentication

### macOS
- PhotoKit integration (same as iOS)
- Menu bar quick access
- Spotlight integration
- Touch Bar support

### Windows
- WinRT APIs for media
- Windows Hello authentication
- Live Tiles (if applicable)
- Shell integration

---

## 🔒 Privacy & Security Checklist

- [ ] All processing on-device by default
- [ ] End-to
