package com.memohnsen.meetcal.widget

import android.appwidget.AppWidgetManager
import android.content.ComponentName
import android.content.Context
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

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
