# OCD (Organized Content Desktop) - Project Documentation

## 🎯 Project Overview

**OCD** is a sophisticated desktop photo management application built with **Tauri** (Rust + TypeScript/React). It features AI-powered facial recognition, intelligent image organization, and high-performance image gallery optimization.

### Core Capabilities
- **Photo Management**: Browse, organize, and view photos with date-based grouping
- **Facial Recognition**: AI-powered face detection, embedding extraction, and person clustering
- **Device Import**: Import photos from external devices (USB drives, cameras, phones)
- **Performance Optimization**: Advanced caching, lazy loading, and thumbnail generation
- **Cross-Platform**: Built with Tauri for desktop (Windows, macOS, Linux)

---

## 🏗️ Architecture

### Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript | UI components and state management |
| **Backend** | Rust (Tauri) | System operations, file I/O, AI inference |
| **UI Framework** | Material-UI (MUI) v5 | Component library and theming |
| **Database** | SQLite (via rusqlite) | Face and person data persistence |
| **AI/ML** | ONNX Runtime | Face detection and embedding models |
| **Build Tool** | Vite | Fast development and production builds |

### Project Structure

```
/Volumes/General/OCD/
├── Cargo.toml                    # Workspace configuration
├── apps/
│   └── desktop/                  # Main Tauri desktop application
│       ├── src/
│       │   ├── App.tsx          # Main application component
│       │   ├── main.tsx         # React entry point
│       │   ├── theme.ts         # MUI theme configuration
│       │   ├── components/      # React components
│       │   ├── hooks/           # Custom React hooks
│       │   ├── utils/           # Utility functions
│       │   ├── workers/         # Web Workers
│       │   └── styles/          # CSS styles
│       ├── src-tauri/           # Rust backend code
│       │   ├── src/
│       │   │   ├── main.rs      # Tauri commands and main entry
│       │   │   ├── face_recognition.rs  # Face recognition service
│       │   │   ├── sqlite_db.rs         # SQLite database
│       │   │   └── tests.rs             # Rust tests
│       │   ├── models/          # AI models (ONNX)
│       │   └── Cargo.toml       # Rust dependencies
│       └── package.json         # Node dependencies
├── packages/
│   ├── core/                    # Shared TypeScript types and services
│   ├── ui/                      # Shared UI components
│   └── rust-service/            # Shared Rust library
└── shared-backend/              # Cross-platform backend logic
    ├── core/                    # Platform-agnostic AI logic
    ├── platforms/tauri/         # Tauri-specific implementations
    └── models/                  # AI models
```

---

## 📦 Key Components

### 1. Frontend (React + TypeScript)

#### Main Application (`App.tsx`)
- **State Management**: React hooks for local state, localStorage for persistence
- **Sections**: Photos, Import, Folders, Devices, Faces
- **Features**:
  - Directory management with folder selection
  - Image loading with progress tracking
  - Sorting (newest/oldest) with file metadata
  - Search functionality (placeholder)
  - Image viewer modal with navigation

#### Photo Organization (`OrganizedPhotoGrid.tsx`)
- **Date-based Grouping**: Images organized by month → day
- **Smart Labels**: "Today", "Yesterday" for recent photos
- **Lazy Loading**: Priority-based image loading (high/normal/low)
- **Responsive Grid**: Flexible layout with 120x120px thumbnails

#### Face Recognition Panel (`FaceRecognitionPanel.tsx`)
- **Processing Modes**: Fast, Balanced, High Accuracy
- **Progress Tracking**: Stepper showing detection → embedding → clustering
- **People Management**: View and edit person names
- **Hardware Detection**: Shows CPU cores, RAM, GPU availability

#### Custom Hooks

**`useFaceRecognition.ts`**
```typescript
// Key features:
- Initialize face recognition system
- Detect faces in images
- Extract face embeddings
- Cluster faces into people
- Track processing status and metrics
- Update person information
```

**`useAnimations.ts`**
- Framer Motion integration
- Smooth transitions and micro-interactions

**`useZoom.ts`**
- Image zoom and pan functionality
- Touch gesture support

### 2. Backend (Rust + Tauri)

#### Main Commands (`main.rs`)
Core Tauri commands organized by functionality:

**File Operations**
- `read_directory`: List directory contents
- `list_images`: List image files in a directory
- `list_files`: Recursive file listing with filtering
- `get_file_info`: File metadata (modified time, size, type)

**Device Management**
- `list_connected_devices`: Detect USB drives, external storage
- `get_device_info`: Storage capacity and usage

**Image Processing**
- `generate_thumbnail`: Create JPEG thumbnails with Lanczos3 filtering
- `extract_exif_thumbnail`: Extract embedded thumbnails from EXIF
- `extract_or_generate_thumbnail`: Smart thumbnail extraction
- `generate_progressive_thumbnails`: Multi-quality thumbnails
- `generate_video_thumbnail`: FFmpeg-based video frame extraction
- `detect_media_type`: Image vs video detection by extension and magic bytes

**Import System**
- `import_files`: Smart file import with duplicate detection
- `get_import_progress`: Real-time import progress tracking
- `cancel_import`: Cancel ongoing import operations

**Face Recognition**
- `initialize_face_recognition`: Initialize the service
- `detect_faces`: Detect faces in images (heuristic-based)
- `extract_embeddings`: Generate 128D face embeddings
- `find_similar_faces`: Find similar faces by embedding comparison
- `cluster_faces`: Group faces into people (DBSCAN algorithm)
- `get_people`: Retrieve all detected people
- `update_person`: Update person name
- `get_processing_status`: Get current processing state
- `set_processing_mode`: Configure processing speed/accuracy
- `process_folder`: Batch process entire folders
- `get_face_statistics`: Get face detection statistics
- `clear_database`: Clear all face data

#### Face Recognition Service (`face_recognition.rs`)

**Architecture**
```rust
pub struct FaceRecognitionService {
    pub database: Arc<SqliteDatabase>,
    capabilities: DeviceCapabilities,
}

// Key structures:
pub struct Face {
    pub id: String,
    pub bounds: FaceBounds,        // x, y, width, height
    pub confidence: f32,           // 0.0 - 1.0
    pub landmarks: Option<FaceLandmarks>,  // 5-point facial landmarks
}

pub struct PersonGroup {
    pub id: String,
    pub name: Option<String>,
    pub face_ids: Vec<String>,
    pub representative_face_id: String,
    pub confidence: f32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}
```

**Processing Modes**
- `Fast`: Quick detection, lower accuracy, best for scanning
- `Balanced`: Good speed/accuracy trade-off
- `HighAccuracy`: Best quality, slower processing

**Face Detection Algorithm** (Current: Heuristic-based)
1. Sample regions that might contain faces (top-left, top-center, top-right)
2. Check aspect ratio (0.5 - 1.5 for face-like regions)
3. Check relative size (1-50% of image area)
4. Generate 5-point facial landmarks (eyes, nose, mouth corners)
5. Fallback: Add default face if none detected (for demo purposes)

**Planned ML Integration**
- YOLOv5 for face detection
- MobileFaceNet/FaceNet/ArcFace for embeddings
- DBSCAN for clustering

#### Database Layer (`sqlite_db.rs`)

**Schema**
```sql
-- Faces table
CREATE TABLE faces (
    id TEXT PRIMARY KEY,
    image_path TEXT NOT NULL,
    bounds TEXT NOT NULL,        -- JSON: {x, y, width, height}
    embedding BLOB,              -- Compressed 128D vector
    confidence REAL NOT NULL,
    quality_score REAL NOT NULL,
    landmarks TEXT,              -- JSON: 5-point landmarks
    created_at TEXT NOT NULL     -- ISO 8601 timestamp
);

-- People table
CREATE TABLE people (
    id TEXT PRIMARY KEY,
    name TEXT,
    face_count INTEGER NOT NULL,
    representative_face_id TEXT NOT NULL,
    created_at TEXT NOT NULL
);

-- Processing status table
CREATE TABLE processing_status (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL          -- JSON status object
);
```

**Operations**
- CRUD for faces and people
- Processing status persistence
- Statistics queries (counts, averages)
- Full database clear

### 3. Performance Optimization

#### Caching System
- **Preview Cache**: LRU cache for thumbnail images
- **Advanced Image Cache**: Multi-tier caching with memory and IndexedDB
- **Directory Cache**: 5-minute cache for directory listings
- **localStorage**: Persist user preferences and recent directories

#### Image Loading
- **Lazy Loading**: Images load as they enter viewport
- **Priority Loading**: High priority for visible images, low for below-fold
- **Progressive Loading**: Load thumbnails first, full quality on demand
- **Web Workers**: Offload directory scanning to background threads

#### Thumbnail Generation
- **Device-Adaptive**: Adjust quality based on hardware capabilities
- **Batch Processing**: Process images in chunks to prevent blocking
- **EXIF Extraction**: Use embedded thumbnails when available
- **Format Optimization**: WebP for modern browsers, JPEG fallback

### 4. Shared Backend (`shared-backend/`)

Cross-platform facial recognition logic for Tauri and React Native:

```
shared-backend/
├── core/
│   ├── api.ts              # Main API interface
│   ├── types.ts            # TypeScript interfaces
│   ├── hardware-detection.ts   # Device capability detection
│   ├── face-detection.ts       # Detection pipeline
│   ├── face-embedding.ts       # Embedding extraction
│   ├── face-clustering.ts      # Person grouping
│   └── onnx-inference.ts       # ONNX Runtime utilities
├── platforms/
│   └── tauri/
│       ├── database.ts         # Tauri DB implementation
│       ├── embedding-extractors.ts  # Platform-specific extractors
│       ├── face-detectors.ts        # Platform-specific detectors
│       └── hardware-detector.ts     # Tauri hardware detection
└── models/
    └── face-detection/
        └── yolov5s-face.onnx      # YOLOv5 face detection model
```

---

## 🔄 Data Flow

### Image Loading Flow
```
1. User selects directories
   ↓
2. Directory scanning (Web Worker)
   - Check cache first (5-minute TTL)
   - Recursive file listing via Tauri
   - Filter by image extensions
   ↓
3. File metadata retrieval
   - Get modification times
   - Sort by date (newest/oldest)
   ↓
4. Date-based organization
   - Group by month
   - Group by day within month
   - Generate smart labels (Today, Yesterday)
   ↓
5. Render organized grid
   - Lazy load images
   - Priority-based loading
   - Virtual scrolling for large collections
```

### Face Recognition Flow
```
1. Initialize service
   - Load hardware capabilities
   - Initialize SQLite database
   ↓
2. Process images
   - Queue images for processing
   - Detect faces (heuristic/ML model)
   - Store face bounds and landmarks
   ↓
3. Extract embeddings
   - Convert faces to 128D vectors
   - Store embeddings in database
   ↓
4. Cluster faces
   - DBSCAN algorithm for grouping
   - Create person groups
   - Assign representative faces
   ↓
5. User management
   - View people
   - Edit person names
   - Search by person
```

### Import Flow
```
1. Select source device/directory
   ↓
2. Scan for files
   - Filter by extensions
   - Check for duplicates (if enabled)
   ↓
3. Copy files
   - Preserve directory structure (optional)
   - Skip duplicates (optional)
   - Progress tracking with cancellation support
   ↓
4. Generate thumbnails
   - Device-adaptive quality
   - Batch processing
   ↓
5. Update gallery
   - Add new images to collection
   - Refresh organized grid
```

---

## 🛠️ Development Guide

### Prerequisites
- **Rust**: Latest stable version
- **Node.js**: v18+
- **Tauri CLI**: `cargo install tauri-cli`

### Setup
```bash
# Install dependencies
cd apps/desktop
npm install

# Run development server
npm run dev

# Build for production
npm run build
```

### Key Dependencies

**Frontend**
- `@tauri-apps/api`: Tauri JavaScript API
- `@mui/material`: Material-UI components
- `framer-motion`: Animations
- `onnxruntime-web`: Web-based ML inference
- `lenis`: Smooth scrolling

**Backend**
- `tauri`: Desktop framework
- `image`: Image processing
- `rusqlite`: SQLite database
- `walkdir`: Directory traversal
- `sysinfo`: System information
- `base64`: Base64 encoding

### Testing
```bash
# Run Rust tests
cd apps/desktop/src-tauri
cargo test

# Run facial recognition test
npx ts-node shared-backend/test-facial-recognition.ts
```

---

## 📊 Performance Benchmarks

### Image Loading
- **Small collections (< 1000)**: Instant load
- **Large collections (10k+)**: Progressive loading with viewport prioritization
- **Thumbnail generation**: ~50-100ms per image (device-dependent)

### Face Recognition (Planned with ML models)
- **Detection**: 50-300ms per image (mode-dependent)
- **Embedding**: 20-100ms per face (mode-dependent)
- **Clustering**: 200-500ms for 100 faces

---

## 🔒 Privacy & Security

- **Local Processing**: All AI inference happens on-device
- **No Cloud Upload**: Images and data never leave the device
- **Secure Storage**: SQLite with optional encryption
- **User Control**: Easy data deletion and feature disablement

---

## 🗺️ Roadmap

### Phase 1 (Current)
- ✅ Basic photo management
- ✅ Folder organization
- ✅ Device import
- ✅ Heuristic face detection
- ✅ Person clustering (mock)

### Phase 2 (Next)
- 🔄 Real ML models (YOLOv5, MobileFaceNet)
- 🔄 Advanced clustering algorithms
- 🔄 Person naming and management
- 🔄 Search and filtering

### Phase 3 (Future)
- ⏳ Cross-device synchronization
- ⏳ Video processing
- ⏳ Plugin architecture
- ⏳ Mobile app (React Native)

---

## 🐛 Known Issues & Limitations

1. **Face Detection**: Currently uses heuristic algorithm (not ML-based)
2. **Embedding Extraction**: Mock implementation (random vectors)
3. **Service Worker**: Disabled due to caching conflicts
4. **Lenis Scroll**: Temporarily disabled for testing
5. **Video Thumbnails**: Requires FFmpeg installation

---

## 📚 Additional Resources

- **Tauri Documentation**: https://tauri.app/
- **ONNX Runtime**: https://onnxruntime.ai/
- **Material-UI**: https://mui.com/
- **YOLOv5 Face**: https://github.com/deepcam-cn/yolov5-face

---

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Follow existing code patterns
4. Add tests for new functionality
5. Submit pull request

---

*This documentation provides a comprehensive overview of the OCD project architecture, components, and logic. For specific implementation details, refer to the source code and inline comments.*
