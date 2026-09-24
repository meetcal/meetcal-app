import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { FlashList } from "@shopify/flash-list";
import React, { useCallback } from "react";
import { ScrollView, StyleSheet, View } from "react-native";
import { Palette } from "@/constants/Palette";

export interface DataTableColumn {
  label: string;
  flex?: number;
  width?: number | string;
  headerStyle?: object;
}

interface DataTableProps<T> {
  columns: DataTableColumn[];
  data: T[];
  renderRow: (item: T, index: number) => React.ReactNode;
  keyExtractor: (item: T, index: number) => string;
  loading?: boolean;
  error?: string | null;
  emptyMessage?: string;
  loadingContent?: React.ReactNode;
  scrollViewProps?: object;
  testID?: string;
  /**
   * Render rows through a virtualized list instead of mounting every row.
   *
   * Opt-in, because most comp-data tables are a fixed ~8-10 weight-class rows
   * where the list machinery costs more than the mount it saves. Turn it on
   * only where the row count is driven by how many athletes exist: a single
   * national-rankings weight class is 732 rows today (Open Men's 88kg), and
   * the plain `data.map()` path mounts all of them — roughly four native
   * views each — in one synchronous pass.
   */
  virtualized?: boolean;
}

export function DataTable<T>({
  columns,
  data,
  renderRow,
  keyExtractor,
  loading,
  error,
  emptyMessage = "No data available.",
  loadingContent,
  scrollViewProps,
  testID = "data-table",
  virtualized = false,
}: DataTableProps<T>) {
  const colors = useAppColors();
  const hasRows = !loading && !error && data.length > 0;

  // FlashList recycles cells and memoises them on `item` and `extraData`. A
  // row's colours come from the caller's `renderRow` closure, so the theme
  // has to be part of what the list compares or a light/dark flip leaves the
  // recycled, off-screen cells painted in the old palette. `useAppColors`
  // returns the palette object for the active scheme, so its identity is the
  // theme.
  const renderItem = useCallback(
    ({ item, index }: { item: T; index: number }) => (
      <>{renderRow(item, index)}</>
    ),
    [renderRow],
  );

  const header = (
    <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
      {columns.map((col, i) => (
        <ThemedText
          key={col.label + i}
          style={[
            styles.headerCell,
            col.flex != null ? { flex: col.flex } : undefined,
            col.width != null ? { width: col.width, flex: 0 } : undefined,
            col.headerStyle,
          ]}
        >
          {col.label}
        </ThemedText>
      ))}
    </View>
  );

  const status = (
    <>
      {loading &&
        (loadingContent || (
          <ThemedText style={styles.loadingText}>Loading...</ThemedText>
        ))}

      {error && !loading && (
        <ThemedText style={[styles.errorText, { color: colors.fail }]}>
          {error}
        </ThemedText>
      )}

      {!loading && !error && data.length === 0 && (
        <ThemedText style={[styles.emptyText, { color: colors.secondaryText }]}>
          {emptyMessage}
        </ThemedText>
      )}
    </>
  );

  if (virtualized) {
    return (
      <View
        style={[styles.scrollView, styles.scrollContent]}
        testID={testID}
      >
        <View
          style={[
            styles.card,
            hasRows ? styles.cardFill : undefined,
            { backgroundColor: colors.card },
          ]}
        >
          {header}
          {status}
          {hasRows ? (
            <FlashList
              data={data}
              keyExtractor={keyExtractor}
              renderItem={renderItem}
              extraData={colors}
              contentInsetAdjustmentBehavior="automatic"
              {...scrollViewProps}
            />
          ) : null}
        </View>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.scrollView}
      testID={testID}
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      {...scrollViewProps}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        {header}
        {status}

        {hasRows &&
          data.map((item, index) => (
            <React.Fragment key={keyExtractor(item, index)}>
              {renderRow(item, index)}
            </React.Fragment>
          ))}
      </View>
    </ScrollView>
  );
}

/* eslint-disable react-native/no-unused-styles */
export const dataTableStyles = StyleSheet.create({
  row: {
    flexDirection: "row" as const,
    padding: 16,
  },
  cell: {
    flex: 1,
    fontSize: 17,
  },
});
/* eslint-enable react-native/no-unused-styles */

const styles = StyleSheet.create({
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    padding: 16,
  },
  cardFill: {
    flex: 1,
  },
  card: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: Palette.shadow,
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  headerRow: {
    flexDirection: "row",
    padding: 16,
    borderBottomWidth: StyleSheet.hairlineWidth,
    backgroundColor: Palette.tableHeaderTint,
  },
  headerCell: {
    flex: 1,
    fontSize: 15,
    fontWeight: "600",
  },
  loadingText: {
    textAlign: "center",
    marginTop: 16,
    marginBottom: 16,
  },
  errorText: {
    textAlign: "center",
    marginTop: 16,
    marginBottom: 16,
  },
  emptyText: {
    textAlign: "center",
    marginTop: 16,
    marginBottom: 16,
  },
});
