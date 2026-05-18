// Stub module
pub struct MetadataExtractor;

impl MetadataExtractor {
  pub fn new() -> Self {
    Self
  }
  
  pub fn extract_from_image(&self, _path: &str) -> anyhow::Result<serde_json::Value> {
    Ok(serde_json::json!({}))
  }
}

