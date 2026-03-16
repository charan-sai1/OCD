// apps/desktop/src/face_embedding.rs
// Face embedding extraction implementation

use anyhow::{anyhow, Result};
use image::{DynamicImage, GenericImageView};
use ndarray::{Array, Array3, Array4, Axis};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tract_core::prelude::*;
use tract_onnx::prelude::*;

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
}

pub struct FaceEmbedder {
    model: Option<SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>>,
    input_shape: Vec<usize>,
}

impl FaceEmbedder {
    pub fn new() -> Self {
        Self {
            model: None,
            input_shape: vec![1, 3, 112, 112], // Standard face embedding input size
        }
    }

    pub fn load_model(&mut self, model_path: &Path) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!("Embedding model file not found: {:?}", model_path));
        }

        // Load ONNX model
        let model = tract_onnx::onnx()
            .model_for_path(model_path)?
            .with_input_fact(
                0,
                InferenceFact::dt_shape(f32::datum_type(), tvec!(1, 3, 112, 112)),
            )?
            .into_optimized()?
            .into_runnable()?;

        self.model = Some(model);
        Ok(())
    }

    pub fn extract_embeddings(&self, face_crops: Vec<FaceCrop>) -> Result<EmbeddingResult> {
        let start_time = std::time::Instant::now();

        if self.model.is_none() {
            return Err(anyhow!("Embedding model not loaded"));
        }

        let mut embedded_faces = Vec::new();

        for crop in face_crops {
            let input_tensor = self.preprocess_face_crop(&crop.image_data)?;
            let embedding = self.extract_single_embedding(&input_tensor)?;

            embedded_faces.push(EmbeddedFace {
                id: crop.face_id,
                embedding,
            });
        }

        let processing_time = start_time.elapsed().as_millis();

        Ok(EmbeddingResult {
            faces: embedded_faces,
            processing_time,
            model_used: "FaceNet".to_string(),
        })
    }

    fn preprocess_face_crop(&self, image_data: &DynamicImage) -> Result<Tensor> {
        // Resize to 112x112 (standard face embedding input size)
        let resized = image_data.resize_exact(112, 112, image::imageops::FilterType::Triangle);

        // Convert to RGB and normalize
        let mut rgb_data = Vec::with_capacity(112 * 112 * 3);

        for pixel in resized.pixels() {
            let rgb = pixel.2;
            // Normalize to [-1, 1] as expected by most face embedding models
            rgb_data.push((rgb[0] as f32 / 127.5) - 1.0); // R
            rgb_data.push((rgb[1] as f32 / 127.5) - 1.0); // G
            rgb_data.push((rgb[2] as f32 / 127.5) - 1.0); // B
        }

        // Create tensor with shape [1, 3, 112, 112]
        let tensor_data = Array4::<f32>::from_shape_vec((1, 3, 112, 112), rgb_data)?;
        let tensor = tensor_data.into_tensor();

        Ok(tensor)
    }

    fn extract_single_embedding(&self, input_tensor: &Tensor) -> Result<Vec<f32>> {
        let model = self.model.as_ref().unwrap();
        let result = model.run(tvec!(input_tensor.clone()))?;

        // Extract embedding from output tensor
        if let Some(output_tensor) = result.get(0) {
            let array = output_tensor.to_array_view::<f32>()?;
            let embedding: Vec<f32> = array.iter().cloned().collect();

            // Normalize embedding to unit length
            self.normalize_embedding(&mut embedding);

            Ok(embedding)
        } else {
            Err(anyhow!("No output tensor from embedding model"))
        }
    }

    fn normalize_embedding(&self, embedding: &mut Vec<f32>) {
        let norm: f32 = embedding.iter().map(|x| x * x).sum::<f32>().sqrt();
        if norm > 0.0 {
            for val in embedding.iter_mut() {
                *val /= norm;
            }
        }
    }
}

#[derive(Debug)]
pub struct FaceCrop {
    pub face_id: String,
    pub image_data: DynamicImage,
}

// Helper function to crop faces from original image
pub fn crop_faces_from_image(
    image_path: &str,
    faces: &[super::face_detection::Face],
) -> Result<Vec<FaceCrop>> {
    let img = image::open(image_path)?;
    let mut crops = Vec::new();

    for face in faces {
        let bounds = &face.bounds;

        // Ensure bounds are within image dimensions
        let x = bounds.x.max(0.0) as u32;
        let y = bounds.y.max(0.0) as u32;
        let width = bounds.width as u32;
        let height = bounds.height as u32;

        // Ensure we don't go beyond image boundaries
        let x_end = (x + width).min(img.width());
        let y_end = (y + height).min(img.height());
        let actual_width = x_end - x;
        let actual_height = y_end - y;

        if actual_width > 0 && actual_height > 0 {
            let crop = img.crop_imm(x, y, actual_width, actual_height);

            crops.push(FaceCrop {
                face_id: face.id.clone(),
                image_data: DynamicImage::ImageRgba8(crop.to_rgba8()),
            });
        }
    }

    Ok(crops)
}
