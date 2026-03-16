// apps/desktop/src/face_clustering.rs
// Face clustering implementation using DBSCAN

use anyhow::Result;
use linfa::prelude::*;
use linfa_clustering::Dbscan;
use ndarray::{Array2, ArrayView1};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PersonGroup {
    pub id: String,
    pub name: Option<String>,
    pub face_ids: Vec<String>,
    pub representative_face_id: String,
    pub confidence: f32,
    pub created_at: chrono::DateTime<chrono::Utc>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ClusteringResult {
    pub person_groups: Vec<PersonGroup>,
    pub algorithm: String,
    pub processing_time: u128,
}

pub struct FaceClustering {
    similarity_threshold: f32,
    min_samples: usize,
}

impl FaceClustering {
    pub fn new() -> Self {
        Self {
            similarity_threshold: 0.6, // Cosine similarity threshold
            min_samples: 2,            // Minimum faces per cluster
        }
    }

    pub fn cluster_faces(
        &self,
        embeddings: &[super::face_embedding_ml::EmbeddedFace],
    ) -> Result<ClusteringResult> {
        let start_time = std::time::Instant::now();

        if embeddings.is_empty() {
            return Ok(ClusteringResult {
                person_groups: Vec::new(),
                algorithm: "DBSCAN".to_string(),
                processing_time: start_time.elapsed().as_millis(),
            });
        }

        // Convert embeddings to dataset format
        let embedding_dim = embeddings[0].embedding.len();
        let mut data = Vec::with_capacity(embeddings.len() * embedding_dim);

        for embedding in embeddings {
            data.extend_from_slice(&embedding.embedding);
        }

        let dataset = Array2::from_shape_vec((embeddings.len(), embedding_dim), data)?;

        // Compute pairwise cosine similarities
        let similarity_matrix = self.compute_similarity_matrix(&dataset);

        // Use DBSCAN clustering with custom distance metric
        let clusters = self.perform_clustering(&similarity_matrix)?;

        // Convert clusters to PersonGroups
        let person_groups = self.create_person_groups(&clusters, embeddings);

        Ok(ClusteringResult {
            person_groups,
            algorithm: "DBSCAN".to_string(),
            processing_time: start_time.elapsed().as_millis(),
        })
    }

    fn compute_similarity_matrix(&self, dataset: &Array2<f32>) -> Array2<f32> {
        let n = dataset.nrows();
        let mut similarity_matrix = Array2::<f32>::zeros((n, n));

        for i in 0..n {
            for j in 0..n {
                if i == j {
                    similarity_matrix[[i, j]] = 1.0; // Self-similarity
                } else {
                    let similarity = self.cosine_similarity(dataset.row(i), dataset.row(j));
                    similarity_matrix[[i, j]] = similarity;
                }
            }
        }

        similarity_matrix
    }

    fn cosine_similarity(&self, a: ArrayView1<f32>, b: ArrayView1<f32>) -> f32 {
        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot_product / (norm_a * norm_b)
        }
    }

    fn perform_clustering(&self, similarity_matrix: &Array2<f32>) -> Result<Vec<Vec<usize>>> {
        // Convert similarity to distance (1 - similarity)
        let distance_matrix = 1.0 - similarity_matrix;

        // Use DBSCAN with custom distance metric
        let dataset = linfa::Dataset::from(distance_matrix.clone());

        let model = Dbscan::params(self.min_samples)
            .tolerance(1.0 - self.similarity_threshold) // Distance threshold
            .transform(dataset)?;

        // Get cluster labels from the dataset
        let targets = model.targets();
        
        // Group points by cluster
        let mut clusters: HashMap<usize, Vec<usize>> = HashMap::new();

        for (point_idx, cluster_id) in targets.iter().enumerate() {
            if let Some(cluster_id) = cluster_id {
                clusters
                    .entry(*cluster_id)
                    .or_insert_with(Vec::new)
                    .push(point_idx);
            }
        }

        // Filter out clusters with too few members
        let valid_clusters: Vec<Vec<usize>> = clusters
            .into_iter()
            .filter(|(_, members)| members.len() >= self.min_samples)
            .map(|(_, members)| members)
            .collect();

        Ok(valid_clusters)
    }

    fn create_person_groups(
        &self,
        clusters: &[Vec<usize>],
        embeddings: &[super::face_embedding_ml::EmbeddedFace],
    ) -> Vec<PersonGroup> {
        let mut person_groups = Vec::new();

        for (cluster_idx, cluster) in clusters.iter().enumerate() {
            if cluster.is_empty() {
                continue;
            }

            let face_ids: Vec<String> = cluster
                .iter()
                .map(|&idx| embeddings[idx].id.clone())
                .collect();

            // Choose representative face (first in cluster)
            let representative_face_id = face_ids[0].clone();

            // Calculate cluster confidence (average similarity to representative)
            let confidence = self.calculate_cluster_confidence(cluster, embeddings);

            let person_group = PersonGroup {
                id: format!("person_{}", cluster_idx),
                name: None,
                face_ids,
                representative_face_id,
                confidence,
                created_at: chrono::Utc::now(),
            };

            person_groups.push(person_group);
        }

        person_groups
    }

    fn calculate_cluster_confidence(
        &self,
        cluster: &[usize],
        embeddings: &[super::face_embedding_ml::EmbeddedFace],
    ) -> f32 {
        if cluster.len() <= 1 {
            return 1.0;
        }

        let mut total_similarity = 0.0;
        let mut pair_count = 0;

        // Calculate average pairwise similarity within cluster
        for i in 0..cluster.len() {
            for j in (i + 1)..cluster.len() {
                let emb1 = &embeddings[cluster[i]].embedding;
                let emb2 = &embeddings[cluster[j]].embedding;

                let similarity = self.cosine_similarity_vectors(emb1, emb2);
                total_similarity += similarity;
                pair_count += 1;
            }
        }

        if pair_count == 0 {
            1.0
        } else {
            total_similarity / pair_count as f32
        }
    }

    fn cosine_similarity_vectors(&self, a: &[f32], b: &[f32]) -> f32 {
        let dot_product: f32 = a.iter().zip(b.iter()).map(|(x, y)| x * y).sum();
        let norm_a: f32 = a.iter().map(|x| x * x).sum::<f32>().sqrt();
        let norm_b: f32 = b.iter().map(|x| x * x).sum::<f32>().sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            0.0
        } else {
            dot_product / (norm_a * norm_b)
        }
    }
}
