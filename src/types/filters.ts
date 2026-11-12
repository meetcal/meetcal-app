import type React from "react";

export interface FilterOption {
  value: string;
  label: string;
  icon?: string;
  iconColor?: string;
  /** Heading listed above this option and the ones after it that share it. */
  group?: string;
}

export interface FilterSection {
  id: string;
  title: string;
  options: FilterOption[];
  allOptionLabel?: string;
  customContent?:
    | React.ReactNode
    | ((context: {
        tempFilters: Record<string, string>;
        setTempFilters: React.Dispatch<
          React.SetStateAction<Record<string, string>>
        >;
        collapseSection: () => void;
      }) => React.ReactNode);
  displayMode?: "chips" | "accordion";
  dependsOn?: string[];
}
