export interface PillFilterOption {
  value: string;
  label: string;
}

export interface PillFilterConfig {
  /** Unique id, matches the filter key */
  id: string;
  /** Label shown on the pill when no value is selected */
  label: string;
  /** Currently selected value ("" means no selection) */
  value: string;
  /** Options shown in the dropdown menu */
  options: PillFilterOption[];
  /** Label for the "clear"/all option at the top of the menu */
  allOptionLabel?: string;
  /**
   * When provided, tapping the pill calls this handler instead of opening the
   * inline dropdown (used for Club which needs a searchable popup).
   */
  onPress?: () => void;
}

export interface FilterPillBarProps {
  configs: PillFilterConfig[];
  onSelect: (id: string, value: string) => void;
  hasActiveFilters?: boolean;
  onReset?: () => void;
}
