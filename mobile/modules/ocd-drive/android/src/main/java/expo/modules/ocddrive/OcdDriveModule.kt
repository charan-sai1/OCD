package expo.modules.ocddrive

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.media.ExifInterface
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
import android.provider.MediaStore
import android.provider.Settings
import android.util.Base64
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import kotlin.math.max

/**
 * Filesystem access to a removable drive over a real mount point instead of
 * SAF. SAF cannot stat a file, cannot rename a catalog atomically and cannot
 * pull a frame out of a video; a mounted volume can do all three, which is what
 * makes the phone able to index and write a drive on its own.
 *
 * Every path handed to this module is an absolute filesystem path. Callers are
 * expected to have obtained one from [listVolumes] and to hold all-files access.
 */
class OcdDriveModule : Module() {
  private val ctx: Context
    get() = requireNotNull(appContext.reactContext) { "React context is gone" }

  private var volumeReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("OcdDrive")

    // Android mounts partitions on a plugged-in disk one at a time, and the
    // second one can finish seconds after the app is already on screen. The
    // screen listens for this and re-lists instead of making the user restart.
    Events("onVolumeChange")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      val filter = IntentFilter().apply {
        addAction(Intent.ACTION_MEDIA_MOUNTED)
        addAction(Intent.ACTION_MEDIA_UNMOUNTED)
        addAction(Intent.ACTION_MEDIA_EJECT)
        addAction(Intent.ACTION_MEDIA_REMOVED)
        addAction(Intent.ACTION_MEDIA_BAD_REMOVAL)
      }
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context?, intent: Intent?) {
          sendEvent("onVolumeChange", mapOf("action" to (intent?.action ?: "")))
        }
      }
      volumeReceiver = receiver
      runCatching {
        if (Build.VERSION.SDK_INT >= 33) {
          context.registerReceiver(receiver, filter, Context.RECEIVER_NOT_EXPORTED)
        } else {
          context.registerReceiver(receiver, filter)
        }
      }
    }

    OnDestroy {
      volumeReceiver?.let { receiver ->
        runCatching { appContext.reactContext?.unregisterReceiver(receiver) }
      }
      volumeReceiver = null
    }

    Function("hasAllFilesAccess") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        Environment.isExternalStorageManager()
      } else {
        true
      }
    }

    Function("requestAllFilesAccess") {
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        val intent = Intent(
          Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
          Uri.parse("package:${ctx.packageName}")
        )
        appContext.currentActivity?.startActivity(intent)
      }
      true
    }

    // Every volume the platform knows about, mounted or not. The caller decides
    // what is usable, and can tell the user when a plugged-in disk has a
    // partition Android never gave a mount point.
    AsyncFunction("listVolumes") {
      val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      sm.storageVolumes.map { v ->
        val path = volumePath(v) ?: ""
        mapOf(
          "uuid" to (v.uuid ?: ""),
          "label" to runCatching { v.getDescription(ctx) }.getOrDefault(""),
          "path" to path,
          "primary" to v.isPrimary,
          "removable" to v.isRemovable,
          "state" to v.state,
          "writable" to (path.isNotEmpty() && File(path).canWrite())
        )
      }
    }

    /**
     * Walks a drive and writes one JSON object per media file to a cache file,
     * so 60k entries never have to cross the bridge. Sizes and mtimes are real,
     * which is what thumbnail names are derived from.
     */
    AsyncFunction("scan") { root: String, maxEntries: Int ->
      val outFile = File(ctx.cacheDir, "ocd-scan-${System.currentTimeMillis()}.jsonl")
      var count = 0
      var truncated = false

      FileOutputStream(outFile).buffered().use { out ->
        val stack = java.util.ArrayDeque<Pair<File, String>>()
        stack.addLast(File(root) to "")
        while (stack.isNotEmpty()) {
          val (dir, prefix) = stack.removeLast()
          val children = dir.listFiles() ?: continue
          var stop = false
          for (f in children) {
            val name = f.name
            val rel = if (prefix.isEmpty()) name else "$prefix/$name"
            if (f.isDirectory) {
              // Hidden folders hold machinery (.ocd, .Trashes, .Spotlight-V100)
              // and would make the scan loop over previews as if they were media.
              if (!skipDir(name)) stack.addLast(f to rel)
              continue
            }
            if (!isMedia(name) || junkFile(name)) continue
            val obj = JSONObject()
            obj.put("p", rel)
            obj.put("s", f.length())
            obj.put("m", f.lastModified() / 1000L)
            obj.put("k", if (isVideo(name)) "video" else "image")
            out.write((obj.toString() + "\n").toByteArray(Charsets.UTF_8))
            count++
            if (count >= maxEntries) {
              truncated = true
              stop = true
              break
            }
          }
          if (stop) break
        }
      }

      mapOf(
        "path" to outFile.absolutePath,
        "count" to count,
        "truncated" to truncated
      )
    }

    // Names only: the previews folder holds one flat set of files, and
    // checking what is already there must not cost a stat per item.
    AsyncFunction("listNames") { path: String ->
      File(path).list()?.toList() ?: emptyList<String>()
    }

    /**
     * Capture metadata for everything MediaStore has indexed on this volume.
     * One query covers the whole drive, which is why a phone index can carry
     * dates and dimensions without opening tens of thousands of files one at
     * a time. Anything the platform has not indexed is simply missing; the
     * caller keeps the file's own mtime for those.
     */
    AsyncFunction("mediaMetadata") { root: String ->
      val outFile = File(ctx.cacheDir, "ocd-meta-${System.currentTimeMillis()}.jsonl")
      var count = 0
      val rootPath = root.trimEnd('/')

      try {
        val resolver = ctx.contentResolver
        val volumeName = mediaStoreVolumeName(rootPath)
        val uri = MediaStore.Files.getContentUri(volumeName ?: "external")
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q

        val columns = mutableListOf(
          MediaStore.MediaColumns.DATE_TAKEN,
          MediaStore.MediaColumns.WIDTH,
          MediaStore.MediaColumns.HEIGHT,
          MediaStore.MediaColumns.DURATION
        )
        if (modern) {
          columns.add(MediaStore.MediaColumns.RELATIVE_PATH)
          columns.add(MediaStore.MediaColumns.DISPLAY_NAME)
        } else {
          columns.add(MediaStore.MediaColumns.DATA)
        }

        // Android 9 and older have no per-volume URI; scope the shared external
        // volume to this mount point instead.
        val selection = if (modern) null else "${MediaStore.MediaColumns.DATA} LIKE ?"
        val args = if (modern) null else arrayOf("$rootPath/%")

        FileOutputStream(outFile).buffered().use { out ->
          resolver.query(uri, columns.toTypedArray(), selection, args, null)?.use { c ->
            val iDir = if (modern) c.getColumnIndex(MediaStore.MediaColumns.RELATIVE_PATH) else -1
            val iName = if (modern) c.getColumnIndex(MediaStore.MediaColumns.DISPLAY_NAME) else -1
            val iData = if (modern) -1 else c.getColumnIndex(MediaStore.MediaColumns.DATA)
            val iTaken = c.getColumnIndex(MediaStore.MediaColumns.DATE_TAKEN)
            val iWidth = c.getColumnIndex(MediaStore.MediaColumns.WIDTH)
            val iHeight = c.getColumnIndex(MediaStore.MediaColumns.HEIGHT)
            val iDur = c.getColumnIndex(MediaStore.MediaColumns.DURATION)

            fun longAt(i: Int): Long =
              if (i >= 0 && !c.isNull(i)) c.getLong(i) else 0L
            fun intAt(i: Int): Int =
              if (i >= 0 && !c.isNull(i)) c.getInt(i) else 0

            while (c.moveToNext()) {
              val rel = if (modern) {
                val dir = if (iDir >= 0 && !c.isNull(iDir)) c.getString(iDir) ?: "" else ""
                val name = if (iName >= 0 && !c.isNull(iName)) c.getString(iName) ?: "" else ""
                // RELATIVE_PATH for a file at the volume root can be "/".
                (dir + name).trimStart('/')
              } else {
                val full = if (iData >= 0 && !c.isNull(iData)) c.getString(iData) ?: "" else ""
                if (!full.startsWith("$rootPath/")) continue
                full.substring(rootPath.length + 1)
              }
              if (rel.isEmpty()) continue

              val taken = longAt(iTaken)
              val width = intAt(iWidth)
              val height = intAt(iHeight)
              val durationMs = longAt(iDur)
              if (taken <= 0L && width <= 0 && height <= 0 && durationMs <= 0L) continue

              // Seconds, matching the catalog: DATE_TAKEN is milliseconds and
              // DURATION is milliseconds, but the schema stores both as seconds.
              val obj = JSONObject()
              obj.put("p", rel)
              if (taken > 0L) obj.put("t", taken / 1000L)
              if (width > 0) obj.put("w", width)
              if (height > 0) obj.put("h", height)
              if (durationMs > 0L) obj.put("d", durationMs / 1000.0)
              out.write((obj.toString() + "\n").toByteArray(Charsets.UTF_8))
              count++
            }
          }
        }
      } catch (e: Exception) {
        // An unreadable media database is not fatal: the caller falls back to
        // each file's own modification time.
      }

      mapOf("path" to outFile.absolutePath, "count" to count)
    }

    AsyncFunction("stat") { path: String ->
      val f = File(path)
      mapOf(
        "exists" to f.exists(),
        "size" to f.length(),
        "mtime" to f.lastModified() / 1000L,
        "isDir" to f.isDirectory
      )
    }

    AsyncFunction("readBase64") { path: String ->
      Base64.encodeToString(File(path).readBytes(), Base64.NO_WRAP)
    }

    /**
     * Writes bytes the same way the Go engine does: temp file, fsync, then
     * rename with the previous copy kept as .bak. A drive yanked mid-write
     * leaves the last good catalog readable.
     */
    AsyncFunction("writeBase64Atomic") { path: String, data: String, keepBackup: Boolean ->
      writeAtomic(File(path), Base64.decode(data, Base64.NO_WRAP), keepBackup)
    }

    AsyncFunction("writeText") { path: String, text: String ->
      val f = File(path)
      f.parentFile?.mkdirs()
      f.writeText(text, Charsets.UTF_8)
      true
    }

    AsyncFunction("mkdirs") { path: String ->
      val f = File(path)
      f.exists() || f.mkdirs()
    }

    AsyncFunction("remove") { path: String ->
      File(path).delete()
    }

    AsyncFunction("rename") { from: String, to: String ->
      val src = File(from)
      val dst = File(to)
      dst.parentFile?.mkdirs()
      src.renameTo(dst)
    }

    AsyncFunction("freeBytes") { path: String ->
      val f = File(path)
      if (f.exists()) f.usableSpace else 0L
    }

    // Image previews. ImageDecoder (Android 9+) applies the EXIF orientation
    // and decodes HEIC, which is what keeps portrait shots upright instead of
    // sideways. Older releases fall back to BitmapFactory plus a manual rotate.
    AsyncFunction("imageThumb") { src: String, dst: String, maxSize: Int, quality: Int ->
      val file = File(src)
      val target = File(dst)
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
        thumbWithImageDecoder(file, target, maxSize, quality) ||
          thumbWithBitmapFactory(file, target, maxSize, quality)
      } else {
        thumbWithBitmapFactory(file, target, maxSize, quality)
      }
    }

    AsyncFunction("videoDuration") { src: String ->
      val r = MediaMetadataRetriever()
      try {
        r.setDataSource(src)
        r.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull() ?: 0L
      } catch (e: Exception) {
        0L
      } finally {
        runCatching { r.release() }
      }
    }

    // Video previews. The frame is asked for by timestamp so the caller can
    // retry at several offsets; a video that starts on black is a real case.
    AsyncFunction("videoThumb") { src: String, dst: String, atMs: Long, maxSize: Int, quality: Int ->
      val r = MediaMetadataRetriever()
      try {
        r.setDataSource(src)
        val frame = r.getFrameAtTime(
          atMs * 1000L,
          MediaMetadataRetriever.OPTION_CLOSEST_SYNC
        ) ?: return@AsyncFunction false
        val scaled = scaleTo(frame, maxSize)
        val ok = writeJpeg(scaled, File(dst), quality)
        if (scaled !== frame) scaled.recycle()
        frame.recycle()
        ok
      } catch (e: Exception) {
        false
      } finally {
        runCatching { r.release() }
      }
    }
  }

  private fun volumePath(v: StorageVolume): String? {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
      v.directory?.absolutePath?.takeIf { it.isNotEmpty() }?.let { return it }
    }
    return try {
      // Some OEM builds leave getDirectory() null for a USB volume that is
      // mounted. getPath is hidden but present; ask it before giving up.
      (StorageVolume::class.java.getMethod("getPath").invoke(v) as? String)
        ?.takeIf { it.isNotEmpty() }
    } catch (e: Exception) {
      null
    }
  }

  /** The MediaStore volume name for a mount point, e.g. "EC7-679B". */
  private fun mediaStoreVolumeName(rootPath: String): String? {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return null
    return try {
      val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      val sv = sm.storageVolumes.firstOrNull {
        volumePath(it)?.trimEnd('/') == rootPath
      } ?: return null

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
        // getMediaStoreVolumeName arrived in Android 11. On 10 the same value
        // can be recovered by matching the volume's own UUID.
        sv.mediaStoreVolumeName?.let { return it }
      }
      val uuid = sv.uuid ?: return null
      MediaStore.getExternalVolumeNames(ctx).firstOrNull { it.equals(uuid, true) }
    } catch (e: Exception) {
      null
    }
  }

  /**
   * ImageDecoder honours the EXIF orientation of JPEG and HEIF, so the frame
   * comes out the way the camera meant it. It also decodes HEIC on the same
   * releases that can display it.
   */
  private fun thumbWithImageDecoder(src: File, dst: File, maxSize: Int, quality: Int): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.P) return false
    return try {
      val source = ImageDecoder.createSource(src)
      val decoded = ImageDecoder.decodeBitmap(source) { decoder, info, _ ->
        // Software bitmaps are the only ones JPEG compression can read back.
        decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        val sample = sampleSize(info.size.width, info.size.height, maxSize)
        if (sample > 1) decoder.setTargetSampleSize(sample)
      }
      val scaled = scaleTo(decoded, maxSize)
      val ok = writeJpeg(scaled, dst, quality)
      if (scaled !== decoded) scaled.recycle()
      decoded.recycle()
      ok
    } catch (e: Exception) {
      false
    }
  }

  /**
   * Pre-Android-9 path: BitmapFactory ignores orientation metadata, so a JPEG
   * whose EXIF says "rotate 90" is turned upright here by hand.
   */
  private fun thumbWithBitmapFactory(src: File, dst: File, maxSize: Int, quality: Int): Boolean {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(src.absolutePath, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return false

    val opts = BitmapFactory.Options().apply {
      inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxSize)
    }
    var decoded = BitmapFactory.decodeFile(src.absolutePath, opts) ?: return false

    val rotation = runCatching {
      val exif = ExifInterface(src.absolutePath)
      when (exif.getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL)) {
        ExifInterface.ORIENTATION_ROTATE_90 -> 90f
        ExifInterface.ORIENTATION_ROTATE_180 -> 180f
        ExifInterface.ORIENTATION_ROTATE_270 -> 270f
        else -> 0f
      }
    }.getOrDefault(0f)

    if (rotation != 0f) {
      val matrix = Matrix().apply { postRotate(rotation) }
      val rotated = Bitmap.createBitmap(decoded, 0, 0, decoded.width, decoded.height, matrix, true)
      if (rotated !== decoded) {
        decoded.recycle()
        decoded = rotated
      }
    }

    val scaled = scaleTo(decoded, maxSize)
    val ok = writeJpeg(scaled, dst, quality)
    if (scaled !== decoded) scaled.recycle()
    decoded.recycle()
    return ok
  }

  private fun writeAtomic(target: File, bytes: ByteArray, keepBackup: Boolean): Boolean {
    val dir = target.parentFile ?: return false
    if (!dir.exists() && !dir.mkdirs()) return false

    val tmp = File(dir, target.name + ".tmp")
    try {
      FileOutputStream(tmp).use { out ->
        out.write(bytes)
        out.flush()
        out.fd.sync()
      }
    } catch (e: Exception) {
      tmp.delete()
      throw e
    }

    if (target.exists() && keepBackup) {
      val bak = File(dir, target.name + ".bak")
      bak.delete()
      if (!target.renameTo(bak)) {
        tmp.delete()
        return false
      }
    }
    if (!tmp.renameTo(target)) {
      tmp.delete()
      return false
    }
    return true
  }

  private fun writeJpeg(bitmap: Bitmap, dst: File, quality: Int): Boolean {
    dst.parentFile?.mkdirs()
    val tmp = File(dst.parentFile, dst.name + ".tmp")
    return try {
      FileOutputStream(tmp).use { out ->
        if (!bitmap.compress(Bitmap.CompressFormat.JPEG, quality.coerceIn(1, 100), out)) {
          return false
        }
        out.flush()
        out.fd.sync()
      }
      if (dst.exists()) dst.delete()
      tmp.renameTo(dst)
    } catch (e: Exception) {
      tmp.delete()
      false
    }
  }

  private fun sampleSize(width: Int, height: Int, maxSize: Int): Int {
    var sample = 1
    var w = width
    var h = height
    while (w / 2 >= maxSize && h / 2 >= maxSize) {
      w /= 2
      h /= 2
      sample *= 2
    }
    return max(1, sample)
  }

  private fun scaleTo(src: Bitmap, maxSize: Int): Bitmap {
    val longest = max(src.width, src.height)
    if (longest <= maxSize) return src
    val ratio = maxSize.toFloat() / longest.toFloat()
    val w = max(1, (src.width * ratio).toInt())
    val h = max(1, (src.height * ratio).toInt())
    return Bitmap.createScaledBitmap(src, w, h, true)
  }

  private fun isMedia(name: String): Boolean {
    val ext = name.substringAfterLast('.', "").lowercase()
    if (ext.isEmpty()) return false
    return IMAGE_EXT.contains(ext) || VIDEO_EXT.contains(ext)
  }

  private fun isVideo(name: String): Boolean {
    return VIDEO_EXT.contains(name.substringAfterLast('.', "").lowercase())
  }

  private fun skipDir(name: String): Boolean {
    if (SKIP_DIRS.contains(name)) return true
    return name.startsWith(".") && name != "." && name != ".."
  }

  private fun junkFile(name: String): Boolean {
    if (name.startsWith("._") || name.startsWith("~$")) return true
    return JUNK_FILES.contains(name.lowercase())
  }

  companion object {
    // Same extension sets and filters as engine/internal/media, so a drive
    // indexed on the phone and on the PC agree on what counts as media.
    private val IMAGE_EXT = setOf(
      "jpg", "jpeg", "jpe", "jfif", "png", "gif", "bmp", "webp", "heic", "heif",
      "avif", "tif", "tiff", "dng", "cr2", "cr3", "nef", "arw", "raf", "rw2",
      "orf", "pef", "srw", "raw", "jxl"
    )
    private val VIDEO_EXT = setOf(
      "mp4", "m4v", "mov", "3gp", "3g2", "avi", "mkv", "webm", "wmv", "flv",
      "mpg", "mpeg", "mts", "m2ts", "vob", "ogv", "divx", "asf", "rm"
    )
    private val SKIP_DIRS = setOf(
      "\$RECYCLE.BIN", "System Volume Information", ".Spotlight-V100",
      ".Trashes", ".fseventsd", "@eaDir", "#recycle", "node_modules", ".git"
    )
    private val JUNK_FILES = setOf(
      "thumbs.db", "ehthumbs.db", "desktop.ini", ".ds_store", "icon\r"
    )
  }
}
