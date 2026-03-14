// apps/desktop/src-tauri/src/face_embedding_ml.rs
// MobileFaceNet-based face embedding extraction using ONNX Runtime

use anyhow::{anyhow, Result};
use image::{DynamicImage, GenericImageView, RgbImage};
use ndarray::{Array, Array4, s};
use serde::{Deserialize, Serialize};
use std::path::Path;
use std::sync::Arc;
use ort::{
    Environment, ExecutionProvider, Session, SessionBuilder, Value,
    GraphOptimizationLevel,
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddingResult {
    pub faces: Vec<EmbeddedFace>,
    pub processing_time: u128,
    pub model_used: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct EmbeddedFace {
    pub id: String,
    pub embedding: Vec<f32>,
    pub quality_score: f32,
}

#[derive(Debug, Clone)]
pub struct FaceCrop {
    pub face_id: String,
    pub image_data: DynamicImage,
    pub bounds: FaceBounds,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceBounds {
    pub x: f32,
    pub y: f32,
    pub width: f32,
    pub height: f32,
}

pub struct MobileFaceNetEmbedder {
    session: Option<Session>,
    environment: Arc<Environment>,
    input_size: usize,
    embedding_dim: usize,
}

impl MobileFaceNetEmbedder {
    pub fn new() -> Result<Self> {
        // Initialize ONNX Runtime environment
        let environment = Environment::builder()
            .with_name("ocd_face_embedding")
            .with_execution_providers([
                ExecutionProvider::CUDA(Default::default()),
                ExecutionProvider::CPU(Default::default()),
            ])
            .build()?
            .into_arc();

        Ok(Self {
            session: None,
            environment,
            input_size: 112, // MobileFaceNet input size
            embedding_dim: 128, // MobileFaceNet embedding dimension
        })
    }

    pub fn load_model(&mut self, model_path: &Path) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!("Embedding model file not found: {:?}", model_path));
        }

        // Build session with optimizations
        let session = SessionBuilder::new(&self.environment)?
            .with_optimization_level(GraphOptimizationLevel::Level3)?
            .with_intra_threads(4)?
            .with_model_from_file(model_path)?;

        self.session = Some(session);
        Ok(())
    }

    pub fn extract_embeddings(&self, face_crops: Vec<FaceCrop>) -> Result<EmbeddingResult> {
        let start_time = std::time::Instant::now();

        if self.session.is_none() {
            return Err(anyhow!("Embedding model not loaded"));
        }

        let mut embedded_faces = Vec::new();

        for crop in face_crops {
            // Preprocess face crop
            let input_tensor = self.preprocess_face_crop(&crop.image_data)?;
            
            // Run inference
            let session = self.session.as_ref().unwrap();
            let outputs = session.run(vec![input_tensor])?;
            
            // Extract embedding
            let mut embedding = self.extract_embedding_from_output(&outputs)?;
            
            // Normalize embedding to unit length
            Self::normalize_embedding(&mut embedding);
            
            // Calculate quality score based on embedding variance
            let quality_score = self.calculate_embedding_quality(&embedding);
            
            embedded_faces.push(EmbeddedFace {
                id: crop.face_id,
                embedding,
                quality_score,
            });
        }

        let processing_time = start_time.elapsed().as_millis();

        Ok(EmbeddingResult {
            faces: embedded_faces,
            processing_time,
            model_used: "MobileFaceNet".to_string(),
        })
    }

    fn preprocess_face_crop(&self, image_data: &DynamicImage) -> Result<Value> {
        // Resize to 112x112 (MobileFaceNet input size)
        let resized = image_data.resize_exact(
            self.input_size as u32, 
            self.input_size as u32, 
            image::imageops::FilterType::Lanczos3
        );

        // Convert to RGB
        let rgb_img = resized.to_rgb8();
        
        // Normalize using MobileFaceNet preprocessing
        // MobileFaceNet expects input in range [-1, 1] or [0, 1] depending on training
        // Using [-1, 1] normalization as it's more common for face recognition models
        let mut input_data = Vec::with_capacity(self.input_size * self.input_size * 3);
        
        for pixel in rgb_img.pixels() {
            // Normalize to [-1, 1]
            input_data.push((pixel[0] as f32 / 127.5) - 1.0); // R
            input_data.push((pixel[1] as f32 / 127.5) - 1.0); // G
            input_data.push((pixel[2] as f32 / 127.5) - 1.0); // B
        }

        // Create tensor with shape [1, 3, 112, 112] (NCHW format)
        let array = Array4::from_shape_vec((1, 3, self.input_size, self.input_size), input_data)?;
        
        // Create ONNX tensor
        let tensor = Value::from_array(session.allocator(), &array)?;
        
        Ok(tensor)
    }

    fn extract_embedding_from_output(&self, outputs: &[Value]) -> Result<Vec<f32>> {
        if let Some(output) = outputs.get(0) {
            let array = output.try_extract::<f32>()?;
            
            // Extract embedding vector
            let embedding: Vec<f32> = array.iter().cloned().collect();
            
            // Ensure correct dimension
            if embedding.len() != self.embedding_dim {
                return Err(anyhow!(
                    "Unexpected embedding dimension: expected {}, got {}",
                    self.embedding_dim,
                    embedding.len()
                ));
            }
            
            Ok(embedding)
        } else {
            Err(anyhow!("No output tensor from embedding model"))
        }
    }

    fn normalize_embedding(embedding: &mut Vec<f32>) {
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for val in embedding.iter_mut() {
                *val /= norm;
            }
        }
    }

    fn calculate_embedding_quality(&self, embedding: &[f32]) -> f32 {
        // Calculate quality based on embedding statistics
        // Higher variance generally indicates better quality embeddings
        
        if embedding.is_empty() {
            return 0.0;
        }
        
        // Calculate mean
        let mean = embedding.iter().sum::<f32>() / embedding.len() as f32;
        
        // Calculate variance
        let variance = embedding.iter()
            .map(|&x| (x - mean).powi(2))
            .sum::<f32>() / embedding.len() as f32;
        
        // Normalize to 0-1 range (typical variance for good embeddings is around 0.01-0.1)
        let normalized_quality = (variance * 10.0).min(1.0);
        
        normalized_quality
    }

    pub fn calculate_similarity(embedding1: &[f32], embedding2: &[f32]) -> f32 {
        if embedding1.len() != embedding2.len() {
            return 0.0;
        }
        
        // Calculate cosine similarity
        let dot_product: f32 = embedding1.iter()
            .zip(embedding2.iter())
            .map(|(a, b)| a * b)
            .sum();
        
        // Since embeddings are normalized, cosine similarity = dot product
        dot_product.max(-1.0).min(1.0) // Clamp to [-1, 1]
    }

    pub fn calculate_distance(embedding1: &[f32], embedding2: &[f32]) -> f32 {
        // Calculate Euclidean distance
        let squared_diff: f32 = embedding1.iter()
            .zip(embedding2.iter())
            .map(|(a, b)| (a - b).powi(2))
            .sum();
        
        squared_diff.sqrt()
    }

    pub fn get_embedding_dim(&self) -> usize {
        self.embedding_dim
    }
}

impl Default for MobileFaceNetEmbedder {
    fn default() -> Self {
        Self::new().expect("Failed to create default MobileFaceNetEmbedder")
    }
}

// Helper function to crop faces from original image with alignment
pub fn crop_and_align_face(
    image_path: &str,
    face_bounds: &FaceBounds,
    landmarks: Option<&super::face_detection_ml::FaceLandmarks>,
) -> Result<DynamicImage> {
    let img = image::open(image_path)?;
    
    // If landmarks are available, use them for alignment
    if let Some(landmarks) = landmarks {
        // Calculate alignment transform based on eye positions
        let left_eye = (landmarks.left_eye.x, landmarks.left_eye.y);
        let right_eye = (landmarks.right_eye.x, landmarks.right_eye.y);
        
        // Calculate rotation angle
        let dy = right_eye.1 - left_eye.1;
        let dx = right_eye.0 - left_eye.0;
        let angle = dy.atan2(dx);
        
        // Calculate center point between eyes
        let eye_center = (
            (left_eye.0 + right_eye.0) / 2.0,
            (left_eye.1 + right_eye.1) / 2.0,
        );
        
        // Crop with some margin around the face
        let margin = 0.3; // 30% margin
        let crop_x = (face_bounds.x - face_bounds.width * margin).max(0.0) as u32;
        let crop_y = (face_bounds.y - face_bounds.height * margin).max(0.0) as u32;
        let crop_width = (face_bounds.width * (1.0 + 2.0 * margin)).min(img.width() as f32 - crop_x as f32) as u32;
        let crop_height = (face_bounds.height * (1.0 + 2.0 * margin)).min(img.height() as f32 - crop_y as f32) as u32;
        
        // Crop the face region
        let cropped = img.crop_imm(crop_x, crop_y, crop_width, crop_height);
        
        // TODO: Apply rotation alignment if needed
        // For now, return the cropped image
        Ok(DynamicImage::ImageRgba8(cropped.to_rgba8()))
    } else {
        // Simple crop without alignment
        let x = face_bounds.x.max(0.0) as u32;
        let y = face_bounds.y.max(0.0) as u32;
        let width = face_bounds.width.min(img.width() as f32 - x as f32) as u32;
        let height = face_bounds.height.min(img.height() as f32 - y as f32) as u32;
        
        let cropped = img.crop_imm(x, y, width, height);
        Ok(DynamicImage::ImageRgba8(cropped.to_rgba8()))
    }
}

// Batch processing for efficiency
pub fn batch_extract_embeddings(
    embedder: &MobileFaceNetEmbedder,
    face_crops: Vec<FaceCrop>,
    batch_size: usize,
) -> Result<EmbeddingResult> {
    let start_time = std::time::Instant::now();
    let mut all_embeddings = Vec::new();
    
    // Process in batches
    for chunk in face_crops.chunks(batch_size) {
        let batch_result = embedder.extract_embeddings(chunk.to_vec())?;
        all_embeddings.extend(batch_result.faces);
    }
    
    let processing_time = start_time.elapsed().as_millis();
    
    Ok(EmbeddingResult {
        faces: all_embeddings,
        processing_time,
        model_used: "MobileFaceNet-Batch".to_string(),
    })
}
