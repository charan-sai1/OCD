# OCD v0.2 — phone companion + drive catalog

Draft opened 2 Nov 2026 · updated 17 Nov 2026 to match what shipped · target v1 on **Fri 11 Dec 2026**

## 0. Starting point

The iOS spike (see `ocd-spike/VERDICT.md`) proved the four phone capabilities: full library access, 66 ms paging, confirmed delete, **130 MB background upload with matching SHA-256 while the screen was locked**, and Live Photo pair exposure after an iCloud fetch.

Two things remain unproven, and both close inside phase 3 of this plan rather than in a throwaway rig:

- Android media access and OnePlus background behaviour — needs a real dev build.
- 12k paging — the test iPhone had 86 assets; the OnePlus is measured with the real app.

## 1. v1 scope

**In**

- Catalog lives on the drive (`.ocd/`), travels with it, survives disconnection, survives drive-letter changes.
- Any desktop that opens the drive adopts the catalog instead of re-indexing; its own local index is a mirror.
- Device registry: every machine and phone that touched the drive is listed with last-seen and counts.
- Phone: five tabs — Photos, Devices, Backups, Space and Settings — all reachable without a computer.
- Phone: one Photos grid for the camera roll, a drive plugged into the phone, and a computer on the same Wi-Fi, with source chips and keys that route each tile back to its source.
- Phone: read a drive directly through USB or Android's folder picker: index, browse with zoom/video/share, back up the camera roll onto it, and tidy duplicates by content hash.
- Phone: bounded `/24` Wi-Fi scan from Devices when the saved computer address no longer works.
- Phone: send queue with hash verification and resume, verified cleanup, Activity, and free-space figures for both phone and drive.
- Desktop: devices panel, import/deletion history, per-disk catalog toggle, existing gallery unchanged.
- Android + iOS, internal distribution (Play internal / TestFlight).

**Out (deferred, not blocking v1)**

- QR/code pairing and token auth on every data and upload endpoint. Auth is explicitly not a concern right now; the LAN API is unauthenticated and this is a known gap.
- Motion playback UI (pairs are still imported and cataloged).
- Share-sheet extensions, journal/history in the catalog, desktop→phone send, public store listings.

The original draft cut in-app drive browsing as v1.1 work. That decision was reversed: the drive is now read directly from the phone, and the five-tab app is the v1 shape.

## 2. Architecture

```
phone (RN)  ──Wi-Fi HTTP──►  desktop server (Go)  ──►  drive .ocd/catalog.gz
    │                              │                          │
    │  upload (background)         │  read/write              │  travels with disk
    ▼                              ▼                          ▼
camera roll                   local mirror              any other desktop
    │
    └──USB / SAF──► drive (native module: catalog, previews, backup, tidy)
```

Principles:

- **The drive is the source of truth.** The desktop index becomes a cache; the catalog is the portable artifact.
- **Item identity is `volumeId + relative path`.** Drive letters never appear in IDs.
- **Nothing is deleted without a server-verified hash and an audit row.**
- **The phone never receives the whole library unless a drive is attached.** Over Wi-Fi it receives pages of media; direct drive access uses one shared session.
- **Pairing is deferred.** A phone on the same Wi-Fi can reach the API today; this is deliberate for this pass, not a claim of security.

## 3. On-disk format

```
<drive>/.ocd/
  catalog.gz       # current snapshot, gzip JSONL
  catalog.bak      # previous good snapshot
  devices.json     # known devices, last seen, counts
  audit.jsonl      # append-only import/delete records
  volume.json      # fallback id when no native serial exists
  catalog.lock     # best-effort single-writer lock
```

`catalog.gz` line 1 is a header, every later line is one item:

```json
{"format":"ocd-catalog","version":1,"volumeId":"win:1A2B3C4D","label":"Elements","indexVersion":5,"generated":"2026-11-02T13:00:00Z","count":63718}
{"path":"Photos/2024/IMG_0001.HEIC","size":4213948,"mtime":1712345678,"hash":"sha256:...","kind":"image","width":5712,"height":4284,"live":"Photos/2024/IMG_0001.MOV"}
```

- `path` is relative, forward slashes, original case.
- `hash` is optional (only items hashed by dedupe/verification). Badges use metadata; deletion uses a fresh hash.
- `live` names the paired video relative path when present.
- Write path: `catalog.tmp` → `Flush`/`Sync` → rename over `catalog.gz`; previous file kept as `catalog.bak`.
- Read path: validate header + gzip; on any error fall back to `catalog.bak`, then to the local mirror.
- Too-new `version` → read-only mode with a warning, never overwrite.

`devices.json`:

```json
{"id":"dev_a1b2","name":"Charan's PC","os":"windows","role":"desktop","firstSeen":"...","lastSeen":"...","items":63718}
```

Token hashes are not written because pairing is deferred.

`audit.jsonl` one line per operation:

```json
{"ts":"2026-11-02T13:20:00Z","op":"import","device":"dev_phone","volumeId":"win:1A2B3C4D","src":"ios:E2E6.../L0/001","dst":"Phone/2026/11/IMG_0391.MOV","bytes":130472027,"sha256":"28f9...","verified":true}
```

Local mirror: `<data>/catalog/<volumeId>.jsonl.gz`, refreshed after each scan. This is what keeps the UI populated when the drive is unplugged.

## 4. Volume identity

| OS | Source |
| --- | --- |
| Windows | `GetVolumeInformationW` serial (syscall, no CGO) + filesystem name |
| macOS | `diskutil info -plist <mount>` → `VolumeUUID` |
| Linux | `/dev/disk/by-uuid` entry for the mount |
| Fallback | `.ocd/volume.json` with a generated UUID, created once |

`volume.json` is a fallback, not the default: a cloned drive keeps the same file, so native serials are preferred. When the drive is read-only and `.ocd` cannot be written, the catalog runs in memory for the session.

Identity migration: current item IDs derive from absolute paths. Migration builds a `relpath → newId` map from the existing index and rewrites favourites/settings once. `indexVersion` becomes 5; older indexes migrate on load.

## 5. API contract

Auth is deferred: there is no bearer token, cookie or `/api/pair/*` surface in this pass. The routes below are open on the LAN. The pair/device rows are kept as a contract for later, not as shipped endpoints.

| Method | Path | Purpose | Status |
| --- | --- | --- | --- |
| GET | `/api/pair/info` | server name, version, volumes | deferred |
| POST | `/api/pair/start` | desktop UI: create 6-digit code + QR payload, TTL 5 min | deferred |
| POST | `/api/pair` | phone: exchange `{code, device}` for `{token, server, volumes}` | deferred |
| GET | `/api/devices` | registry, online = heartbeat < 2 min | deferred |
| POST | `/api/devices/heartbeat` | phone presence | deferred |
| GET | `/api/catalog?volumeId=` | gzip snapshot (ETag; 304 when unchanged) | shipped |
| POST | `/api/upload/start` | `{volumeId,name,size,mtime,sha256,kind,width,height,duration,livePair}` → `{uploadId, offset, existingPath?}` | shipped |
| PUT | `/api/upload/{id}?offset=` | whole-file body or resume offset | shipped |
| GET | `/api/upload/{id}` | state + bytes received, for resume | shipped |
| POST | `/api/upload/{id}/finish` | server hashes, moves, catalogs, audits → `{verified, sha256, path, itemId}` | shipped |
| POST | `/api/upload/{id}/abort` | discard temp | shipped |
| POST | `/api/import/check` | metadata-only "what is already on the drive" for a batch | shipped |
| POST | `/api/free/record` | audit a device-side delete after verification | shipped |
| GET | `/api/photos`, `/api/t`, `/api/orig` | paged grid, thumbnail, original | shipped |
| GET | `/api/version`, `/api/activity`, `/api/catalogs` | computer version, merged audit log, catalog status | shipped |

Upload lifecycle:

1. Phone computes SHA-256 (8 MB chunks) before sending; `start` carries it.
2. Server reserves `<dst>.part`, returns upload id. If `sha256+name` already exists and is verified, returns `existingPath` and the phone skips the transfer.
3. Phone uploads with the background session; server streams to `.part` with a 10 min idle timeout.
4. `finish` re-hashes, compares, renames into `<Library>/Phone/YYYY/MM/`, writes the catalog entry + audit row.
5. Only `verified: true` items may be deleted on the phone.
6. Any mismatch → one automatic retry, then the item is marked failed; nothing is deleted.

Errors are JSON `{error, code}` with 400/401/409/413/507 semantics; `409` includes the current offset for resume. `401` is reserved for the deferred auth layer.

## 6. Phone app

Stack: Expo SDK 58, plain React state in `App.tsx` (no router or store library), `expo-media-library/legacy`, `expo-file-system/legacy`, `expo-document-picker` for the SAF fallback, `expo-video`, `expo-sharing`, a native Kotlin drive module (`ocd-drive`), and an Android foreground service for backup. Sends are hashed by the server on arrival; drive-side duplicate hashes come from the native module. No client-side JS hash library.

The app has five always-mounted tabs; an inactive screen keeps its state with `display:'none'`:

1. **Photos** — camera roll, attached drive and computer in one newest-first grid. Chips filter by source, long-press or the share button shares the right original. A phone-changed revision reloads the camera roll after a delete elsewhere.
2. **Devices** — computer address and version, manual connect, bounded `/24` scan, and the drive volumes Android has mounted: open, index, refresh, eject, or pick a folder through SAF. The first usable volume opens by itself.
3. **Backups** — back up the camera roll directly onto the drive, tidy duplicate drive copies, send photos to the computer, and see queue counts plus recent Activity.
4. **Space** — free space on the phone and the open drive, and the verified-cleanup list with "free up space".
5. **Settings** — which computer this phone talks to, and the app version.

Badge matching: load the catalog into a `Map` keyed by `size + basename.toLowerCase()`, with a basename-only secondary lookup. Twelve thousand camera-roll assets are matched in well under a second. Metadata is a hint; deletion always re-hashes.

Background upload:

- iOS: `FileSystemSessionType.BACKGROUND` — proven in the spike.
- Android: a foreground service keeps backup running; validate behaviour on the OnePlus in a real dev build.
- Queue entry survives app kill; on relaunch it re-hashes and retries, with idempotency from `sha256` preventing duplicates.

## 7. Desktop changes

New Go packages already in place:

- `engine/internal/volume` — serial/fallback resolution, tests.
- `engine/internal/catalog` — read/write/merge/validate, atomic swap, corrupt fallback, tests.
- `engine/internal/importer` — streaming temp files, hash, destination layout, idempotency.
- `engine/internal/server` — catalog, upload, free-space, activity and gallery handlers.
- `engine/internal/pair` and a devices registry — deferred with auth and pairing.

Existing files touched:

- `engine/internal/media/index.go` — write catalog after a successful build (debounced), load before scanning, `indexVersion = 5`, migration map.
- `engine/internal/server/*` — new endpoints, devices/activity/catalog status JSON, UI additions in `index.html`.
- `engine/main.go` — wiring, `ocd catalog` diagnostics command.
- `docs/index.html`, `README.md`, `capability-map.html` — version, features, five-tab layout.

UI additions, kept in the current visual language: a Devices drawer, an Activity panel, and a catalog status line on the drive card. Auth middleware and the Pair modal are deferred.

## 8. Schedule and status at 17 Nov 2026

| Phase | Dates | Deliverable | Status |
| --- | --- | --- | --- |
| P0 | 2–6 Nov | Contract frozen; `volume` + `catalog` packages; catalog written from the current 63,718-item index | Done: kill mid-write → `.bak` loads; round-trip identical |
| P1 | 9–13 Nov | Load-before-scan, mirror, devices registry, favourite migration, UI status | Done: unplug/restart keeps items; replug logs 0 re-indexed |
| P2 | 16–20 Nov | Pairing + token auth + upload API + audit + `/pair` page | Upload API, audit and activity done; pairing and token auth deliberately deferred |
| P3 | 23–27 Nov | App shell, photos from all three sources, dev builds on both phones | Five-tab shell and grid done; 12k paging and real-device gates pending |
| P4 | 30 Nov–4 Dec | Send queue, verified delete, activity, direct-drive backup and tidy | Code done; device verification pending |
| P5 | 7–11 Dec | Hardening, clean-install run, Play internal + TestFlight, desktop v0.2.0, site/docs | Not started; no new Android build until explicitly requested |

The installed APK predates this work (`a3f3a88`). No EAS build has been started, so the Android native module has not yet been compiled in a release build.

## 9. Test plan

- **Unit:** catalog round-trip, header validation, corrupt/truncated gzip, atomic swap, volume serial fallback, upload name sanitisation, catalog merge, subnet parsing, unified-item merge.
- **Integration (two data dirs):** adopt a drive catalog on a second install; drive letter change; disconnect/reconnect; concurrent writers; read-only drive; disk full.
- **Device:** 12k library paging, 100-photo batch, 130 MB video with lock screen, app kill mid-upload, cancel the delete dialog, iCloud-only asset, Live pair import, Wi-Fi drop, direct-drive backup and tidy.
- **Security:** once pairing lands — unauthenticated LAN access to `/api/photos`, `/api/upload`, `/api/dedupe/quarantine`; replay an expired code; oversized/malformed upload.
- **Regression:** existing gallery, search, dedupe quarantine, self-update, double-click launch, no-arg window.

## 10. Risks

| Risk | Impact | Mitigation |
| --- | --- | --- |
| OnePlus kills Android background upload | High | Foreground service + battery exemption; validate on device; documented keep-awake fallback |
| 12k grid stutter | Medium | Fixed-size `FlatList`, no image prefetch, local-only badge pass, measured gate |
| Phone hashing too slow for 4K video | Medium | 8 MB chunks; benchmark before P4; native hash module as fallback |
| exFAT catalog corruption on yank | Medium | tmp+fsync+rename, `.bak`, header validation, mirror fallback |
| Drive cloned → same fallback UUID | Low | Native serial preferred; warn when `volume.json` is the only id |
| iCloud-only assets stall a send | Medium | Explicit "downloading from iCloud" state; prefetch on Wi-Fi; per-item skip |
| Duplicate import after retry | Medium | `sha256` idempotency on `start`; destination collision check |
| Store review delays | Low | Internal testing only for v1; public listing later |
| LAN API is unauthenticated | High | Keep discovery bounded and explicit; add token auth before any public release |

## 11. Working rules

- Branch `feat/phone-v1`; PR into `main`; no force-push; preserve `docs/`, `gh-pages`, and older project content.
- Every commit authored by the **Charan Sai** account only.
- No hard deletes; quarantine semantics stay.
- Every destructive path writes an audit row before reporting success.
- No real-device checks yet; no EAS build until explicitly asked.
- Version `0.2.0`; `build.ps1 -Version`; update site links, sizes, checksums, and `README` in the same release.
- Real-phone test before any merge that touches upload or delete.

## 12. Decisions

1. **In-app browsing in v1?** Yes, reversed from the original draft. The drive is read from the phone and appears in the unified Photos grid; no web-view fallback is needed.
2. **Motion playback in v1?** No. Pairs are still imported and cataloged; play later.
3. **Public store listing or internal testing?** Internal (Play internal + TestFlight) until the workflow settles.
4. **Approve the six weeks and start with P0?** Approved. Catalog, volume identity, upload API and the phone app have shipped; the remaining gates are device verification and release.
5. **Pairing and token auth?** Deferred and explicitly not a concern for this pass. Revisit before any public release.
6. **New build now?** No. Wait for an explicit request before EAS or real-device checks.
