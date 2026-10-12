import { useCallback, useState } from "react";

import {
  applyStartListPillSelection,
  DEFAULT_START_LIST_FILTERS,
  type StartListFilters,
} from "@/lib/start-list-utils";

type FiltersState = { meet: string | null; filters: StartListFilters };

/**
 * The Start List's search and filter pills, scoped to the selected meet.
 *
 * These were eight `useState`s in the screen and nothing cleared them when
 * the selected meet changed, so a club or weight class picked at one meet
 * filtered the next meet's roster too, usually down to "No athletes match
 * your filters". The filters are stored with the meet they belong to and
 * reset during the render that sees a different meet (React's "adjust state
 * on prop change" pattern), so no frame ever filters a roster with another
 * meet's pills, and going back to a meet starts it clean as well.
 */
export function useStartListFilters(meet: string | null) {
  const [state, setState] = useState<FiltersState>(() => ({
    meet,
    filters: DEFAULT_START_LIST_FILTERS,
  }));
  if (state.meet !== meet) {
    setState({ meet, filters: DEFAULT_START_LIST_FILTERS });
  }
  const filters =
    state.meet === meet ? state.filters : DEFAULT_START_LIST_FILTERS;

  const update = useCallback(
    (next: (current: StartListFilters) => StartListFilters) => {
      setState((previous) => ({
        meet: previous.meet,
        filters: next(previous.filters),
      }));
    },
    [],
  );

  const selectPill = useCallback(
    (id: string, value: string) =>
      update((current) => applyStartListPillSelection(current, id, value)),
    [update],
  );
  const setClub = useCallback(
    (club: string) => update((current) => ({ ...current, club })),
    [update],
  );
  const setSearch = useCallback(
    (search: string) => update((current) => ({ ...current, search })),
    [update],
  );
  const resetFilters = useCallback(
    () => update(() => DEFAULT_START_LIST_FILTERS),
    [update],
  );

  return { filters, selectPill, setClub, setSearch, resetFilters };
}
