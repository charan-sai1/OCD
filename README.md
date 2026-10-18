# OCD — photo manager

A lightweight, local-first tool for managing a photo library spread across
portable drives and phones. One small binary, no accounts, no cloud, nothing
deleted without verification.

It does three jobs:

| Job | What it does |
|-----|--------------|
| **Browse** | Fast gallery over your drives (via the bundled [Photofield](https://github.com/SmilyOrg/photofield) engine — read-only). Open it from the PC, an Android phone, or an iPhone on the same Wi-Fi. |
| **Import** | Copies new media off a phone into dated folders, hashes every byte, verifies the copy, and only *then* wipes the verified originals from the phone. |
| **Duplicates** | Finds duplicate files by **content** (not filename) and moves redundant copies to a quarantine folder — never a hard delete. |

---

## Layout

```
ocd-app/
├─ start.ps1            one-click launcher (OCD Manager + gallery)
├─ stop.ps1             stop everything
├─ allow-lan.ps1        open the firewall so phones can connect (run as admin)
├─ README.md
├─ photofield/          Photofield engine (browsing)
│   └─ photofield.exe
├─ data/                Photofield config + thumbnail/metadata cache
│   ├─ configuration.yaml
│   └─ *.db
├─ engine/              OCD Manager source (Go)
│   ├─ main.go
│   ├─ internal/
│   │   ├─ hashx/       SHA-256 helpers (full + partial)
│   │   ├─ dedupe/      duplicate detection + quarantine
│   │   ├─ importer/    phone import + verify + wipe
│   │   └─ server/      web UI + JSON API
│   │       ├─ index.html    the whole UI
│   │       ├─ fs.go         folder browser API
│   │       ├─ libraries.go  saved folders (persisted)
│   │       ├─ photos.go     photo grid feed + image proxy
│   │       └─ photofield.go gallery config sync
│   ├─ build.ps1/.sh    cross-compile for all platforms
│   └─ dist/            built binaries
└─ engine-data/         OCD Manager data
    ├─ libraries.json   your saved folders
    ├─ *index-*.json    duplicate indexes (content / name)
    └─ quarantine/      default place for moved duplicates
```

## Quick start

```powershell
# 1. Build (first time only)
cd engine; .\build.ps1

# 2. Launch
cd ..; .\start.ps1
```

The manager opens at **http://localhost:8090** — no paths to type; everything is
chosen with a built-in folder browser.

The UI is a single photo-library app with five views (deep-linkable, e.g.
`http://localhost:8090/#import`):

**Photos (the main page)** — one grid of everything across your saved folders:

- Thumbnails are grouped by day with sticky date headers, newest first.
- Filter chips switch between **All photos** and a single folder.
- Click any photo for a full-screen view; arrow keys move through the library,
  `Esc` closes.
- Images are served by the gallery engine and proxied through the manager, so
  only port 8090 is needed (handy from a phone).
- If the gallery engine is stopped, the page offers a **Start gallery** button.

**Folders** — the saved folders:

- Each one shows a cover photo, its path, whether it is **Connected** or
  **Not connected**, and how many photos it holds.
- **Add folder** saves a new folder using the built-in browser; the bin icon
  removes it (your files are never touched).
- On the first run the list is seeded from the drives already configured for
  Photofield, so nothing starts empty.
- **Refresh counts** re-scans the folders and updates the photo totals.

**Import** — copy a phone onto a drive, with its duplicate settings:

- **From / To** — click to browse for the source and destination.
- **Duplicates → Skip what I already have** (default) or **Keep every copy**.
- **How to compare → Content · exact** (reads the file, catches renamed copies)
  or **Name + size · fast** (instant, but a renamed copy slips through).
- **Remove from the phone after verifying** — off by default; deletes each
  original only after the copy on the drive has been re-read and matched.
- **Import photos** or **Preview first (safe)**.

**Duplicates** — add folders with the browser (drives like `E:` and `F:` are
offered as one-click chips), hit **Find duplicates**, then **Preview what moves**
/ **Move to quarantine**. The copies are dropped flat into the quarantine folder
you pick, so point it at a folder of its own; the result names the folder and an
example file. Moving clears the scan, so run **Find duplicates** again before a
second move.

**Setup** — shows which optional helper tools are installed, and how to get them.

**Open gallery** (top right) opens the full Photofield gallery for the same
folders in a new tab.

## Safety model (nothing is lost)

1. **Import never keeps a copy unless it verified it.** Each file is streamed to
   a temp file while being hashed, moved into place, then **re-read from the
   destination** and re-hashed. The originals are only deleted when the two
   hashes match. A verification failure means the phone copy is left alone.
2. **No duplicate storage.** A persistent content-hash index of the destination
   means media already on the drive is skipped — never copied twice.
3. **Deleting from the phone is opt-in.** The CLI default is copy-only; the wipe
   step happens only with `--delete` or the "wipe" mode in the UI.
4. **Dedupe quarantines, it does not delete.** Redundant copies are moved
   **straight into the quarantine folder you pick**, keeping only their own file
   name — no copy of the original folder structure:

   ```
   F:\test\sub\a.jpg   moved into D:\quarantine   ->   D:\quarantine\a.jpg
   ```

   If that name is taken, the usual ` (1)`, ` (2)` suffix is added. Every move is
   re-checked afterwards (source gone, destination present) before it is counted,
   so the numbers reported are the bytes that really moved.

## Command line

```powershell
# Find duplicates by content
ocd dedupe scan --dir E:/ --dir F:/ --min-size 1024 --json report.json

# Preview what would move (safe)
ocd dedupe quarantine --report report.json --quarantine D:/quarantine --dry-run

# Actually move the redundant copies
ocd dedupe quarantine --report report.json --quarantine D:/quarantine

# Import (copy + verify, keep the phone)
ocd import --source "E:\PHONE\DCIM" --dest "E:/Photos" --data .\engine-data

# Import and wipe the phone once verified
ocd import --source "E:\PHONE\DCIM" --dest "E:/Photos" --delete

# Duplicate settings: skip what's already there, compare by filename+size (fast)
ocd import --source "E:\PHONE\DCIM" --dest "E:/Photos" --dup-check name --dup-action skip

# Keep every copy instead of skipping
ocd import --source "E:\PHONE\DCIM" --dest "E:/Photos" --dup-action copy

# Import straight from an Android phone over USB debugging
ocd import --adb --source "<serial>|/sdcard/DCIM" --dest "E:/Photos"

# Run the web UI
ocd serve --port 8090 --data .\engine-data
```

`ocd --help` (or running it with no arguments) prints the full usage.

## Phones

### Android (recommended, fully supported)
1. On the phone: **Settings → About → tap Build number 7×**, then
   **Developer options → USB debugging: on**.
2. Plug in USB, accept the "Allow USB debugging?" prompt.
3. Install platform-tools (`adb`) and put it on `PATH`.
   ```powershell
   winget install Google.PlatformTools
   ```
4. In the UI choose **Android (adb)** and enter `/sdcard/DCIM`
   (or `serial|/sdcard/DCIM` when several devices are connected).

Copy + verify + wipe works end-to-end here.

### iPhone
iOS exposes the Camera Roll over USB, but third-party tools cannot reliably
delete from it, so the flow is **import + verify, then delete in Photos**.

```powershell
winget install libimobiledevice.ifuse     # ifuse + idevice_id
ifuse X:\                                 # mount the Camera Roll
ocd import --source X:\ --dest "E:/Photos" --delete   # --delete is a no-op on iOS
```

For full iPhone wipe automation you'd add a small step in the phone's Photos app
after the verified import.

## Browsing from a phone

```powershell
# once, as Administrator
.\allow-lan.ps1
```

Then on the phone open `http://<PC-IP>:8090` (find the IP with `ipconfig`).
The gallery itself is on port **8080**.

## Optional helper tools

These make browsing better but are not required:

| Tool | Why | Install |
|------|-----|---------|
| `ffmpeg` | video thumbnails | `winget install Gyan.FFmpeg` |
| `exiftool` | rich photo/video metadata | `winget install OliverBetz.ExifTool` |
| `adb` | Android import | `winget install Google.PlatformTools` |
| `ifuse` | iPhone import | `winget install libimobiledevice.ifuse` |

## Cross-platform

The engine is pure Go (no cgo), so `engine/build.ps1` / `build.sh` produce a
single static binary for Windows, Linux, and macOS — x86-64 and ARM64. Drop the
right one on a NAS and run `ocd serve`; the same UI and APIs are available from
any browser on the network.
