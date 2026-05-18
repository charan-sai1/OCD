// Stub module
pub struct MobileFaceNetEmbedder;

impl MobileFaceNetEmbedder {
  pub fn new() -> anyhow::Result<Self> {
    Ok(Self)
  }
  
  pub fn load_model(&mut self, _path: &std::path::Path) -> anyhow::Result<()> {
    Ok(())
  }
  
  pub fn extract_embeddings(&mut self, _face_crops: Vec<FaceCrop>) -> anyhow::Result<EmbeddingResult> {
    Ok(EmbeddingResult {
      faces: vec![],
      processing_time: 0.0,
      model_used: "stub".to_string(),
    })
  }
}

pub struct FaceCrop {
  pub face_id: String,
  pub image_data: image::DynamicImage,
  pub bounds: super::database_enhanced::FaceBounds,
}

pub struct EmbeddingResult {
  pub faces: Vec<EmbeddedFace>,
  pub processing_time: f32,
  pub model_used: String,
}

pub struct EmbeddedFace {
  pub id: String,
  pub embedding: Vec<f32>,
}

pub struct FaceBounds {
  pub x: f32,
  pub y: f32,
  pub width: f32,
  pub height: f32,
}

