 // apps/desktop/src-tauri/src/face_detection_ml.rs
// ML-based face detection using YOLOv5 ONNX model with tract-onnx

use anyhow::{anyhow, Result};
use image::{DynamicImage, GenericImageView, RgbaImage};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tract_onnx::prelude::*;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Face {
    pub id: String,
    pub bounds: FaceBounds,
    pub confidence: f32,
    pub landmarks: Option<FaceLandmarks>,
    pub quality_score: f32,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct FaceQualityMetrics {
    pub blur_score: f32,
    pub brightness_score: f32,
    pub contrast_score: f32,
    pub face_angle: f32,
    pub overall_quality: f32,
}

pub struct MLFaceDetector {
    model: Option<SimplePlan<TypedFact, Box<dyn TypedOp>, Graph<TypedFact, Box<dyn TypedOp>>>>,
    input_size: usize,
    confidence_threshold: f32,
    nms_threshold: f32,
}

impl MLFaceDetector {
    pub fn new() -> Result<Self> {
        Ok(Self {
            model: None,
            input_size: 640,
            confidence_threshold: 0.5,
            nms_threshold: 0.45,
        })
    }

    pub fn load_model(&mut self, model_path: &Path) -> Result<()> {
        if !model_path.exists() {
            return Err(anyhow!("Model file not found: {:?}", model_path));
        }

        // Load ONNX model using tract
        let model = tract_onnx::onnx()
            .model_for_path(model_path)?
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
        let (orig_width, orig_height) = img.dimensions();
        
        // Preprocess image for YOLOv5
        let input_tensor = self.preprocess_image(&img)?;
        
        // Run inference
        let model = self.model.as_ref().unwrap();
        let outputs = model.run(tvec!(input_tensor))?;
        
        // Parse detections
        let mut faces = self.parse_detections(&outputs, orig_width as f32, orig_height as f32)?;
        
        // Apply Non-Maximum Suppression
        self.apply_nms(&mut faces);
        
        // Calculate quality metrics for each face
        for face in &mut faces {
            face.quality_score = self.calculate_quality_score(&img, &face.bounds);
        }

        // Sort by quality score
        faces.sort_by(|a, b| b.quality_score.partial_cmp(&a.quality_score).unwrap());

        let processing_time = start_time.elapsed().as_millis();

        Ok(FaceDetectionResult {
            faces,
            processing_time,
            model_used: "YOLOv5s-Face".to_string(),
            image_path: image_path.to_string(),
        })
    }

    fn preprocess_image(&self, img: &DynamicImage) -> Result<TValue> {
        let (width, height) = img.dimensions();
        
        // Calculate padding to maintain aspect ratio
        let scale = (self.input_size as f32 / width.max(height) as f32).min(1.0);
        let new_width = (width as f32 * scale) as u32;
        let new_height = (height as f32 * scale) as u32;
        
        // Resize image
        let resized = img.resize_exact(new_width, new_height, image::imageops::FilterType::Lanczos3);
        
        // Create padded image (letterbox)
        let mut padded = RgbaImage::new(self.input_size as u32, self.input_size as u32);
        
        // Calculate padding offsets
        let pad_x = (self.input_size as u32 - new_width) / 2;
        let pad_y = (self.input_size as u32 - new_height) / 2;
        
        // Copy resized image to padded image
        for y in 0..new_height {
            for x in 0..new_width {
                let pixel = resized.get_pixel(x, y);
                padded.put_pixel(pad_x + x, pad_y + y, pixel);
            }
        }
        
        // Convert to RGB and normalize to [0, 1]
        let mut input_data = Vec::with_capacity(self.input_size * self.input_size * 3);
        
        for y in 0..self.input_size as u32 {
            for x in 0..self.input_size as u32 {
                let pixel = padded.get_pixel(x, y);
                // Normalize to [0, 1]
                input_data.push(pixel[0] as f32 / 255.0); // R
                input_data.push(pixel[1] as f32 / 255.0); // G
                input_data.push(pixel[2] as f32 / 255.0); // B
            }
        }
        
        // Create tensor with shape [1, 3, 640, 640] (NCHW format)
        let tensor = Tensor::from_shape(&[1, 3, self.input_size, self.input_size], &input_data)?;
        
        Ok(tensor.into())
    }

    fn parse_detections(
        &self,
        outputs: &TVec<TValue>,
        orig_width: f32,
        orig_height: f32,
    ) -> Result<Vec<Face>> {
        let mut faces = Vec::new();
        
        // YOLOv5 output format: [batch, num_boxes, 85] where 85 = 4 bbox + 1 conf + 80 classes
        if let Some(output) = outputs.get(0) {
            let view = output.to_array_view::<f32>()?;
            let array = view.to_owned();
            let shape = array.shape();
            
            // Expected shape: [1, num_boxes, 85] or [1, 85, num_boxes]
            let (num_boxes, num_features) = if shape[1] == 85 {
                (shape[2], 85)
            } else {
                (shape[1], 85)
            };
            
            for i in 0..num_boxes {
                // Parse detection: [x, y, w, h, conf, class_scores...]
                let (x, y, w, h, conf) = if shape[1] == 85 {
                    // Shape is [1, 85, num_boxes]
                    (array[[0, 0, i]], array[[0, 1, i]], array[[0, 2, i]], array[[0, 3, i]], array[[0, 4, i]])
                } else {
                    // Shape is [1, num_boxes, 85]
                    (array[[0, i, 0]], array[[0, i, 1]], array[[0, i, 2]], array[[0, i, 3]], array[[0, i, 4]])
                };
                
                // Filter by confidence threshold
                if conf < self.confidence_threshold {
                    continue;
                }
                
                // Get class with highest score (should be face class)
                // For face detection, we typically have 1 class, so class_conf = conf
                let class_conf = conf;
                
                if class_conf < self.confidence_threshold {
                    continue;
                }
                
                // Convert normalized coordinates to original image coordinates
                let x1 = (x - w / 2.0) * orig_width;
                let y1 = (y - h / 2.0) * orig_height;
                let x2 = (x + w / 2.0) * orig_width;
                let y2 = (y + h / 2.0) * orig_height;
                
                let face_width = x2 - x1;
                let face_height = y2 - y1;
                
                // Generate landmarks based on face position
                let landmarks = self.estimate_landmarks(x1, y1, face_width, face_height);
                
                let face = Face {
                    id: uuid::Uuid::new_v4().to_string(),
                    bounds: FaceBounds {
                        x: x1.max(0.0),
                        y: y1.max(0.0),
                        width: face_width,
                        height: face_height,
                    },
                    confidence: class_conf,
                    landmarks: Some(landmarks),
                    quality_score: 0.0, // Will be calculated later
                };
                
                faces.push(face);
            }
        }
        
        Ok(faces)
    }

    fn estimate_landmarks(&self, x: f32, y: f32, width: f32, height: f32) -> FaceLandmarks {
        // Estimate facial landmarks based on face bounding box
        // These are approximate positions based on typical face proportions
        
        FaceLandmarks {
            left_eye: Point {
                x: x + width * 0.3,
                y: y + height * 0.35,
            },
            right_eye: Point {
                x: x + width * 0.7,
                y: y + height * 0.35,
            },
            nose: Point {
                x: x + width * 0.5,
                y: y + height * 0.55,
            },
            left_mouth: Point {
                x: x + width * 0.35,
                y: y + height * 0.75,
            },
            right_mouth: Point {
                x: x + width * 0.65,
                y: y + height * 0.75,
            },
        }
    }

    fn apply_nms(&self, faces: &mut Vec<Face>) {
        // Sort by confidence descending
        faces.sort_by(|a, b| b.confidence.partial_cmp(&a.confidence).unwrap());
        
        let mut keep = Vec::new();
        
        for i in 0..faces.len() {
            let mut should_keep = true;
            
            for &j in &keep {
                let iou: f32 = self.calculate_iou(&faces[i].bounds, &faces[j as usize].bounds);
                if iou > self.nms_threshold {
                    should_keep = false;
                    break;
                }
            }
            
            if should_keep {
                keep.push(i);
            }
        }
        
        // Keep only selected faces
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
        
        let intersection = (x2 - x1).max(0.0) * (y2 - y1).max(0.0);
        let area1 = box1.width * box1.height;
        let area2 = box2.width * box2.height;
        let union = area1 + area2 - intersection;
        
        if union == 0.0 {
            0.0
        } else {
            intersection / union
        }
    }

    fn calculate_quality_score(&self, img: &DynamicImage, bounds: &FaceBounds) -> f32 {
        let metrics = self.assess_face_quality(img, bounds);
        metrics.overall_quality
    }

    fn assess_face_quality(&self, img: &DynamicImage, bounds: &FaceBounds) -> FaceQualityMetrics {
        // Crop face region
        let x = bounds.x.max(0.0) as u32;
        let y = bounds.y.max(0.0) as u32;
        let width = bounds.width.min(img.width() as f32 - bounds.x) as u32;
        let height = bounds.height.min(img.height() as f32 - bounds.y) as u32;
        
        if width == 0 || height == 0 {
            return FaceQualityMetrics {
                blur_score: 0.0,
                brightness_score: 0.0,
                contrast_score: 0.0,
                face_angle: 0.0,
                overall_quality: 0.0,
            };
        }
        
        let face_crop = img.crop_imm(x, y, width, height);
        let rgb_img = face_crop.to_rgb8();
        
        // Calculate blur using Laplacian variance
        let blur_score = self.calculate_blur_score(&rgb_img);
        
        // Calculate brightness
        let brightness_score = self.calculate_brightness(&rgb_img);
        
        // Calculate contrast
        let contrast_score = self.calculate_contrast(&rgb_img);
        
        // Estimate face angle (simplified)
        let face_angle = 0.0; // Would require pose estimation model
        
        // Calculate overall quality score
        let overall_quality = (blur_score * 0.4 + brightness_score * 0.3 + contrast_score * 0.3)
            .clamp(0.0, 1.0);
        
        FaceQualityMetrics {
            blur_score,
            brightness_score,
            contrast_score,
            face_angle,
            overall_quality,
        }
    }

    fn calculate_blur_score(&self, img: &image::RgbImage) -> f32 {
        // Calculate Laplacian variance as blur metric
        let (width, height) = img.dimensions();
        if width < 3 || height < 3 {
            return 0.0;
        }
        
        let mut laplacian_sum = 0.0;
        let mut count = 0;
        
        for y in 1..height - 1 {
            for x in 1..width - 1 {
                let center = img.get_pixel(x, y)[0] as f32;
                let left = img.get_pixel(x - 1, y)[0] as f32;
                let right = img.get_pixel(x + 1, y)[0] as f32;
                let up = img.get_pixel(x, y - 1)[0] as f32;
                let down = img.get_pixel(x, y + 1)[0] as f32;
                
                // Laplacian
                let laplacian = 4.0 * center - left - right - up - down;
                laplacian_sum += laplacian.abs();
                count += 1;
            }
        }
        
        let avg_laplacian = if count > 0 { laplacian_sum / count as f32 } else { 0.0 };
        
        // Normalize to 0-1 range (higher is sharper)
        (avg_laplacian / 255.0).min(1.0)
    }

    fn calculate_brightness(&self, img: &image::RgbImage) -> f32 {
        let mut total_brightness = 0.0;
        let pixel_count = img.width() * img.height();
        
        for pixel in img.pixels() {
            // Convert RGB to perceived brightness
            let brightness = 0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32;
            total_brightness += brightness;
        }
        
        let avg_brightness = total_brightness / pixel_count as f32;
        
        // Score is highest around middle brightness (128)
        let normalized = avg_brightness / 255.0;
        1.0 - (normalized - 0.5).abs() * 2.0
    }

    fn calculate_contrast(&self, img: &image::RgbImage) -> f32 {
        let mut min_brightness: f32 = 255.0;
        let mut max_brightness: f32 = 0.0;
        
        for pixel in img.pixels() {
            let brightness = 0.299 * pixel[0] as f32 + 0.587 * pixel[1] as f32 + 0.114 * pixel[2] as f32;
            min_brightness = min_brightness.min(brightness);
            max_brightness = max_brightness.max(brightness);
        }
        
        let contrast = max_brightness - min_brightness;
        (contrast / 255.0).min(1.0f32)
    }

    pub fn set_confidence_threshold(&mut self, threshold: f32) {
        self.confidence_threshold = threshold.clamp(0.0, 1.0);
    }

    pub fn set_nms_threshold(&mut self, threshold: f32) {
        self.nms_threshold = threshold.clamp(0.0, 1.0);
    }
}

impl Default for MLFaceDetector {
    fn default() -> Self {
        Self::new().expect("Failed to create default MLFaceDetector")
    }
}
