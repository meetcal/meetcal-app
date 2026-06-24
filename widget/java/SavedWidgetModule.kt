package __PACKAGE_NAME__.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod
import org.json.JSONObject

class SavedWidgetModule(private val reactContext: ReactApplicationContext) : ReactContextBaseJavaModule(reactContext) {
  override fun getName(): String = "SavedWidget"

  @ReactMethod
  fun updateSavedWidget(selectedMeet: String?, sessionsJson: String?) {
    val prefs = reactContext.getSharedPreferences(
      SavedWidgetProvider.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    prefs.edit()
      .putString(SavedWidgetProvider.KEY_SELECTED_MEET, selectedMeet ?: "")
      .putString(SavedWidgetProvider.KEY_SESSIONS_JSON, sessionsJson ?: "[]")
      .apply()

    val appWidgetManager = AppWidgetManager.getInstance(reactContext)
    val componentName = ComponentName(reactContext, SavedWidgetProvider::class.java)
    val widgetIds = appWidgetManager.getAppWidgetIds(componentName)
    if (widgetIds.isNotEmpty()) {
      SavedWidgetProvider.updateAllWidgets(reactContext)
    }
  }

  @ReactMethod
  fun updateDataWidgets(payloadsJson: String?) {
    val prefs = reactContext.getSharedPreferences(
      DataWidgetProvider.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    val root = try {
      JSONObject(payloadsJson ?: "{}")
    } catch (_: Exception) {
      JSONObject()
    }

    val keyMap = mapOf(
      "qualifyingTotals" to DataWidgetProvider.KEY_QUALIFYING,
      "standards" to DataWidgetProvider.KEY_STANDARDS,
      "intlRankings" to DataWidgetProvider.KEY_INTL
    )

    val editor = prefs.edit()
    for ((payloadKey, prefKey) in keyMap) {
      val payload = root.optJSONObject(payloadKey)
      if (payload == null) {
        editor.remove(prefKey)
      } else {
        editor.putString(prefKey, payload.toString())
      }
    }
    editor.apply()

    DataWidgetProvider.updateAllWidgets(reactContext, QualifyingTotalsWidgetProvider::class.java)
    DataWidgetProvider.updateAllWidgets(reactContext, StandardsWidgetProvider::class.java)
    DataWidgetProvider.updateAllWidgets(reactContext, IntlRankingsWidgetProvider::class.java)
  }

  @ReactMethod
  fun clearSavedWidget() {
    val prefs = reactContext.getSharedPreferences(
      SavedWidgetProvider.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    prefs.edit()
      .remove(SavedWidgetProvider.KEY_SELECTED_MEET)
      .remove(SavedWidgetProvider.KEY_SESSIONS_JSON)
      .remove(DataWidgetProvider.KEY_QUALIFYING)
      .remove(DataWidgetProvider.KEY_STANDARDS)
      .remove(DataWidgetProvider.KEY_INTL)
      .apply()

    val appWidgetManager = AppWidgetManager.getInstance(reactContext)
    val componentName = ComponentName(reactContext, SavedWidgetProvider::class.java)
    val widgetIds = appWidgetManager.getAppWidgetIds(componentName)
    if (widgetIds.isNotEmpty()) {
      SavedWidgetProvider.updateAllWidgets(reactContext)
    }

    DataWidgetProvider.updateAllWidgets(reactContext, QualifyingTotalsWidgetProvider::class.java)
    DataWidgetProvider.updateAllWidgets(reactContext, StandardsWidgetProvider::class.java)
    DataWidgetProvider.updateAllWidgets(reactContext, IntlRankingsWidgetProvider::class.java)
  }
}
