package com.memohnsen.meetcal

import android.app.PendingIntent
import android.appwidget.AppWidgetManager
import android.appwidget.AppWidgetProvider
import android.content.Context
import android.content.Intent
import android.graphics.Color
import android.net.Uri
import android.view.View
import android.widget.RemoteViews
import org.json.JSONArray
import org.json.JSONObject
import java.text.SimpleDateFormat
import java.util.*

class MeetCalMediumWidgetProvider : AppWidgetProvider() {

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
        val views = RemoteViews(context.packageName, R.layout.meetcal_medium_widget)
        
        // Load data from SharedPreferences
        val prefs = context.getSharedPreferences("group.com.memohnsen.meetcal.widgets", Context.MODE_PRIVATE)
        val selectedMeet = prefs.getString("selected_meet", null)
        val savedSessionsJson = prefs.getString("saved_sessions", null)
        
        // Update selected meet
        if (selectedMeet != null) {
            views.setTextViewText(R.id.selected_meet, selectedMeet)
        } else {
            views.setTextViewText(R.id.selected_meet, "No meet selected")
        }
        
        // Clear existing sessions
        views.removeAllViews(R.id.sessions_container)
        
        // Load and filter saved sessions
        val upcomingSessions = getUpcomingSessions(savedSessionsJson, selectedMeet)
        
        if (upcomingSessions.isEmpty()) {
            // Show "no sessions" message
            val noSessionsView = RemoteViews(context.packageName, android.R.layout.simple_list_item_1)
            noSessionsView.setTextViewText(android.R.id.text1, "No saved sessions")
            noSessionsView.setTextColor(android.R.id.text1, Color.parseColor("#AAAAAA"))
            views.addView(R.id.sessions_container, noSessionsView)
        } else {
            // Add session rows (max 3)
            for (i in 0 until minOf(upcomingSessions.size, 3)) {
                val session = upcomingSessions[i]
                val sessionView = createSessionRowView(context, session)
                views.addView(R.id.sessions_container, sessionView)
            }
            
            // Add "more" indicator if needed
            if (upcomingSessions.size > 3) {
                val moreView = RemoteViews(context.packageName, android.R.layout.simple_list_item_1)
                moreView.setTextViewText(android.R.id.text1, "+ ${upcomingSessions.size - 3} more")
                moreView.setTextColor(android.R.id.text1, Color.parseColor("#AAAAAA"))
                views.addView(R.id.sessions_container, moreView)
            }
        }
        
        // Set up click intent to open saved sessions
        val intent = Intent(Intent.ACTION_VIEW).apply {
            data = Uri.parse("meetcal://saved-sessions")
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

    private fun getUpcomingSessions(savedSessionsJson: String?, selectedMeet: String?): List<JSONObject> {
        if (savedSessionsJson == null || selectedMeet == null) return emptyList()
        
        try {
            val sessions = JSONArray(savedSessionsJson)
            val upcomingSessions = mutableListOf<JSONObject>()
            val currentDate = Calendar.getInstance().time
            val dateFormat = SimpleDateFormat("yyyy-MM-dd", Locale.getDefault())
            
            for (i in 0 until sessions.length()) {
                val session = sessions.getJSONObject(i)
                val meetName = session.getString("meet")
                val sessionDateStr = session.getString("date")
                
                if (meetName == selectedMeet) {
                    try {
                        val sessionDate = dateFormat.parse(sessionDateStr)
                        if (sessionDate != null && sessionDate >= currentDate) {
                            upcomingSessions.add(session)
                        }
                    } catch (e: Exception) {
                        // Skip sessions with invalid dates
                    }
                }
            }
            
            // Sort by date
            upcomingSessions.sortWith { session1, session2 ->
                try {
                    val date1 = dateFormat.parse(session1.getString("date"))
                    val date2 = dateFormat.parse(session2.getString("date"))
                    date1?.compareTo(date2) ?: 0
                } catch (e: Exception) {
                    0
                }
            }
            
            return upcomingSessions
        } catch (e: Exception) {
            return emptyList()
        }
    }

    private fun createSessionRowView(context: Context, session: JSONObject): RemoteViews {
        val sessionView = RemoteViews(context.packageName, R.layout.session_row_item)
        
        try {
            val sessionNumber = session.getInt("sessionNumber")
            val platform = session.getString("platform")
            val weightClass = session.getString("weightClass")
            val startTime = session.getString("startTime")
            
            sessionView.setTextViewText(R.id.session_number, "Session $sessionNumber")
            sessionView.setTextViewText(R.id.platform_name, platform)
            sessionView.setTextViewText(R.id.weight_class, weightClass)
            sessionView.setTextViewText(R.id.start_time, startTime)
            
            // Set platform color
            val platformColor = getPlatformColor(platform)
            sessionView.setInt(R.id.platform_indicator, "setBackgroundColor", platformColor)
            sessionView.setTextColor(R.id.platform_name, platformColor)
            
        } catch (e: Exception) {
            // Handle error gracefully
        }
        
        return sessionView
    }

    private fun getPlatformColor(platform: String): Int {
        return when (platform.lowercase()) {
            "red" -> Color.parseColor("#FF0000")
            "white" -> Color.parseColor("#CCCCCC")
            "blue" -> Color.parseColor("#007AFF")
            "stars" -> Color.parseColor("#9900CC")
            "stripes" -> Color.parseColor("#FF9500")
            "rogue" -> Color.parseColor("#00CC00")
            else -> Color.parseColor("#CCCCCC")
        }
    }

    companion object {
        fun updateWidgets(context: Context) {
            val intent = Intent(context, MeetCalMediumWidgetProvider::class.java).apply {
                action = AppWidgetManager.ACTION_APPWIDGET_UPDATE
            }
            context.sendBroadcast(intent)
        }
    }
}