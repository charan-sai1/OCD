// Stub module
pub struct FaceClustering;

impl FaceClustering {
  pub fn new() -> Self {
    Self
  }
  
  pub fn cluster_faces(&self, _faces: &[face_embedding_ml::EmbeddedFace]) -> anyhow::Result<ClusteringResult> {
    Ok(ClusteringResult {
      person_groups: vec![],
      algorithm: "stub".to_string(),
      processing_time: 0.0,
    })
  }
}

pub struct ClusteringResult {
  pub person_groups: Vec<PersonGroup>,
  pub algorithm: String,
  pub processing_time: f32,
}

pub struct PersonGroup {
  pub id: String,
  pub name: String,
  pub face_ids: Vec<String>,
  pub representative_face_id: String,
  pub confidence: f32,
  pub created_at: chrono::DateTime<chrono::Utc>,
}

