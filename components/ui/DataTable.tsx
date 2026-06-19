import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import React from "react";
import { ScrollView, StyleSheet, View } from "react-native";

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
}

function DataTableRow<T>({
  item,
  index,
  renderRow,
}: {
  item: T;
  index: number;
  renderRow: (item: T, index: number) => React.ReactNode;
}) {
  return <>{renderRow(item, index)}</>;
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
}: DataTableProps<T>) {
  const colors = useAppColors();

  return (
    <ScrollView
      style={styles.scrollView}
      testID={testID}
      contentContainerStyle={styles.scrollContent}
      contentInsetAdjustmentBehavior="automatic"
      {...scrollViewProps}
    >
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={[styles.headerRow, { borderBottomColor: colors.border }]}>
          {columns.map((col, i) => (
            <ThemedText
              key={col.label + i}
              style={[
                styles.headerCell,
                col.flex != null ? { flex: col.flex } : undefined,
                col.width != null
                  ? { width: col.width, flex: 0 }
                  : undefined,
                col.headerStyle,
              ]}
            >
              {col.label}
            </ThemedText>
          ))}
        </View>

        {loading &&
          (loadingContent || (
            <ThemedText style={styles.loadingText}>Loading...</ThemedText>
          ))}

        {error && !loading && (
          <ThemedText style={[styles.errorText, { color: colors.fail }]}>{error}</ThemedText>
        )}

        {!loading && !error && data.length === 0 && (
          <ThemedText
            style={[styles.emptyText, { color: colors.secondaryText }]}
          >
            {emptyMessage}
          </ThemedText>
        )}

        {!loading &&
          !error &&
          data.length > 0 &&
          data.map((item, index) => (
            <DataTableRow
              key={keyExtractor(item, index)}
              item={item}
              index={index}
              renderRow={renderRow}
            />
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
  card: {
    borderRadius: 12,
    overflow: "hidden",
    shadowColor: "#000",
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
    backgroundColor: "rgba(60, 60, 67, 0.03)",
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
