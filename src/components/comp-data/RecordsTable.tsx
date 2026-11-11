import { DataTable, dataTableStyles } from "@/components/ui/DataTable";
import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { formatReferenceKg } from "@/lib/reference-values";
import type { WeightClassRecord } from "@/types/records";
import React from "react";
import { StyleSheet, View } from "react-native";

const RECORD_COLUMNS = [
  { label: "Weight Class", flex: 2 },
  { label: "Snatch" },
  { label: "C&J" },
  { label: "Total" },
];

type RecordsTableProps = {
  records: WeightClassRecord[];
  rowKeyPrefix: string;
  weightClassUnit?: string;
  loading: boolean;
  error?: string | null;
  emptyMessage: string;
};

export function RecordsTable({
  records,
  rowKeyPrefix,
  weightClassUnit = "",
  loading,
  error,
  emptyMessage,
}: RecordsTableProps) {
  const colors = useAppColors();
  return (
    <DataTable
      columns={RECORD_COLUMNS}
      data={records}
      keyExtractor={(record, index) => `${rowKeyPrefix}-${record.weightClass}-${index}`}
      loading={loading}
      error={error}
      emptyMessage={emptyMessage}
      renderRow={(record, index) => (
        <View
          style={[
            dataTableStyles.row,
            index < records.length - 1 && {
              borderBottomWidth: StyleSheet.hairlineWidth,
              borderBottomColor: colors.border,
            },
          ]}
        >
          <ThemedText style={[dataTableStyles.cell, { flex: 2 }]}>
            {`${record.weightClass}${weightClassUnit}`}
          </ThemedText>
          <ThemedText style={dataTableStyles.cell}>
            {formatReferenceKg(record.snatchRecord)}
          </ThemedText>
          <ThemedText style={dataTableStyles.cell}>
            {formatReferenceKg(record.cjRecord)}
          </ThemedText>
          <ThemedText style={dataTableStyles.cell}>
            {formatReferenceKg(record.totalRecord)}
          </ThemedText>
        </View>
      )}
    />
  );
}
