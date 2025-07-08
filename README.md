# 🎯 OCD - File Organizer

> **Effortlessly organize, declutter, and control your digital files with a beautiful, powerful desktop app.**

---

## 🚀 Features at a Glance

| **Feature**                | **Description**                                                                                                                                         |
|:-------------------------- |:-------------------------------------------------------------------------------------------------------------------------------------------------------|
| **Multi-Source Selection** | Add multiple source folders and one destination for maximum flexibility.                                                                                |
| **Smart Organization**     | Organize by year, month, week, date, or file type. "Smart Organize" sorts media by date, others by extension.                                          |
| **Powerful Filtering**     | Exclude by extension, name, or size. Fine-tune exactly what gets organized.                                                                            |
| **Duplicate Handling**     | Skip, move to a "Duplicates" subfolder, or permanently delete duplicates—your choice.                                                                  |
| **Operation Preview**      | See exactly what will happen before you commit. Real-time thumbnail previews for images and videos.                                                     |
| **Undo (Revert)**          | Instantly undo your last organization operation (except permanent deletions).                                                                          |
| **Progress & Logging**     | Visual progress bar and detailed logs for transparency and troubleshooting.                                                                            |
| **Settings Persistence**   | All your preferences saved in `file_organizer_settings.json`—never set up twice.                                                                      |
| **Export Logs**            | Save operation logs as a text file for your records or support.                                                                                        |

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
   - **Delete Permanently** (careful!)

7. **Preview**  
   Click **Preview** to simulate the operation. Thumbnails and logs show what will happen.

8. **Organize**  
   Happy with the preview? Click **Organize Files**. Watch the progress bar and logs.

9. **Revert**  
   Need to undo? Click **Revert** to restore files (except deleted ones).

10. **Export Logs**  
    Click **Export Log** to save the operation history.

11. **Exit**  
    Click **Exit** to close the app.

---

## ⚡️ Performance Highlights

- **Threaded Operations**: UI stays responsive, even with thousands of files.
- **Efficient Hashing**: MD5 with 8KB chunk reads for duplicate detection.
- **Smart Thumbnails**: 200x200px max for fast previews.
- **Optimized for SSDs**, but works on HDDs and network drives.

| **Factor**              | **Impact**                                                                                 |
|:----------------------- |:------------------------------------------------------------------------------------------|
| File I/O Speed          | SSDs > HDDs. Network drives depend on bandwidth.                                          |
| Number of Files         | More files = longer processing time.                                                      |
| File Size               | Large files take longer to hash/move.                                                     |
| Duplicate Detection     | Fast for most use cases; chunked reads for big files.                                     |
| Thumbnail Generation    | Lightweight, but processing many large images may add time.                               |
| Python’s GIL            | QThreads keep UI smooth; I/O operations often release the GIL.                            |

---

## 🛠️ FAQ & Troubleshooting

| **Question**                                 | **Solution**                                                                                                                                  |
|:---------------------------------------------|:---------------------------------------------------------------------------------------------------------------------------------------------|
| Files not moving?                            | Check the log for errors, confirm folders, and ensure you clicked **Organize Files** (not just **Preview**).                                  |
| Not organized as expected?                   | Double-check your method and file metadata (creation dates, extensions).                                                                      |
| How are duplicates handled?                  | MD5 hash comparison; action depends on your setting (skip, move, delete).                                                                    |
| Can I undo an operation?                     | Yes—use **Revert** immediately after organizing (except deleted files).                                                                       |
| Permission denied errors?                    | Run as administrator and check folder permissions.                                                                                           |
| App freezes on big jobs?                     | UI uses threads, but huge jobs may slow things down. Monitor system resources.                                                               |
| How to export logs?                          | Click **Export Log**.                                                                                                                        |
| Settings not saving?                         | Ensure write access to app directory; delete a corrupted `file_organizer_settings.json` if needed.                                            |

---

## 💡 Why OCD - File Organizer?

- **Intuitive**: Clean, modern interface with real-time feedback.
- **Flexible**: Organize by date, type, or custom filters.
- **Safe**: Preview and revert features prevent mistakes.
- **Fast**: Threaded design keeps things moving.

---

## 🏁 Get Started

1. Install Python and PyQt6.
2. Download the script.
3. Run and enjoy a clutter-free digital life!

---

> **Tame your files. Take control. OCD - File Organizer.**

---
