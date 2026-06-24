package __PACKAGE_NAME__.widget

import __PACKAGE_NAME__.R

class StandardsWidgetProvider : DataWidgetProvider() {
  override val prefsKey = KEY_STANDARDS
  override val iconRes = android.R.drawable.ic_menu_agenda
  override val fallbackTitle = "A/B Standards"
  override val fallbackSubtitle = "Open MeetCal to choose filters"
  override val fallbackEmpty = "No standards"
  override val layoutRes = R.layout.widget_standards_large
}
