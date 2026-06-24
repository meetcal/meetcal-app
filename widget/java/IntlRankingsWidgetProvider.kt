package __PACKAGE_NAME__.widget

class IntlRankingsWidgetProvider : DataWidgetProvider() {
  override val prefsKey = KEY_INTL
  override val iconRes = android.R.drawable.ic_menu_compass
  override val fallbackTitle = "International Rankings"
  override val fallbackSubtitle = "Open MeetCal to choose filters"
  override val fallbackEmpty = "No rankings"
}
