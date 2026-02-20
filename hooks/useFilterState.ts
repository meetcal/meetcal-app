import { useState, useCallback } from "react";

interface UseFilterStateOptions<T extends Record<string, string>> {
  defaultFilters: T;
  onReset?: () => T;
}

export function useFilterState<T extends Record<string, string>>(
  options: UseFilterStateOptions<T>,
) {
  const { defaultFilters, onReset } = options;
  const [filters, setFilters] = useState<T>(defaultFilters);
  const [tempFilters, setTempFilters] = useState<T>(defaultFilters);
  const [showFilterModal, setShowFilterModal] = useState(false);

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
