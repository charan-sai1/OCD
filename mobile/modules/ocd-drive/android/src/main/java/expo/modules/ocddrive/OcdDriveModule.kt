package expo.modules.ocddrive

import android.content.Context
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.storage.StorageManager
import android.os.storage.StorageVolume
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

  override fun definition() = ModuleDefinition {
    Name("OcdDrive")

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

    // Mounted volumes, with the USB volume's FAT serial exposed as uuid. The
    // serial is the same value Windows reports, so both platforms can derive one
    // volume identity for a drive instead of two.
    AsyncFunction("listVolumes") {
      val sm = ctx.getSystemService(Context.STORAGE_SERVICE) as StorageManager
      sm.storageVolumes.mapNotNull { v ->
        val path = volumePath(v) ?: return@mapNotNull null
        mapOf(
          "uuid" to (v.uuid ?: ""),
          "label" to runCatching { v.getDescription(ctx) }.getOrDefault(""),
          "path" to path,
          "primary" to v.isPrimary,
          "removable" to v.isRemovable,
          "state" to v.state,
          "writable" to File(path).canWrite()
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

    // Image previews. BitmapFactory decodes HEIC on Android 9+, which is the
    // same library the system gallery uses, so no extra codec is bundled.
    AsyncFunction("imageThumb") { src: String, dst: String, maxSize: Int, quality: Int ->
      val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
      BitmapFactory.decodeFile(src, bounds)
      if (bounds.outWidth <= 0 || bounds.outHeight <= 0) {
        return@AsyncFunction false
      }
      val opts = BitmapFactory.Options().apply {
        inSampleSize = sampleSize(bounds.outWidth, bounds.outHeight, maxSize)
      }
      val decoded = BitmapFactory.decodeFile(src, opts) ?: return@AsyncFunction false
      val scaled = scaleTo(decoded, maxSize)
      val ok = writeJpeg(scaled, File(dst), quality)
      if (scaled !== decoded) scaled.recycle()
      decoded.recycle()
      ok
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
      return v.directory?.absolutePath
    }
    return try {
      // getPath is hidden but present on every release that lacks getDirectory.
      StorageVolume::class.java.getMethod("getPath").invoke(v) as? String
    } catch (e: Exception) {
      null
    }
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
