package com.memohnsen.meetcal

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject

class MeetCalSmallWidgetProvider : AppWidgetProvider() {

    override fun onUpdate(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetIds: IntArray
    ) {
        for (appWidgetId in appWidgetIds) {
            updateAppWidget(context, appWidgetManager, appWidgetId)
        }
    }

    private fun updateAppWidget(
        context: Context,
        appWidgetManager: AppWidgetManager,
        appWidgetId: Int
    ) {
        val views = RemoteViews(context.packageName, R.layout.meetcal_small_widget)
        
        // Load data from SharedPreferences
        val prefs = context.getSharedPreferences("group.com.memohnsen.meetcal.widgets", Context.MODE_PRIVATE)
        val selectedMeet = prefs.getString("selected_meet", null)
        
        // Update the widget UI
        if (selectedMeet != null) {
            views.setTextViewText(R.id.selected_meet, selectedMeet)
        } else {
            views.setTextViewText(R.id.selected_meet, "Tap to select meet")
        }
        
        // Set up click intent to open app for meet selection
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("meetcal://select-meet")
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        
        val pendingIntent = PendingIntent.getActivity(
            context,
            appWidgetId,
            intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        )
        
        views.setOnClickPendingIntent(R.id.widget_container, pendingIntent)
        
        appWidgetManager.updateAppWidget(appWidgetId, views)
    }

    companion object {
        fun updateWidgets(context: Context) {
            val intent = Intent(context, MeetCalSmallWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            }
            context.sendBroadcast(intent)
        }
    }
}