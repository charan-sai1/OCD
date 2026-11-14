# OCD — photo manager

A lightweight, local-first tool for managing a photo library spread across
portable drives and phones. One small binary, no accounts, no cloud, nothing
deleted without verification.

**Download and overview:** <https://charan-sai1.github.io/OCD/>

It does four jobs:

| Job | What it does |
|-----|--------------|
| **Browse** | Fast gallery over your drives (via the bundled [Photofield](https://github.com/SmilyOrg/photofield) engine — read-only). Open it from the PC, an Android phone, or an iPhone on the same Wi-Fi. |
| **Import** | Copies new media off a phone into dated folders, hashes every byte, verifies the copy, and only *then* wipes the verified originals from the phone. |
| **Back up** | Copies this phone's camera roll straight onto a plugged-in drive, in dated folders, with conditions and a duplicate policy. No computer in the middle. |
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

**Just want to run it?** Download the binary for your machine from the
[latest release](https://github.com/charan-sai1/OCD/releases/latest). There is
nothing to install — one file, no dependencies. The
[download page](https://charan-sai1.github.io/OCD/) lists the exact file names,
sizes, and checksums.

```powershell
# Windows: rename the downloaded file to ocd.exe, then
Unblock-File .\ocd.exe   # only if Windows warned it was "unrecognised"
.\ocd.exe                # opens its own window on http://localhost:8090
```

Double-clicking the file does the same: it starts the server, prints the address,
and opens the page in a window without tabs or an address bar. Keep the console
window open while you use the app; closing it stops it. `ocd serve --port 8090
--data DIR --open` is the explicit form.

The release is not code-signed, so Windows and macOS warn the first time. That
is a missing certificate, not a detection; the download page explains the
one-line fix and how to check the hash. From v0.1.2 onward the app also updates
itself, so this is a one-time step.

The other platforms are the same, with the matching file name: `chmod +x` once,
and on macOS also `xattr -d com.apple.quarantine <file>`.
There is no Android or iPhone app: the phone opens the same page in its browser
(the Import view shows a QR code for it).

**Building from source:**

```powershell
# 1. Build every platform into engine\dist (first time only)
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

## Phone app: on-drive browsing and indexing

`mobile/` is the Expo companion. It works two ways: it talks to the PC over
Wi-Fi, and it can open a drive plugged straight into the phone with no computer
involved.

**Expo Go** can browse a drive that already carries a catalog, read-only, using
Android's document picker. A drive with no catalog still opens, but has no
previews and no dates.

**Development build** adds the native drive module and with it full control:

| | Expo Go | Development build |
|---|---|---|
| Open a drive that already has a catalog | yes | yes |
| Real file sizes and dates | no | yes |
| Write a catalog to a drive | no | yes |
| Build a missing preview on the drive | no | yes |
| Back up the camera roll onto the drive | no | yes |
| Move content duplicates into one folder | no | yes |
| Send to a drive folder on the PC over Wi-Fi | yes | yes |

Build and install it (EAS builds in the cloud, no Android SDK needed):

```powershell
cd mobile
npm install
npx eas build -p android --profile development
```

That development build loads its JavaScript from Metro, so keep
`npx expo start --dev-client` running. For a standalone APK that needs no
computer at all, use the preview profile:

```powershell
npx eas build -p android --profile preview
```

Install the APK on the phone, open **USB Drive**, allow "All files access",
pick the drive, and press **Index drive** once.

### What the phone writes

Only inside `<drive>/.ocd/`, and only when you ask it to:

| File | What it is |
|------|------------|
| `catalog.gz` | Same format the engine writes. Swapped in atomically; the previous copy is kept as `catalog.bak`. |
| `thumbs/<hash>.jpg` | A 400px preview, built for the files you actually open. |
| `volume.json` | Only when the drive exposes no serial. The PC adopts it, so both sides keep one identity. |
| `audit.jsonl` | Append-only record of every file a backup copied or a tidy moved. |

Preview names are hashed from the drive's serial, the path, the size and the
mtime, which is why the phone needs real file metadata. A phone-indexed drive
and a PC-indexed drive therefore produce the same preview names for the same
file, and neither has to rebuild the other's work.

The phone never deletes or modifies a photo or video. It never rewrites a
catalog in place. A failed or interrupted write leaves the previous catalog
readable, because the new file is only renamed into position after it is
completely written and flushed.

The phone does not parse EXIF itself. Instead it asks Android's media database
once for the whole drive: capture date, pixel dimensions and video duration come
from there, with no per-file reads. Anything Android has not indexed falls back
to the file's own modification time. Re-indexing on the phone keeps the dates a
PC already wrote for files that have not changed, so plugging the drive into the
phone does not degrade a richer catalog.

If `catalog.gz` is ever damaged, the app opens `catalog.bak` instead of
pretending the drive was never indexed, and offers to re-index when the drive is
writable. The damaged file is never copied over the good backup.

### Back up the camera roll from the phone

Connect the drive straight to the phone, open **USB Drive**, pick the volume, and
press **Back up phone**. No computer, server, or Wi-Fi is involved.

Choose what to copy:

| Condition | Options |
|-----------|---------|
| Media | Photos and videos, photos only, or videos only |
| Taken | All time, last 7/30/90 days, or this year |
| Source | Any album on the phone, or the whole camera roll |
| Screenshots | Skip them (default) or include them |
| Folder layout | `Phone/YYYY/MM` (default), `YYYY/MM`, or one flat folder |
| If a file is already there | Skip it, keep both, or move the old copy aside |

To skip the rules entirely, press **Choose items…** and tick exact photos and
videos. A picked run copies only those items and still applies the duplicate
policy, folder layout, staging, hashing, read-back verification, catalog update
and audit; the media, date, album and screenshot conditions stop applying because
the choice has already been made. **Whole roll (rules)** switches back.

The duplicate policy is the important one. The app first narrows candidates to the
same **file name and size**, then hashes the bytes on both the phone and the drive.
Only a content match counts as a duplicate, so two different photos that happen to
share a name and size are never skipped or moved by mistake.

- **Skip it** (default) — the drive copy stays, nothing is written.
- **Keep both** — the new copy is written as `name (1).jpg`, so both remain.
- **Move old copy** — the existing drive file is moved to the duplicate archive,
  then the phone copy is written into the dated folder. Nothing is deleted. You
  can keep the default `_OCD Duplicates` root or type a subfolder such as
  `_OCD Duplicates/Old copies`; the app shows the exact destination before the
  run. Only the subfolder changes — it always stays inside `_OCD Duplicates`, so
  it is still excluded from the gallery and every drive scan.

Date ranges use the phone's capture date, falling back to the file's modification
time when the platform has no capture date, so an item is not dropped just because
MediaStore never recorded one.

Every copy is staged in `.ocd-incoming/`, hashed with SHA-256 while it streams,
flushed, renamed into place, then read back and hashed again. A copy that does
not match is removed; the phone original is never touched. The file's capture
date becomes its modification time, so the drive keeps the date the phone shows
even on a filesystem that does not preserve it otherwise.

The run probes the drive before it starts, clears any staged files a killed run
left behind, and checks free space before every file. It stops cleanly only when
the drive is known to be full; an unreadable free-space reading is not treated as
zero. It keeps the screen awake while it works, updates the catalog at the end,
and writes one audit row per copied file. If a page of the camera roll cannot be
listed mid-run, the copies already made still get their audit rows and catalog
entries. If the drive scan hits its item cap or cannot read a folder, the run says
so and merges conservatively into the catalog it already found instead of
rebuilding it from a partial walk. If the run is stopped, the files already copied
stay and the catalog still records them. Running it again simply skips what is
already there.

The summary separates the reasons an item was not copied: verified duplicates
already on the drive, screenshots, items below the minimum size, and failures. A
file whose date could not be restored is still a valid copy and is reported
separately.

This is a foreground-only feature in this build: keep the app open and the drive
plugged in. The phone originals are never deleted automatically.

### Send from the phone to the PC

The other route needs no cable: keep the drive on the computer, start the server,
and connect the app to it over Wi-Fi. Pick items in the phone's camera roll and
choose a drive folder on the PC.

A send is a small queue written to the phone's own storage, not just to the
screen. That matters because the queue is what makes "send, verify, then delete"
survivable:

- Each item is written as **waiting** before it starts and only becomes **sent**
  or **failed** after the desktop answers.
- If the app is closed, killed, or loses Wi-Fi mid-send, the waiting item is
  still waiting on the next launch. The queue banner offers **Resume**, and
  resumes once on its own when the same server and drive are still there.
- Retrying is safe. The desktop keys uploads by file name and content hash and
  answers `existingPath` when the bytes are already on the drive, so a re-sent
  item becomes "already there" instead of a second copy. A killed upload never
  leaves a half-written file among the real ones; the partial file expires.
- **Stop** finishes the item in progress and then pauses, so a large video is not
  cut in half. **Retry** re-queues failed items; **Clear** drops finished rows.
  Failed rows keep their reason so you can see what went wrong.
- The badge on a tile comes from the desktop's verification answer, so a check
  mark means the bytes were hashed on arrival, not merely that the upload ended.

Finished rows are kept for a day so the summary is not empty after a relaunch,
then pruned. Only waiting work runs; nothing partial is ever treated as sent.
This is also foreground-only in this build: keep the app open while it sends.
The phone originals are never deleted automatically.

### Free up space on the phone

Once a copy is verified, the Phone tab shows **Free space**. The screen lists
only items the desktop answered with `verified` after hashing the bytes on
arrival; a name-and-size catalog match is not accepted as proof, because it never
looked inside the file.

The list survives relaunches: the proof is written to the phone (`ocd-verified.json`)
when the send is verified, so the delete step can happen days later. Each row
shows the file, its size, its date and the drive folder that holds it. Select
some or all, and the confirmation states the exact count and byte total. Deleting
asks the phone's own permission dialog, and only after the phone confirms does
the app forget the proof. A failed or partial delete leaves the items listed so
you can try again. Items already removed elsewhere are marked **No longer on
this phone** and can be forgotten in one tap.

Nothing on the drive is touched by this screen. It is the only destructive
action in the app, and it acts on the phone copy only.

### Tidy duplicates on the phone

**Tidy duplicates** finds files whose **bytes** are identical, not merely their
names. It groups the drive's media by size first, so only the groups that could
contain a copy are hashed at all. For each match it keeps the oldest copy, then
the shallowest and shortest path, and moves every other copy to
`_OCD Duplicates/<original path>`.

The moves are same-volume renames, so nothing is copied and nothing is deleted.
The preview lists exactly which files will move before you confirm. If the drive
walk was incomplete, the preview says so and the catalog is merged into the
previous one rather than rebuilt from the partial scan. Each move is audited, the
catalog is updated so the gallery shows one clean library, and the
`_OCD Duplicates` folder is excluded from every scan on both the phone and the
PC. You can restore a file by moving it back, or delete the folder from a
computer when you are sure.

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
