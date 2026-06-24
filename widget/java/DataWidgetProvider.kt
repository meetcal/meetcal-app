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
import android.view.View
import android.widget.RemoteViews
import __PACKAGE_NAME__.R
import org.json.JSONObject

abstract class DataWidgetProvider : AppWidgetProvider() {
  abstract val prefsKey: String
  abstract val iconRes: Int
  abstract val fallbackTitle: String
  abstract val fallbackSubtitle: String
  abstract val fallbackEmpty: String
  open val layoutRes: Int = R.layout.widget_data_large

  override fun onUpdate(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetIds: IntArray
  ) {
    for (appWidgetId in appWidgetIds) {
      try {
        render(context, appWidgetManager, appWidgetId)
      } catch (e: Exception) {
        Log.e(TAG, "DataWidget onUpdate failed", e)
        showMinimal(context, appWidgetManager, appWidgetId)
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
      render(context, appWidgetManager, appWidgetId)
    } catch (e: Exception) {
      Log.e(TAG, "DataWidget onAppWidgetOptionsChanged failed", e)
      showMinimal(context, appWidgetManager, appWidgetId)
    }
  }

  private fun showMinimal(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int
  ) {
    try {
      val views = RemoteViews(context.packageName, R.layout.widget_data_initial)
      views.setImageViewResource(R.id.widget_icon, iconRes)
      views.setTextViewText(R.id.widget_title, fallbackTitle)
      appWidgetManager.updateAppWidget(appWidgetId, views)
    } catch (e: Exception) {
      Log.e(TAG, "DataWidget showMinimal failed", e)
    }
  }

  private fun render(
    context: Context,
    appWidgetManager: AppWidgetManager,
    appWidgetId: Int
  ) {
    val views = RemoteViews(context.packageName, layoutRes)
    views.setImageViewResource(R.id.widget_icon, iconRes)

    val prefs = context.getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
    val json = prefs.getString(prefsKey, null)
    val payload = if (json != null) {
      try {
        JSONObject(json)
      } catch (_: Exception) {
        null
      }
    } else {
      null
    }

    val title = payload?.optString("title")?.takeUnless { it.isBlank() } ?: fallbackTitle
    val subtitle = payload?.optString("subtitle")?.takeUnless { it.isBlank() } ?: fallbackSubtitle
    val emptyMessage =
      payload?.optString("emptyMessage")?.takeUnless { it.isBlank() } ?: fallbackEmpty
    val linkUrl = payload?.optString("linkURL")?.takeUnless { it.isBlank() }
    val rows = parseRows(payload)

    // No arbitrary cap: bind every data row into the available slots and let the
    // widget's height clip whatever doesn't fit.
    val rowLimit = ROW_IDS.size

    deepLinkPendingIntent(context, linkUrl, appWidgetId)?.let {
      views.setOnClickPendingIntent(R.id.widget_root, it)
    }

    views.setTextViewText(R.id.widget_title, title)
    if (subtitle.isBlank()) {
      views.setViewVisibility(R.id.widget_subtitle, View.GONE)
    } else {
      views.setViewVisibility(R.id.widget_subtitle, View.VISIBLE)
      views.setTextViewText(R.id.widget_subtitle, subtitle)
    }

    val displayRows = rows.take(rowLimit)
    if (displayRows.isEmpty()) {
      views.setViewVisibility(R.id.widget_empty, View.VISIBLE)
      views.setTextViewText(R.id.widget_empty, emptyMessage)
      ROW_IDS.forEach { id -> views.setViewVisibility(id, View.GONE) }
    } else {
      views.setViewVisibility(R.id.widget_empty, View.GONE)
      for (i in ROW_IDS.indices) {
        if (i < displayRows.size) {
          val row = displayRows[i]
          views.setViewVisibility(ROW_IDS[i], View.VISIBLE)
          views.setTextViewText(LEADING_IDS[i], row.leading)
          if (row.title.isBlank()) {
            views.setViewVisibility(TITLE_IDS[i], View.GONE)
          } else {
            views.setViewVisibility(TITLE_IDS[i], View.VISIBLE)
            views.setTextViewText(TITLE_IDS[i], row.title)
          }
          if (row.subtitle.isBlank()) {
            views.setViewVisibility(SUBTITLE_IDS[i], View.GONE)
          } else {
            views.setViewVisibility(SUBTITLE_IDS[i], View.VISIBLE)
            views.setTextViewText(SUBTITLE_IDS[i], row.subtitle)
          }
          views.setTextViewText(TRAILING_IDS[i], row.trailing)
        } else {
          views.setViewVisibility(ROW_IDS[i], View.GONE)
        }
      }
    }

    appWidgetManager.updateAppWidget(appWidgetId, views)
  }

  companion object {
    private const val TAG = "DataWidgetProvider"
    const val PREFS_NAME = "saved_widget_prefs"
    const val KEY_QUALIFYING = "qualifyingTotalsWidgetData"
    const val KEY_STANDARDS = "standardsWidgetData"
    const val KEY_INTL = "intlRankingsWidgetData"

    val ROW_IDS = intArrayOf(
      R.id.row1, R.id.row2, R.id.row3, R.id.row4, R.id.row5,
      R.id.row6, R.id.row7, R.id.row8, R.id.row9, R.id.row10,
      R.id.row11, R.id.row12, R.id.row13, R.id.row14, R.id.row15,
      R.id.row16, R.id.row17, R.id.row18, R.id.row19, R.id.row20
    )
    private val LEADING_IDS = intArrayOf(
      R.id.leading1, R.id.leading2, R.id.leading3, R.id.leading4, R.id.leading5,
      R.id.leading6, R.id.leading7, R.id.leading8, R.id.leading9, R.id.leading10,
      R.id.leading11, R.id.leading12, R.id.leading13, R.id.leading14, R.id.leading15,
      R.id.leading16, R.id.leading17, R.id.leading18, R.id.leading19, R.id.leading20
    )
    private val TITLE_IDS = intArrayOf(
      R.id.title1, R.id.title2, R.id.title3, R.id.title4, R.id.title5,
      R.id.title6, R.id.title7, R.id.title8, R.id.title9, R.id.title10,
      R.id.title11, R.id.title12, R.id.title13, R.id.title14, R.id.title15,
      R.id.title16, R.id.title17, R.id.title18, R.id.title19, R.id.title20
    )
    private val SUBTITLE_IDS = intArrayOf(
      R.id.subtitle1, R.id.subtitle2, R.id.subtitle3, R.id.subtitle4, R.id.subtitle5,
      R.id.subtitle6, R.id.subtitle7, R.id.subtitle8, R.id.subtitle9, R.id.subtitle10,
      R.id.subtitle11, R.id.subtitle12, R.id.subtitle13, R.id.subtitle14, R.id.subtitle15,
      R.id.subtitle16, R.id.subtitle17, R.id.subtitle18, R.id.subtitle19, R.id.subtitle20
    )
    private val TRAILING_IDS = intArrayOf(
      R.id.trailing1, R.id.trailing2, R.id.trailing3, R.id.trailing4, R.id.trailing5,
      R.id.trailing6, R.id.trailing7, R.id.trailing8, R.id.trailing9, R.id.trailing10,
      R.id.trailing11, R.id.trailing12, R.id.trailing13, R.id.trailing14, R.id.trailing15,
      R.id.trailing16, R.id.trailing17, R.id.trailing18, R.id.trailing19, R.id.trailing20
    )

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

    fun updateAllWidgets(context: Context, providerClass: Class<out AppWidgetProvider>) {
      val appWidgetManager = AppWidgetManager.getInstance(context)
      val componentName = ComponentName(context, providerClass)
      val appWidgetIds = appWidgetManager.getAppWidgetIds(componentName)
      if (appWidgetIds.isEmpty()) return
      val intent = Intent(context, providerClass).apply {
        action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
        putExtra(AppWidgetManager.EXTRA_APPWIDGET_IDS, appWidgetIds)
      }
      context.sendBroadcast(intent)
    }

    private fun parseRows(payload: JSONObject?): List<DataRow> {
      val array = payload?.optJSONArray("rows") ?: return emptyList()
      val rows = mutableListOf<DataRow>()
      for (i in 0 until array.length()) {
        val obj = array.optJSONObject(i) ?: continue
        rows.add(
          DataRow(
            leading = obj.optString("leading", ""),
            title = obj.optString("title", ""),
            subtitle = obj.optString("subtitle", ""),
            trailing = obj.optString("trailing", "")
          )
        )
      }
      return rows
    }
  }
}

private data class DataRow(
  val leading: String,
  val title: String,
  val subtitle: String,
  val trailing: String
)
