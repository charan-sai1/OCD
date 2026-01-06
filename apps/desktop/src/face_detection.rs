// apps/desktop/src/face_detection.rs
// Face detection implementation using YOLOv5 ONNX model

use anyhow::{anyhow, Result};
use image::{DynamicImage, GenericImageView, RgbaImage};
use ndarray::{Array, Array3, Array4, Axis};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;
use tract_core::prelude::*;
use tract_onnx::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Face {
    pub id: String,
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
pub struct FaceDetectionResult {
    pub faces: Vec<Face>,
    pub processing_time: u128,
    pub model_used: String,
    pub image_path: String,
}

pub struct FaceDetector {
    model: Option<SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>>,
    input_shape: Vec<usize>,
}

impl FaceDetector {
    pub fn new() -> Self {
        Self {
            model: None,
            input_shape: vec![1, 3, 640, 640], // YOLOv5 default input size
        }
    }

    pub fn load_model(&mut self, model_path: &Path) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {:?}", model_path));
        }

        // Load ONNX model using tract
        let model = tract_onnx::onnx()
            .model_for_path(model_path)?
            .with_input_fact(
                0,
                InferenceFact::dt_shape(f32::datum_type(), tvec!(1, 3, 640, 640)),
            )?
            .into_optimized()?
            .into_runnable()?;

        self.model = Some(model);
        Ok(())
    }

    pub fn detect_faces(&self, image_path: &str) -> Result<FaceDetectionResult> {
        let start_time = std::time::Instant::now();

        if self.model.is_none() {
            return Err(anyhow!("Model not loaded"));
        }

        // Load and preprocess image
        let img = image::open(image_path)?;
        let input_tensor = self.preprocess_image(&img)?;

        // Run inference
        let model = self.model.as_ref().unwrap();
        let result = model.run(tvec!(input_tensor))?;

        // Parse detections
        let faces = self.parse_detections(&result, img.width() as f32, img.height() as f32)?;

        let processing_time = start_time.elapsed().as_millis();

        Ok(FaceDetectionResult {
            faces,
            processing_time,
            model_used: "YOLOv5Face".to_string(),
            image_path: image_path.to_string(),
        })
    }

    fn preprocess_image(&self, img: &DynamicImage) -> Result<Tensor> {
        let (width, height) = img.dimensions();

        // Resize to 640x640 maintaining aspect ratio
        let resized = img.resize_exact(640, 640, image::imageops::FilterType::Triangle);

        // Convert to RGB and normalize to [0, 1]
        let mut rgb_data = Vec::with_capacity(640 * 640 * 3);

        for pixel in resized.pixels() {
            let rgb = pixel.2;
            rgb_data.push(rgb[0] as f32 / 255.0); // R
            rgb_data.push(rgb[1] as f32 / 255.0); // G
            rgb_data.push(rgb[2] as f32 / 255.0); // B
        }

        // Create tensor with shape [1, 3, 640, 640]
        let tensor_data = Array4::<f32>::from_shape_vec((1, 3, 640, 640), rgb_data)?;
        let tensor = tensor_data.into_tensor();

        Ok(tensor)
    }

    fn parse_detections(
        &self,
        result: &TVals,
        original_width: f32,
        original_height: f32,
    ) -> Result<Vec<Face>> {
        let mut faces = Vec::new();

        // YOLOv5 output format: [batch, num_boxes, 85] where 85 = 4 bbox + 1 conf + 80 classes
        // For face detection, we typically have 1 class (face)
        if let Some(output_tensor) = result.get(0) {
            let array = output_tensor.to_array_view::<f32>()?;

            // Get the detection array [num_boxes, 85]
            let detections = array.slice(s![0, .., ..]);

            for detection in detections.outer_iter() {
                if detection.len() < 5 {
                    continue;
                }

                // Parse YOLOv5 detection format: [x, y, w, h, conf, class_scores...]
                let x = detection[0];
                let y = detection[1];
                let w = detection[2];
                let h = detection[3];
                let conf = detection[4];

                // Filter by confidence threshold
                if conf < 0.5 {
                    continue;
                }

                // Convert from normalized coordinates to original image coordinates
                let x_abs = x * original_width;
                let y_abs = y * original_height;
                let w_abs = w * original_width;
                let h_abs = h * original_height;

                let face = Face {
                    id: uuid::Uuid::new_v4().to_string(),
                    bounds: FaceBounds {
                        x: (x_abs - w_abs / 2.0).max(0.0),
                        y: (y_abs - h_abs / 2.0).max(0.0),
                        width: w_abs,
                        height: h_abs,
                    },
                    confidence: conf,
                    landmarks: None, // YOLOv5 doesn't provide landmarks
                };

                faces.push(face);
            }
        }

        // Apply Non-Maximum Suppression (NMS)
        self.apply_nms(&mut faces, 0.45);

        Ok(faces)
    }

    fn apply_nms(&self, faces: &mut Vec<Face>, iou_threshold: f32) {
        // Sort by confidence descending
        faces.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());

        let mut keep = Vec::new();

        for i in 0..faces.len() {
            let mut should_keep = true;

            for &j in &keep {
                if self.calculate_iou(&faces[i].bounds, &faces[j].bounds) > iou_threshold {
                    should_keep = false;
                    break;
                }
            }

            if should_keep {
                keep.push(i);
            }
        }

        // Keep only the selected faces
        let mut selected_faces = Vec::new();
        for &i in &keep {
            selected_faces.push(faces[i].clone());
        }

        *faces = selected_faces;
    }

    fn calculate_iou(&self, box1: &FaceBounds, box2: &FaceBounds) -> f32 {
        let x1 = box1.x.max(box2.x);
        let y1 = box1.y.max(box2.y);
        let x2 = (box1.x + box1.width).min(box2.x + box2.width);
        let y2 = (box1.y + box1.height).min(box2.y + box2.height);

        let intersection = 0.0f32.max(x2 - x1) * 0.0f32.max(y2 - y1);
        let union = box1.width * box1.height + box2.width * box2.height - intersection;

        if union == 0.0 {
            0.0
        } else {
            intersection / union
        }
    }
}
