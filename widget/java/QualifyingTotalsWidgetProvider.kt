package __PACKAGE_NAME__.widget

class QualifyingTotalsWidgetProvider : DataWidgetProvider() {
  override val prefsKey = KEY_QUALIFYING
  override val iconRes = android.R.drawable.ic_menu_sort_by_size
  override val fallbackTitle = "Qualifying Totals"
  override val fallbackSubtitle = "Open MeetCal to choose filters"
  override val fallbackEmpty = "No qualifying totals"
}
