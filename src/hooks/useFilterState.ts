import { useState, useCallback } from "react";

interface UseFilterStateOptions<T extends Record<string, string>> {
  defaultFilters: T;
  onReset?: () => T;
  /**
   * When this changes, the filters go back to `defaultFilters`. A screen
   * whose defaults come from route params (a widget's link) passes a key for
   * them: a link to the screen already on top reuses it and only swaps its
   * params, so without this the screen kept the filters it had and ignored
   * the widget's (`useRouteFilterKey`).
   */
  resetKey?: string;
}

export function useFilterState<T extends Record<string, string>>(
  options: UseFilterStateOptions<T>,
) {
  const { defaultFilters, onReset, resetKey } = options;
  const [filters, setFilters] = useState<T>(defaultFilters);
  const [tempFilters, setTempFilters] = useState<T>(defaultFilters);
  const [showFilterModal, setShowFilterModal] = useState(false);
  // Adjusted during render (React's "reset state when a prop changes"
  // pattern), so the screen never renders one frame of the old filters.
  const [appliedResetKey, setAppliedResetKey] = useState(resetKey);
  if (resetKey !== appliedResetKey) {
    setAppliedResetKey(resetKey);
    setFilters(defaultFilters);
    setTempFilters(defaultFilters);
    // An open filter sheet holds its own draft of the old filters, and
    // Apply would put them back: close it, so the link's filters stand.
    setShowFilterModal(false);
  }

  const openFilters = useCallback(() => {
    setTempFilters(filters);
    setShowFilterModal(true);
  }, [filters]);

  const closeFilterModal = useCallback(() => {
    setShowFilterModal(false);
  }, []);

  const applyFilters = useCallback((newFilters: Record<string, string>) => {
    const updated = newFilters as T;
    setFilters(updated);
    setTempFilters(updated);
    setShowFilterModal(false);
  }, []);

  const resetFilters = useCallback(() => {
    const resetValues = onReset ? onReset() : defaultFilters;
    setFilters(resetValues);
    setTempFilters(resetValues);
  }, [onReset, defaultFilters]);

  return {
    filters,
    setFilters,
    tempFilters,
    setTempFilters,
    showFilterModal,
    openFilters,
    applyFilters,
    resetFilters,
    filterModalProps: {
      visible: showFilterModal,
      onClose: closeFilterModal,
      filters: tempFilters as Record<string, string>,
      onApplyFilters: applyFilters,
      onResetFilters: resetFilters,
    },
  };
}
