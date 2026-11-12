package __PACKAGE_NAME__.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.facebook.react.bridge.Arguments
import com.facebook.react.bridge.Promise
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

  // The app's last known premium entitlement, next to the data widget payloads.
  // Mirrors the iOS App Group key the App Intents read; Android has no Siri
  // surface and no widget reads it (the data widgets get "subscribe" payloads
  // from JS), so this only keeps the contract the same on both platforms.
  @ReactMethod
  fun updateEntitlementHint(isSubscribed: Boolean) {
    reactContext.getSharedPreferences(DataWidgetProvider.PREFS_NAME, Context.MODE_PRIVATE)
      .edit()
      .putBoolean(DataWidgetProvider.KEY_ENTITLEMENT_HINT, isSubscribed)
      .apply()
  }

  @ReactMethod
  fun installedWidgetKinds(promise: Promise) {
    val appWidgetManager = AppWidgetManager.getInstance(reactContext)
    val providers = listOf(
      "SavedWidget" to SavedWidgetProvider::class.java,
      "QualifyingTotalsWidget" to QualifyingTotalsWidgetProvider::class.java,
      "StandardsWidget" to StandardsWidgetProvider::class.java,
      "InternationalRankingsWidget" to IntlRankingsWidgetProvider::class.java
    )
    val kinds = Arguments.createArray()
    for ((kind, provider) in providers) {
      if (appWidgetManager.getAppWidgetIds(ComponentName(reactContext, provider)).isNotEmpty()) {
        kinds.pushString(kind)
      }
    }
    promise.resolve(kinds)
  }

  // Clears only the saved-sessions widget (the signed-in user's data). The data
  // widget payloads are public reference data, need no sign-in, and are only
  // rewritten when the app refreshes them, so sign-out leaves them in place.
  @ReactMethod
  fun clearSavedWidget() {
    val prefs = reactContext.getSharedPreferences(
      SavedWidgetProvider.PREFS_NAME,
      Context.MODE_PRIVATE
    )
    prefs.edit()
      .remove(SavedWidgetProvider.KEY_SELECTED_MEET)
      .remove(SavedWidgetProvider.KEY_SESSIONS_JSON)
      .apply()

    val appWidgetManager = AppWidgetManager.getInstance(reactContext)
    val componentName = ComponentName(reactContext, SavedWidgetProvider::class.java)
    val widgetIds = appWidgetManager.getAppWidgetIds(componentName)
    if (widgetIds.isNotEmpty()) {
      SavedWidgetProvider.updateAllWidgets(reactContext)
    }
  }
}
