# 🎯 OCD - File Organizer

> Effortlessly organize, declutter, and control your digital files with a sleek, powerful desktop app.

---

## 🏁 Get Started

1. **Visit the site** to learn more and download the app.  
2. **Download the executable** for your platform.  
3. **Run the application** and start organizing your files instantly!

---

## 🚀 Features at a Glance

| **Feature**               | **Description**                                                                                   |
|:-------------------------|:-------------------------------------------------------------------------------------------------|
| **Multi-Source Selection**| Add multiple source folders and one destination for maximum flexibility.                          |
| **Smart Organization**    | Organize by year, month, week, date, or file type. "Smart Organize" sorts media by date, others by extension. |
| **Powerful Filtering**    | Exclude files by extension, name patterns, or size range.                                        |
| **Duplicate Handling**    | Skip, move to a "Duplicates" subfolder, or permanently delete duplicates—your choice.            |
| **Operation Preview**     | Simulate file moves with real-time thumbnails before committing changes.                          |
| **Undo (Revert)**         | Instantly undo the last organization operation (except permanent deletions).                      |
| **Progress & Logging**    | Visual progress bar and detailed logs for transparency and troubleshooting.                      |
| **Settings Persistence**  | Saves your preferences in `file_organizer_settings.json` for consistent experience.              |
| **Export Logs**           | Save operation logs as a text file for record-keeping or support.                                |

---

## ✨ How It Works

1. **Launch**  
   Run the Python script to open the OCD - File Organizer window.

2. **Select Source Folders**  
   Click **Add Folder** to pick one or more directories. Use **Clear All** to reset.

3. **Choose Destination Folder**  
   Click **Browse** to select where organized files will go.

4. **Pick Organization Method**  
   - **Smart Organize**: Media by date, others by extension  
   - **By Year**: `2023/`  
   - **By Year-Month** (default): `2023-01/`  
   - **By Year-Month-Date**: `2023-01-15/`  
   - **By Year-Week**: `2024-Week01/`  
   - **By File Type**: `pdf/`, `docx/`, etc.

5. **Set Filters (Optional)**  
   - **Exclude Extensions**: e.g., `tmp, log`  
   - **Exclude Names**: e.g., `temp, backup`  
   - **Size Range**: Min/Max in MB

6. **Handle Duplicates**  
   - **Skip**  
   - **Move to Duplicates**  
   - **Delete Permanently** (use with caution!)

7. **Preview**  
   Click **Preview** to simulate the operation. Thumbnails and logs show what will happen.

8. **Organize**  
   Click **Organize Files** to execute. Watch the progress bar and logs.

9. **Revert**  
   Need to undo? Click **Revert** to restore files (except deleted ones).

10. **Export Logs**  
    Save logs by clicking **Export Log**.

11. **Exit**  
    Close the app when done.

---

## ⚡️ Performance Highlights

| **Factor**            | **Impact**                                                                                 |
|:---------------------|:------------------------------------------------------------------------------------------|
| File I/O Speed        | SSDs > HDDs. Network drives depend on bandwidth.                                          |
| Number of Files       | More files = longer processing time.                                                      |
| File Size             | Large files take longer to hash and move.                                                |
| Duplicate Detection   | MD5 hashing with chunked reads balances speed and accuracy.                              |
| Thumbnail Generation  | Limited to 200×200 px for fast previews.                                                 |
| Threading             | QThreads keep UI responsive during long tasks.                                          |

---

## 🛠️ FAQ & Troubleshooting

| **Question**                         | **Solution**                                                                                 |
|:-----------------------------------|:--------------------------------------------------------------------------------------------|
| Files not moving?                   | Check logs for errors, confirm folders, and ensure you clicked **Organize Files** (not just **Preview**). |
| Organization not as expected?       | Verify organization method and file metadata (creation dates, extensions).                  |
| How are duplicates handled?         | MD5 hash comparison; action depends on your setting (skip, move, delete).                   |
| Can I undo an operation?            | Yes—use **Revert** immediately after organizing (except deleted files).                    |
| Permission denied errors?           | Run as administrator and verify folder permissions.                                        |
| App freezes on big jobs?            | UI uses threads, but huge jobs may slow system. Monitor resources.                          |
| How to export logs?                 | Click **Export Log**.                                                                       |
| Settings not saving?                | Ensure write access to app directory; delete corrupted `file_organizer_settings.json` if needed. |

---

## 💡 Why OCD - File Organizer?

- **Intuitive UI:** Clean, modern interface with real-time feedback.  
- **Flexible:** Organize by date, type, or custom filters.  
- **Safe:** Preview and revert features prevent mistakes.  
- **Fast:** Threaded design keeps things moving smoothly.

---

> **Tame your files. Take control. OCD - File Organizer.**

---
