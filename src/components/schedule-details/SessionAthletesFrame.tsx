import { sessionAthletesStyles as styles } from "@/components/schedule-details/sessionAthletesStyles";
import { ThemedText } from "@/components/ui/ThemedText";
import type { AppColors } from "@/hooks/useAppColors";
import React, { type ReactNode } from "react";
import { View } from "react-native";

export function SessionAthletesFrame({
  colors,
  sortControl,
  children,
}: {
  colors: AppColors;
  sortControl?: ReactNode;
  children: ReactNode;
}) {
  const title = <ThemedText style={styles.athletesTitle}>Session Athletes</ThemedText>;
  return (
    <View>
      <View style={[styles.card, { backgroundColor: colors.card }]}>
        <View style={[styles.titleSection, { borderBottomColor: colors.border }]}>
          {sortControl ? (
            <View style={styles.titleRow}>
              {title}
              {sortControl}
            </View>
          ) : (
            title
          )}
        </View>
        {children}
      </View>
    </View>
  );
}
