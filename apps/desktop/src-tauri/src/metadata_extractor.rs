// apps/desktop/src-tauri/src/metadata_extractor.rs
// EXIF and XMP metadata extraction for media files

use anyhow::{anyhow, Result};
use chrono::{DateTime, NaiveDateTime, Utc};
use image::{DynamicImage, GenericImageView};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MediaMetadata {
    pub file_path: String,
    pub file_size: u64,
    pub file_modified: DateTime<Utc>,
    
    // Image/Video properties
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub orientation: Option<u32>,
    pub duration: Option<f64>, // For videos
    
    // Camera information
    pub device_make: Option<String>,
    pub device_model: Option<String>,
    pub lens_model: Option<String>,
    pub focal_length: Option<f64>,
    pub aperture: Option<f64>,
    pub iso: Option<u32>,
    pub exposure_time: Option<String>,
    pub flash: Option<bool>,
    
    // Date/Time
    pub date_taken: Option<DateTime<Utc>>,
    pub date_digitized: Option<DateTime<Utc>>,
    pub timezone: Option<String>,
    
    // Location
    pub gps_latitude: Option<f64>,
    pub gps_longitude: Option<f64>,
    pub gps_altitude: Option<f64>,
    
    // Color
    pub dominant_color: Option<String>,
    
    // Additional metadata
    pub title: Option<String>,
    pub description: Option<String>,
    pub keywords: Vec<String>,
    pub rating: Option<u8>,
    
    // Technical
    pub color_space: Option<String>,
    pub bits_per_sample: Option<u8>,
    pub compression: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ExifData {
    pub tags: HashMap<String, ExifValue>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(untagged)]
pub enum ExifValue {
    String(String),
    Integer(i64),
    Float(f64),
    Array(Vec<ExifValue>),
    Rational { numerator: i64, denominator: i64 },
}

pub struct MetadataExtractor;

impl MetadataExtractor {
    pub fn new() -> Self {
        Self
    }

    pub fn extract_metadata(&self, file_path: &Path) -> Result<MediaMetadata> {
        let file_metadata = fs::metadata(file_path)?;
        let file_size = file_metadata.len();
        let file_modified = file_metadata
            .modified()?
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| DateTime::from_timestamp(d.as_secs() as i64, 0).unwrap_or_else(|| Utc::now()))
            .unwrap_or_else(|_| Utc::now());

        // Try to load image for basic properties
        let (width, height) = if let Ok(img) = image::open(file_path) {
            let (w, h) = img.dimensions();
            (Some(w), Some(h))
        } else {
            (None, None)
        };

        // Extract EXIF data
        let exif_data = self.extract_exif(file_path)?;

        // Parse EXIF into structured metadata
        let mut metadata = MediaMetadata {
            file_path: file_path.to_string_lossy().to_string(),
            file_size,
            file_modified,
            width,
            height,
            orientation: self.parse_orientation(&exif_data),
            duration: None, // Would need video parsing
            device_make: self.parse_make(&exif_data),
            device_model: self.parse_model(&exif_data),
            lens_model: self.parse_lens_model(&exif_data),
            focal_length: self.parse_focal_length(&exif_data),
            aperture: self.parse_aperture(&exif_data),
            iso: self.parse_iso(&exif_data),
            exposure_time: self.parse_exposure_time(&exif_data),
            flash: self.parse_flash(&exif_data),
            date_taken: self.parse_date_taken(&exif_data),
            date_digitized: self.parse_date_digitized(&exif_data),
            timezone: self.parse_timezone(&exif_data),
            gps_latitude: self.parse_gps_latitude(&exif_data),
            gps_longitude: self.parse_gps_longitude(&exif_data),
            gps_altitude: self.parse_gps_altitude(&exif_data),
            dominant_color: None, // Would need image analysis
            title: self.parse_title(&exif_data),
            description: self.parse_description(&exif_data),
            keywords: self.parse_keywords(&exif_data),
            rating: self.parse_rating(&exif_data),
            color_space: self.parse_color_space(&exif_data),
            bits_per_sample: self.parse_bits_per_sample(&exif_data),
            compression: self.parse_compression(&exif_data),
        };

        // Extract dominant color if image loaded successfully
        if let Ok(img) = image::open(file_path) {
            metadata.dominant_color = self.extract_dominant_color(&img);
        }

        Ok(metadata)
    }

    fn extract_exif(&self, file_path: &Path) -> Result<ExifData> {
        let file = std::fs::File::open(file_path)?;
        let mut bufreader = std::io::BufReader::new(file);
        let exifreader = kamadak_exif::Reader::new();
        
        let exif = exifreader.read_from_container(&mut bufreader)?;
        
        let mut tags = HashMap::new();
        
        for field in exif.fields() {
            let tag_name = format!("{:?}", field.tag);
            let value = self.convert_exif_value(&field.value);
            tags.insert(tag_name, value);
        }

        Ok(ExifData { tags })
    }

    fn convert_exif_value(&self, value: &kamadak_exif::Value) -> ExifValue {
        use kamadak_exif::Value;
        
        match value {
            Value::Ascii(strings) => {
                if let Some(first) = strings.first() {
                    ExifValue::String(first.to_string())
                } else {
                    ExifValue::String(String::new())
                }
            }
            Value::Byte(bytes) => {
                ExifValue::String(String::from_utf8_lossy(bytes).to_string())
            }
            Value::Short(shorts) => {
                if let Some(&first) = shorts.first() {
                    ExifValue::Integer(first as i64)
                } else {
                    ExifValue::Integer(0)
                }
            }
            Value::Long(longs) => {
                if let Some(&first) = longs.first() {
                    ExifValue::Integer(first as i64)
                } else {
                    ExifValue::Integer(0)
                }
            }
            Value::Rational(rationals) => {
                if let Some(first) = rationals.first() {
                    ExifValue::Rational {
                        numerator: first.num as i64,
                        denominator: first.denom as i64,
                    }
                } else {
                    ExifValue::Rational {
                        numerator: 0,
                        denominator: 1,
                    }
                }
            }
            Value::SByte(bytes) => {
                if let Some(&first) = bytes.first() {
                    ExifValue::Integer(first as i64)
                } else {
                    ExifValue::Integer(0)
                }
            }
            Value::SShort(shorts) => {
                if let Some(&first) = shorts.first() {
                    ExifValue::Integer(first as i64)
                } else {
                    ExifValue::Integer(0)
                }
            }
            Value::SLong(longs) => {
                if let Some(&first) = longs.first() {
                    ExifValue::Integer(first as i64)
                } else {
                    ExifValue::Integer(0)
                }
            }
            Value::SRational(rationals) => {
                if let Some(first) = rationals.first() {
                    ExifValue::Rational {
                        numerator: first.num as i64,
                        denominator: first.denom as i64,
                    }
                } else {
                    ExifValue::Rational {
                        numerator: 0,
                        denominator: 1,
                    }
                }
            }
            Value::Undefined(bytes) => {
                ExifValue::String(String::from_utf8_lossy(bytes).to_string())
            }
            _ => ExifValue::String(String::new()),
        }
    }

    // ============================================================================
    // EXIF Parsers
    // ============================================================================

    fn parse_orientation(&self, exif: &ExifData) -> Option<u32> {
        exif.tags.get("Orientation")
            .and_then(|v| match v {
                ExifValue::Integer(i) => Some(*i as u32),
                _ => None,
            })
    }

    fn parse_make(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("Make")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.trim().to_string()),
                _ => None,
            })
    }

    fn parse_model(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("Model")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.trim().to_string()),
                _ => None,
            })
    }

    fn parse_lens_model(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("LensModel")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.trim().to_string()),
                _ => None,
            })
    }

    fn parse_focal_length(&self, exif: &ExifData) -> Option<f64> {
        exif.tags.get("FocalLength")
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    Some(*numerator as f64 / *denominator as f64)
                }
                ExifValue::Float(f) => Some(*f),
                ExifValue::Integer(i) => Some(*i as f64),
                _ => None,
            })
    }

    fn parse_aperture(&self, exif: &ExifData) -> Option<f64> {
        exif.tags.get("FNumber")
            .or_else(|| exif.tags.get("ApertureValue"))
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    Some(*numerator as f64 / *denominator as f64)
                }
                ExifValue::Float(f) => Some(*f),
                ExifValue::Integer(i) => Some(*i as f64),
                _ => None,
            })
    }

    fn parse_iso(&self, exif: &ExifData) -> Option<u32> {
        exif.tags.get("ISOSpeedRatings")
            .or_else(|| exif.tags.get("PhotographicSensitivity"))
            .and_then(|v| match v {
                ExifValue::Integer(i) => Some(*i as u32),
                ExifValue::Float(f) => Some(*f as u32),
                _ => None,
            })
    }

    fn parse_exposure_time(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("ExposureTime")
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    if *denominator == 0 {
                        None
                    } else if *numerator == 1 {
                        Some(format!("1/{}", denominator))
                    } else {
                        Some(format!("{}/{}", numerator, denominator))
                    }
                }
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })
    }

    fn parse_flash(&self, exif: &ExifData) -> Option<bool> {
        exif.tags.get("Flash")
            .and_then(|v| match v {
                ExifValue::Integer(i) => Some(*i != 0),
                _ => None,
            })
    }

    fn parse_date_taken(&self, exif: &ExifData) -> Option<DateTime<Utc>> {
        let date_str = exif.tags.get("DateTimeOriginal")
            .or_else(|| exif.tags.get("DateTime"))
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })?;
        
        self.parse_exif_date(&date_str)
    }

    fn parse_date_digitized(&self, exif: &ExifData) -> Option<DateTime<Utc>> {
        let date_str = exif.tags.get("DateTimeDigitized")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })?;
        
        self.parse_exif_date(&date_str)
    }

    fn parse_timezone(&self, exif: &ExifData) -> Option<String> {
        // Timezone offset is sometimes stored in OffsetTimeOriginal
        exif.tags.get("OffsetTimeOriginal")
            .or_else(|| exif.tags.get("OffsetTime"))
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })
    }

    fn parse_exif_date(&self, date_str: &str) -> Option<DateTime<Utc>> {
        // EXIF date format: "2023:10:15 14:30:00"
        let cleaned = date_str.replace(":", "-").replace("  ", " ");
        
        // Try parsing with different formats
        let formats = [
            "%Y-%m-%d %H:%M:%S",
            "%Y-%m-%d %H:%M:%S%.f",
            "%Y-%m-%dT%H:%M:%S",
            "%Y-%m-%dT%H:%M:%S%.f",
        ];
        
        for format in &formats {
            if let Ok(naive) = NaiveDateTime::parse_from_str(&cleaned, format) {
                return Some(DateTime::from_naive_utc_and_offset(naive, Utc));
            }
        }
        
        None
    }

    fn parse_gps_latitude(&self, exif: &ExifData) -> Option<f64> {
        let lat_ref = exif.tags.get("GPSLatitudeRef")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })?;
        
        let lat_value = exif.tags.get("GPSLatitude")
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    Some(*numerator as f64 / *denominator as f64)
                }
                _ => None,
            })?;
        
        let multiplier = if lat_ref == "S" { -1.0 } else { 1.0 };
        Some(lat_value * multiplier)
    }

    fn parse_gps_longitude(&self, exif: &ExifData) -> Option<f64> {
        let lon_ref = exif.tags.get("GPSLongitudeRef")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })?;
        
        let lon_value = exif.tags.get("GPSLongitude")
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    Some(*numerator as f64 / *denominator as f64)
                }
                _ => None,
            })?;
        
        let multiplier = if lon_ref == "W" { -1.0 } else { 1.0 };
        Some(lon_value * multiplier)
    }

    fn parse_gps_altitude(&self, exif: &ExifData) -> Option<f64> {
        exif.tags.get("GPSAltitude")
            .and_then(|v| match v {
                ExifValue::Rational { numerator, denominator } => {
                    Some(*numerator as f64 / *denominator as f64)
                }
                ExifValue::Float(f) => Some(*f),
                ExifValue::Integer(i) => Some(*i as f64),
                _ => None,
            })
    }

    fn parse_title(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("ImageDescription")
            .or_else(|| exif.tags.get("XPTitle"))
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.trim().to_string()),
                _ => None,
            })
    }

    fn parse_description(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("ImageDescription")
            .and_then(|v| match v {
                ExifValue::String(s) => Some(s.trim().to_string()),
                _ => None,
            })
    }

    fn parse_keywords(&self, exif: &ExifData) -> Vec<String> {
        // Keywords might be in XPKeywords or other tags
        exif.tags.get("XPKeywords")
            .and_then(|v| match v {
                ExifValue::String(s) => {
                    Some(s.split(';').map(|k| k.trim().to_string()).collect())
                }
                _ => None,
            })
            .unwrap_or_default()
    }

    fn parse_rating(&self, exif: &ExifData) -> Option<u8> {
        exif.tags.get("Rating")
            .and_then(|v| match v {
                ExifValue::Integer(i) => Some(*i as u8),
                ExifValue::Float(f) => Some(*f as u8),
                _ => None,
            })
    }

    fn parse_color_space(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("ColorSpace")
            .and_then(|v| match v {
                ExifValue::Integer(1) => Some("sRGB".to_string()),
                ExifValue::Integer(65535) => Some("Uncalibrated".to_string()),
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })
    }

    fn parse_bits_per_sample(&self, exif: &ExifData) -> Option<u8> {
        exif.tags.get("BitsPerSample")
            .and_then(|v| match v {
                ExifValue::Integer(i) => Some(*i as u8),
                _ => None,
            })
    }

    fn parse_compression(&self, exif: &ExifData) -> Option<String> {
        exif.tags.get("Compression")
            .and_then(|v| match v {
                ExifValue::Integer(1) => Some("Uncompressed".to_string()),
                ExifValue::Integer(6) => Some("JPEG".to_string()),
                ExifValue::String(s) => Some(s.clone()),
                _ => None,
            })
    }

    // ============================================================================
    // Image Analysis
    // ============================================================================

    fn extract_dominant_color(&self, img: &DynamicImage) -> Option<String> {
        // Resize to small size for faster processing
        let small = img.resize_exact(50, 50, image::imageops::FilterType::Nearest);
        let rgb = small.to_rgb8();
        
        // Calculate average color
        let mut r_sum = 0u64;
        let mut g_sum = 0u64;
        let mut b_sum = 0u64;
        let pixel_count = rgb.width() * rgb.height();
        
        for pixel in rgb.pixels() {
            r_sum += pixel[0] as u64;
            g_sum += pixel[1] as u64;
            b_sum += pixel[2] as u64;
        }
        
        if pixel_count > 0 {
            let r = (r_sum / pixel_count as u64) as u8;
            let g = (g_sum / pixel_count as u64) as u8;
            let b = (b_sum / pixel_count as u64) as u8;
            
            Some(format!("#{:02x}{:02x}{:02x}", r, g, b))
        } else {
            None
        }
    }

    // ============================================================================
    // Utility Methods
    // ============================================================================

    pub fn is_image_file(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            matches!(ext.as_str(), "jpg" | "jpeg" | "png" | "gif" | "bmp" | "webp" | "tiff" | "tif" | "heic" | "heif")
        } else {
            false
        }
    }

    pub fn is_video_file(&self, path: &Path) -> bool {
        if let Some(ext) = path.extension() {
            let ext = ext.to_string_lossy().to_lowercase();
            matches!(ext.as_str(), "mp4" | "mov" | "avi" | "mkv" | "wmv" | "flv" | "webm" | "m4v" | "3gp")
        } else {
            false
        }
    }
}

impl Default for MetadataExtractor {
    fn default() -> Self {
        Self::new()
    }
}
