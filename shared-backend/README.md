# Cross-Platform Facial Recognition Backend

A sophisticated facial recognition system designed for both Tauri desktop and React Native mobile applications. Features hardware-aware processing, real AI models, and seamless integration.

## 🏗️ Architecture

```
shared-backend/
├── core/                          # Platform-agnostic logic
│   ├── api.ts                     # Main API interface
│   ├── types.ts                   # TypeScript interfaces
│   ├── hardware-detection.ts      # Device capability detection
│   ├── face-detection.ts          # Face detection pipeline
│   ├── face-embedding.ts          # Embedding extraction & similarity
│   ├── face-clustering.ts         # Person grouping algorithms
│   └── onnx-inference.ts          # ONNX Runtime utilities
├── models/                        # Pre-trained AI models
│   ├── face-detection/            # Detection models (YOLOv5, MTCNN, RetinaFace)
│   └── face-embedding/            # Embedding models (MobileFaceNet, FaceNet, ArcFace)
├── database/                      # SQLite schema & operations
└── platforms/                     # Platform-specific implementations
    ├── tauri/                     # Desktop implementation
    └── react-native/              # Mobile implementation
```

## 🚀 Features

### Hardware-Aware Processing
- **Automatic model selection** based on CPU cores, RAM, and GPU availability
- **Three processing modes**: Fast, Balanced, High Accuracy
- **Battery-aware** processing on mobile devices
- **Thermal management** to prevent device overheating

### Real AI Models
- **Face Detection**: YOLOv5, MTCNN, RetinaFace
- **Face Embeddings**: MobileFaceNet, FaceNet, ArcFace
- **Clustering**: DBSCAN, Hierarchical clustering
- **ONNX Runtime** for cross-platform inference

### Cross-Platform Support
- **Tauri Desktop**: Full GPU acceleration, parallel processing
- **React Native Mobile**: Lightweight models, battery optimization
- **Shared codebase** with platform-specific optimizations

## 📦 Installation

### Desktop (Tauri)
```bash
cd apps/desktop
npm install onnxruntime-web
```

### Mobile (React Native)
```bash
cd apps/mobile
npm install onnxruntime-react-native
```

## 🎯 Usage

### Basic Setup
```typescript
import { FaceRecognitionAPI } from './shared-backend/core/api.js';
import { TauriHardwareDetector } from './shared-backend/platforms/tauri/hardware-detector.js';
// ... other imports

// Initialize
const api = new FaceRecognitionAPI(hardwareDetector, ...);
await api.initialize();

// Detect faces
const result = await api.detectFaces('/path/to/image.jpg');

// Extract embeddings
await api.extractEmbeddings(faceIds);

// Find similar faces
const similar = await api.findSimilarFaces(queryFaceId);

// Cluster into people
const people = await api.clusterFaces();
```

### React Hook (Desktop)
```typescript
import { useFaceRecognition } from './hooks/useFaceRecognition.js';

function MyComponent() {
  const {
    detectFaces,
    clusterFaces,
    people,
    processingStatus
  } = useFaceRecognition();

  // Use the API...
}
```

## 🔧 Configuration

### Processing Modes

| Mode | Detection | Embedding | Use Case |
|------|-----------|-----------|----------|
| Fast | YOLOv5 | MobileFaceNet | Quick scanning, limited hardware |
| Balanced | MTCNN | FaceNet | Good balance, standard hardware |
| High Accuracy | RetinaFace | ArcFace | Best quality, powerful hardware |

### Hardware Requirements

**Minimum (Fast Mode):**
- 2 CPU cores
- 2GB RAM
- Any modern device

**Recommended (Balanced Mode):**
- 4 CPU cores
- 4GB RAM
- Mobile or desktop

**Optimal (High Accuracy Mode):**
- 8+ CPU cores
- 8GB+ RAM
- GPU acceleration

## 🧪 Testing

Run the test suite:
```bash
cd shared-backend
npx ts-node test-facial-recognition.ts
```

Or in browser console:
```javascript
testFacialRecognition();
```

## 📊 Performance Benchmarks

### Face Detection (640x480 image)
- **Fast Mode**: ~50ms (YOLOv5)
- **Balanced Mode**: ~150ms (MTCNN)
- **High Accuracy**: ~300ms (RetinaFace)

### Face Embedding (single face)
- **Fast Mode**: ~20ms (MobileFaceNet)
- **Balanced Mode**: ~50ms (FaceNet)
- **High Accuracy**: ~100ms (ArcFace)

### Clustering (100 faces)
- **DBSCAN**: ~200ms
- **Hierarchical**: ~500ms

## 🔒 Privacy & Security

- **Local Processing**: All AI inference happens on-device
- **No Cloud Upload**: Images and embeddings never leave the device
- **Secure Storage**: SQLite database with optional encryption
- **User Control**: Easy to disable features and delete data

## 🛠️ Development

### Adding New Models
1. Convert model to ONNX format
2. Add to `shared-backend/models/`
3. Implement detector/extractor class
4. Register in platform-specific index.ts

### Platform-Specific Code
- Keep platform-agnostic logic in `core/`
- Platform optimizations in `platforms/`
- Use feature flags for conditional compilation

## 📈 Roadmap

### Phase 1 ✅ (Current)
- Hardware-aware processing
- Real AI models integration
- Cross-platform architecture
- Basic UI components

### Phase 2 (Next)
- Model optimization and quantization
- Advanced clustering algorithms
- Person naming and management
- Search and filtering features

### Phase 3 (Future)
- Cross-device synchronization
- Advanced pose estimation
- Video processing
- Plugin architecture

## 🤝 Contributing

1. Fork the repository
2. Create feature branch
3. Add tests for new functionality
4. Ensure cross-platform compatibility
5. Submit pull request

## 📄 License

This project is licensed under the MIT License - see the LICENSE file for details.

## 🙏 Acknowledgments

- [ONNX Runtime](https://onnxruntime.ai/) for cross-platform ML inference
- [InsightFace](https://github.com/deepinsight/insightface) for ArcFace implementation
- [YOLOv5](https://github.com/ultralytics/yolov5) for face detection
- [FaceNet](https://github.com/davidsandberg/facenet) for embedding extraction