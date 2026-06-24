package __PACKAGE_NAME__.widget

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
import java.time.LocalDate
import java.time.LocalTime
import java.time.ZoneId
import java.time.ZonedDateTime
import java.time.format.DateTimeFormatter
import java.time.format.FormatStyle
import java.util.Locale
import org.json.JSONArray
import org.json.JSONObject

class SavedWidgetProvider : AppWidgetProvider() {
  override fun onReceive(context: Context, intent: Intent) {
    Log.d(TAG, "onReceive: ${intent.action}")
    super.onReceive(context, intent)
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
      val sessions = parseSessions(sessionsJson).filter { !it.isPast() }

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
              "Session ${session.sessionNumber} • ${session.formattedStartTime()}"
            )
            views.setTextViewText(subtitleIds[i], session.weightClass)
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
          val weightClass = obj.optString("weight_class", "")
          val date = obj.optString("date", "")
          val eventTimezone = obj.optString("time_zone", ZoneId.systemDefault().id)
          val url = obj.optString("url", "")
          sessions.add(
            WidgetSession(
              platform = platform,
              sessionNumber = sessionNumber,
              startTime = startTime,
              weightClass = weightClass,
              date = date,
              eventTimezone = eventTimezone,
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
  val startTime: String,
  val weightClass: String,
  val date: String,
  val eventTimezone: String = ZoneId.systemDefault().id,
  val url: String = ""
) {
  fun formattedStartTime(): String {
    return try {
      val parsed = LocalTime.parse(startTime, DateTimeFormatter.ofPattern("HH:mm:ss"))
      parsed.format(DateTimeFormatter.ofLocalizedTime(FormatStyle.SHORT).withLocale(Locale.getDefault()))
    } catch (_: Exception) {
      startTime
    }
  }

  fun isPast(): Boolean {
    return try {
      val zone = try {
        ZoneId.of(eventTimezone)
      } catch (_: Exception) {
        ZoneId.systemDefault()
      }
      val parsedDate = LocalDate.parse(date, DateTimeFormatter.ISO_LOCAL_DATE)
      val parsedTime = LocalTime.parse(startTime, DateTimeFormatter.ofPattern("HH:mm:ss"))
      val sessionZoned = ZonedDateTime.of(parsedDate, parsedTime, zone)
      sessionZoned.isBefore(ZonedDateTime.now(zone))
    } catch (_: Exception) {
      false
    }
  }
}
