use std::fs;
use std::path::Path;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone)]
pub struct FileNode {
    pub path: String,
    pub name: String,
    pub r#type: String,
    pub size: Option<u64>,
    pub children: Option<Vec<FileNode>>,
}

#[tauri::command]
pub fn scan_directory(path: &str) -> Result<FileNode, String> {
    let path = Path::new(path);
    if !path.exists() {
        return Err("Path does not exist".to_string());
    }
    
    fn build_tree(p: &Path) -> Result<FileNode, String> {
        let metadata = p.metadata().map_err(|e| e.to_string())?;
        let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
        let path_str = p.to_string_lossy().to_string();
        
        if metadata.is_dir() {
            let children = fs::read_dir(p)
                .map_err(|e| e.to_string())?
                .filter_map(|e| e.ok())
                .map(|e| build_tree(&e.path()))
                .collect::<Result<Vec<_>, _>>()?;
            
            Ok(FileNode {
                path: path_str,
                name,
                r#type: "directory".to_string(),
                size: None,
                Some(children),
            })
        } else {
            Ok(FileNode {
                path: path_str,
                name,
                r#type: "file".to_string(),
                size: Some(metadata.len()),
                children: None,
            })
        }
    }
    
    build_tree(path)
}

#[tauri::command]
pub fn read_file_content(path: &str) -> Result<String, String> {
    fs::read_to_string(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn write_file_content(path: &str, content: &str) -> Result<(), String> {
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_directory(path: &str) -> Result<(), String> {
    fs::create_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn delete_path(path: &str) -> Result<(), String> {
    let p = Path::new(path);
    if p.is_dir() {
        fs::remove_dir_all(p).map_err(|e| e.to_string())
    } else {
        fs::remove_file(p).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn copy_path(source: &str, destination: &str) -> Result<(), String> {
    fs::copy(source, destination).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_file_metadata(path: &str) -> Result<FileNode, String> {
    let p = Path::new(path);
    let metadata = p.metadata().map_err(|e| e.to_string())?;
    let name = p.file_name().unwrap_or_default().to_string_lossy().to_string();
    let path_str = p.to_string_lossy().to_string();
    
    Ok(FileNode {
        path: path_str,
        name,
        r#type: if metadata.is_dir() { "directory".to_string() } else { "file".to_string() },
        size: Some(metadata.len()),
        children: None,
    })
}
