package expo.modules.ocddrive

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager

/**
 * Keeps the app process alive while a backup copies for many minutes with the
 * screen off. A foreground service is the only supported way to do that on
 * modern Android; the wake lock keeps the CPU running between file writes.
 *
 * START_NOT_STICKY is deliberate: if the OS kills the process, do not restart a
 * copy run that has no JavaScript behind it. The backup marker written by the
 * app lets the next launch offer to resume instead.
 */
class BackupService : Service() {
  private var wakeLock: PowerManager.WakeLock? = null

  override fun onBind(intent: Intent?): IBinder? = null

  /**
   * Android 15+ limits a `dataSync` foreground service to six hours. A very
   * large camera roll can reach that. Ending the service cleanly leaves the
   * resume marker in place; the system would otherwise kill the process for not
   * stopping in time, which the marker also survives but with less warning.
   */
  override fun onTimeout(startId: Int, fgsType: Int) {
    stopSelf()
  }

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == ACTION_STOP) {
      stopSelf()
      return START_NOT_STICKY
    }
    val title = intent?.getStringExtra(EXTRA_TITLE)?.takeIf { it.isNotBlank() }
      ?: "Backing up to your drive"
    val text = intent?.getStringExtra(EXTRA_TEXT)?.takeIf { it.isNotBlank() }
      ?: "Keep the drive plugged in."
    startForegroundCompat(title, text)
    acquireWakeLock()
    running = true
    return START_NOT_STICKY
  }

  override fun onDestroy() {
    running = false
    wakeLock?.let { lock ->
      runCatching { if (lock.isHeld) lock.release() }
    }
    wakeLock = null
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.N) {
      stopForeground(STOP_FOREGROUND_REMOVE)
    } else {
      @Suppress("DEPRECATION")
      stopForeground(true)
    }
    super.onDestroy()
  }

  private fun startForegroundCompat(title: String, text: String) {
    val manager = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      val channel = NotificationChannel(
        CHANNEL_ID,
        "Backup",
        NotificationManager.IMPORTANCE_LOW,
      ).apply {
        description = "Shown while a backup is copying to a drive."
        setShowBadge(false)
      }
      manager.createNotificationChannel(channel)
    }

    val open = packageManager.getLaunchIntentForPackage(packageName)
    val pending = PendingIntent.getActivity(
      this,
      0,
      open ?: Intent(),
      PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
    )

    val builder = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      Notification.Builder(this, CHANNEL_ID)
    } else {
      Notification.Builder(this)
    }
    // A platform icon, not the app icon: the launcher icon is an adaptive icon
    // on modern Android and is not a valid notification small icon.
    val notification: Notification = builder
      .setContentTitle(title)
      .setContentText(text)
      .setSmallIcon(android.R.drawable.stat_sys_upload)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(pending)
      .build()

    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
      startForeground(NOTIFICATION_ID, notification, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)
    } else {
      startForeground(NOTIFICATION_ID, notification)
    }
  }

  private fun acquireWakeLock() {
    if (wakeLock?.isHeld == true) return
    val power = getSystemService(Context.POWER_SERVICE) as PowerManager
    wakeLock = power.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "ocd:backup").apply {
      setReferenceCounted(false)
      acquire()
    }
  }

  companion object {
    private const val CHANNEL_ID = "ocd_backup"
    private const val NOTIFICATION_ID = 7421
    private const val ACTION_STOP = "expo.modules.ocddrive.STOP_BACKUP"
    private const val EXTRA_TITLE = "title"
    private const val EXTRA_TEXT = "text"

    /** True between onStartCommand and onDestroy; avoids restarting a stopped service. */
    @Volatile
    private var running = false

    fun start(context: Context, title: String, text: String) {
      val intent = Intent(context, BackupService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_TEXT, text)
      }
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
        context.startForegroundService(intent)
      } else {
        context.startService(intent)
      }
    }

    /** Updates the notification only when a run is already showing it. */
    fun update(context: Context, title: String, text: String) {
      if (!running) return
      val intent = Intent(context, BackupService::class.java).apply {
        putExtra(EXTRA_TITLE, title)
        putExtra(EXTRA_TEXT, text)
      }
      runCatching { context.startService(intent) }
    }

    fun stop(context: Context) {
      running = false
      val intent = Intent(context, BackupService::class.java).apply {
        action = ACTION_STOP
      }
      runCatching { context.startService(intent) }
      runCatching { context.stopService(Intent(context, BackupService::class.java)) }
    }
  }
}
