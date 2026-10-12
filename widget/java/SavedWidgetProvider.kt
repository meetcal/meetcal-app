package __PACKAGE_NAME__.widget

import android.app.AlarmManager
import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import android.widget.RemoteViews
import __PACKAGE_NAME__.R
import org.json.JSONArray
import org.json.JSONObject

// Row fields are a contract with JS: SAVED_WIDGET_ROW_FIELDS in
// src/utils/widgetContract.ts (src/utils/widgetContract.test.ts reads this
// file). `start_at_ms` is the session's start instant, computed by the app in
// the meet's zone and absent when that zone is unknown; `start_time` is the
// meet-local display time and is never parsed here.
class SavedWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "onReceive: ${intent.action}")
    super.onReceive(context, intent)
    when (intent.action) {
      ACTION_REFRESH,
      Intent.ACTION_TIME_CHANGED,
      Intent.ACTION_TIMEZONE_CHANGED,
      Intent.ACTION_DATE_CHANGED -> updateAllWidgets(context)
    }
  }

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (appWidgetId in appWidgetIds) {
      try {
        updateAppWidget(context, appWidgetManager, appWidgetId)
      } catch (e: Exception) {
        Log.e(TAG, "SavedWidget onUpdate failed", e)
        showMinimalWidget(context, appWidgetManager, appWidgetId)
      }
    }
    scheduleNextRefresh(context)
  }

  override fun onDisabled(context: Context) {
    super.onDisabled(context)
    cancelScheduledRefresh(context)
  }

  override fun onAppWidgetOptionsChanged(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int,
    newOptions: Bundle
  ) {
    try {
      updateAppWidget(context, appWidgetManager, appWidgetId)
    } catch (e: Exception) {
      Log.e(TAG, "SavedWidget onAppWidgetOptionsChanged failed", e)
      showMinimalWidget(context, appWidgetManager, appWidgetId)
    }
  }

  companion object {
    private const val TAG = "SavedWidgetProvider"
    const val PREFS_NAME = "saved_widget_prefs"
    const val KEY_SELECTED_MEET = "selectedMeet"
    const val KEY_SESSIONS_JSON = "savedSessions"
    private const val SAVED_DEEP_LINK = "meetcal:///open/saved"
    /** Broadcast the refresh alarm sends; redraws so started sessions drop off. */
    private const val ACTION_REFRESH = "__PACKAGE_NAME__.widget.SAVED_WIDGET_REFRESH"
    private const val REFRESH_REQUEST_CODE = 7301
    /** Fire just after the start instant so the session already reads as started. */
    private const val REFRESH_DELAY_AFTER_START_MS = 1_000L

    private fun deepLinkPendingIntent(
      context: Context,
      url: String?,
      requestCode: Int
    ): PendingIntent? {
      if (url.isNullOrBlank()) return null
      return try {
        val intent = Intent(Intent.ACTION_VIEW, Uri.parse(url)).apply {
          setPackage(context.packageName)
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
        }
        PendingIntent.getActivity(
          context,
          requestCode,
          intent,
          PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
      } catch (_: Exception) {
        null
      }
    }

    fun updateAllWidgets(context: Context) {
      val appWidgetManager = AppWidgetManager.getInstance(context)
      val componentName = ComponentName(context, SavedWidgetProvider::class.java)
      val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
      for (appWidgetId in appWidgetIds) {
        try {
          updateAppWidget(context, appWidgetManager, appWidgetId)
        } catch (e: Exception) {
          Log.e(TAG, "SavedWidget updateAllWidgets failed", e)
          showMinimalWidget(context, appWidgetManager, appWidgetId)
        }
      }
      scheduleNextRefresh(context)
    }

    private fun refreshPendingIntent(context: Context): PendingIntent {
      val intent = Intent(context, SavedWidgetProvider::class.java).apply {
        action = ACTION_REFRESH
      }
      return PendingIntent.getBroadcast(
        context,
        REFRESH_REQUEST_CODE,
        intent,
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
      )
    }

    private fun cancelScheduledRefresh(context: Context) {
      try {
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        alarmManager.cancel(refreshPendingIntent(context))
      } catch (e: Exception) {
        Log.e(TAG, "SavedWidget cancelScheduledRefresh failed", e)
      }
    }

    /**
     * Schedules one inexact alarm just after the next session start, so the
     * widget redraws and drops that session without the app being opened.
     * Inexact (`set`, not `setExact`) needs no exact-alarm permission; a late
     * delivery only delays the redraw. Cancelled when there is nothing to
     * wait for or no widget on the home screen.
     */
    private fun scheduleNextRefresh(context: Context) {
      try {
        val appWidgetManager = AppWidgetManager.getInstance(context)
        val componentName = ComponentName(context, SavedWidgetProvider::class.java)
        if (appWidgetManager.getAppWidgetIds(componentName).isEmpty()) {
          cancelScheduledRefresh(context)
          return
        }
        val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
        val now = System.currentTimeMillis()
        val nextStart = parseSessions(prefs.getString(KEY_SESSIONS_JSON, "[]") ?: "[]")
          .mapNotNull { it.startAtMs }
          .filter { it > now }
          .minOrNull()
        if (nextStart == null) {
          cancelScheduledRefresh(context)
          return
        }
        val alarmManager = context.getSystemService(Context.ALARM_SERVICE) as? AlarmManager ?: return
        alarmManager.set(
          AlarmManager.RTC,
          nextStart + REFRESH_DELAY_AFTER_START_MS,
          refreshPendingIntent(context)
        )
      } catch (e: Exception) {
        Log.e(TAG, "SavedWidget scheduleNextRefresh failed", e)
      }
    }

    private fun showMinimalWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int
    ) {
      try {
        val views = RemoteViews(context.packageName, R.layout.widget_saved_initial)
        appWidgetManager.updateAppWidget(appWidgetId, views)
      } catch (e: Exception) {
        Log.e(TAG, "SavedWidget showMinimalWidget failed", e)
      }
    }

    private val ROW_IDS = intArrayOf(
      R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5,
      R.id.row6, R.id.row7, R.id.row8, R.id.row9, R.id.row10,
      R.id.row11, R.id.row12, R.id.row13, R.id.row14, R.id.row15,
      R.id.row16, R.id.row17, R.id.row18, R.id.row19, R.id.row20
    )
    private val PLATFORM_IDS = intArrayOf(
      R.id.platform1, R.id.platform2, R.id.platform3, R.id.platform4, R.id.platform5,
      R.id.platform6, R.id.platform7, R.id.platform8, R.id.platform9, R.id.platform10,
      R.id.platform11, R.id.platform12, R.id.platform13, R.id.platform14, R.id.platform15,
      R.id.platform16, R.id.platform17, R.id.platform18, R.id.platform19, R.id.platform20
    )
    private val TITLE_IDS = intArrayOf(
      R.id.session_title1, R.id.session_title2, R.id.session_title3, R.id.session_title4, R.id.session_title5,
      R.id.session_title6, R.id.session_title7, R.id.session_title8, R.id.session_title9, R.id.session_title10,
      R.id.session_title11, R.id.session_title12, R.id.session_title13, R.id.session_title14, R.id.session_title15,
      R.id.session_title16, R.id.session_title17, R.id.session_title18, R.id.session_title19, R.id.session_title20
    )
    private val SUBTITLE_IDS = intArrayOf(
      R.id.session_subtitle1, R.id.session_subtitle2, R.id.session_subtitle3, R.id.session_subtitle4, R.id.session_subtitle5,
      R.id.session_subtitle6, R.id.session_subtitle7, R.id.session_subtitle8, R.id.session_subtitle9, R.id.session_subtitle10,
      R.id.session_subtitle11, R.id.session_subtitle12, R.id.session_subtitle13, R.id.session_subtitle14, R.id.session_subtitle15,
      R.id.session_subtitle16, R.id.session_subtitle17, R.id.session_subtitle18, R.id.session_subtitle19, R.id.session_subtitle20
    )

    private fun updateAppWidget(
      context: Context,
      appWidgetManager: AppWidgetManager,
      appWidgetId: Int
    ) {
      val views = RemoteViews(context.packageName, R.layout.widget_saved_large)
      val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
      val selectedMeet = prefs.getString(KEY_SELECTED_MEET, "") ?: ""
      val sessionsJson = prefs.getString(KEY_SESSIONS_JSON, "[]") ?: "[]"
      val now = System.currentTimeMillis()
      val sessions = parseSessions(sessionsJson).filter { !it.hasStarted(now) }

      views.setTextViewText(
        R.id.widget_title,
        if (selectedMeet.isBlank()) "MeetCal" else selectedMeet
      )
      views.setViewVisibility(R.id.widget_subtitle, android.view.View.GONE)

      deepLinkPendingIntent(context, SAVED_DEEP_LINK, appWidgetId * 100)?.let {
        views.setOnClickPendingIntent(R.id.widget_root, it)
      }

      // No arbitrary cap: bind every saved session into the available slots and let
      // the widget's height clip whatever doesn't fit.
      val displaySessions = sessions.take(ROW_IDS.size)
      val rowIds = ROW_IDS
      val platformIds = PLATFORM_IDS
      val titleIds = TITLE_IDS
      val subtitleIds = SUBTITLE_IDS

      if (displaySessions.isEmpty()) {
        views.setViewVisibility(R.id.widget_empty, android.view.View.VISIBLE)
        rowIds.forEach { id ->
          views.setViewVisibility(id, android.view.View.GONE)
        }
      } else {
        views.setViewVisibility(R.id.widget_empty, android.view.View.GONE)
        for (i in rowIds.indices) {
          if (i < displaySessions.size) {
            val session = displaySessions[i]
            views.setViewVisibility(rowIds[i], android.view.View.VISIBLE)
            views.setTextViewText(platformIds[i], session.platform)
            views.setInt(
              platformIds[i],
              "setBackgroundResource",
              platformBackgroundRes(session.platform)
            )
            views.setTextViewText(
              titleIds[i],
              "Session ${session.sessionNumber} • ${session.startTime}"
            )
            views.setTextViewText(subtitleIds[i], session.detailLine())
            val rowIntent =
              deepLinkPendingIntent(context, session.url, appWidgetId * 100 + i + 1)
            if (rowIntent != null) {
              views.setOnClickPendingIntent(rowIds[i], rowIntent)
            }
          } else {
            views.setViewVisibility(rowIds[i], android.view.View.GONE)
          }
        }
      }

      appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    private fun parseSessions(json: String): List<WidgetSession> {
      return try {
        val array = JSONArray(json)
        val sessions = mutableListOf<WidgetSession>()
        for (i in 0 until array.length()) {
          val obj = array.optJSONObject(i) ?: JSONObject()
          val platform = obj.optString("platform", "")
          val sessionNumber = obj.optInt("session_number", 0)
          val startTime = obj.optString("start_time", "")
          val startAtRaw = obj.optDouble("start_at_ms", Double.NaN)
          val startAtMs = if (startAtRaw.isNaN()) null else startAtRaw.toLong()
          val weightClass = obj.optString("weight_class", "")
          val date = obj.optString("date", "")
          val dayLabel = obj.optString("day_label", "")
          val url = obj.optString("url", "")
          sessions.add(
            WidgetSession(
              platform = platform,
              sessionNumber = sessionNumber,
              startTime = startTime,
              startAtMs = startAtMs,
              weightClass = weightClass,
              date = date,
              dayLabel = dayLabel,
              url = url
            )
          )
        }
        sessions
      } catch (_: Exception) {
        emptyList()
      }
    }

    private fun platformBackgroundRes(platform: String): Int {
      return when (platform) {
        "Red" -> R.drawable.widget_chip_red
        "White" -> R.drawable.widget_chip_gray
        "Stars" -> R.drawable.widget_chip_indigo
        "Stripes" -> R.drawable.widget_chip_green
        "Rogue" -> R.drawable.widget_chip_black
        else -> R.drawable.widget_chip_blue
      }
    }
  }
}

private data class WidgetSession(
  val platform: String,
  val sessionNumber: Int,
  /** Meet-local display time ("9:00 AM"), shown as the app shows it. */
  val startTime: String,
  /** Start instant (epoch ms); null when the app could not resolve the meet's zone. */
  val startAtMs: Long?,
  val weightClass: String,
  val date: String,
  val dayLabel: String = "",
  val url: String = ""
) {
  /** A row without a start instant is kept rather than guessed at. */
  fun hasStarted(now: Long): Boolean {
    val start = startAtMs ?: return false
    return start <= now
  }

  /** "Sat, Jun 20 • 89kg": the meet-local day, then the weight classes. */
  fun detailLine(): String {
    return listOf(dayLabel, weightClass).filter { it.isNotBlank() }.joinToString(" • ")
  }
}
