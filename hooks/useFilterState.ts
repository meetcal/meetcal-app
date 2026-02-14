import { useState, useCallback } from "react";

interface UseFilterStateOptions<T> {
  defaultFilters: T;
  onReset?: () => T;
}

export function useFilterState<T>(options: UseFilterStateOptions<T>) {
  const { defaultFilters, onReset } = options;
  const [filters, setFilters] = useState<T>(defaultFilters);
  const [tempFilters, setTempFilters] = useState<T>(defaultFilters);
  const [showFilterModal, setShowFilterModal] = useState(false);

  const openFilters = useCallback(() => {
    setTempFilters(filters);
    setShowFilterModal(true);
  }, [filters]);

  const applyFilters = useCallback((newFilters: Record<string, string>) => {
    const updated = newFilters as unknown as T;
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
      onClose: () => setShowFilterModal(false),
      filters: tempFilters as unknown as Record<string, string>,
      onApplyFilters: applyFilters,
      onResetFilters: resetFilters,
    },
  };
}
