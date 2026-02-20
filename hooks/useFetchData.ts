import { useEffect, useRef, useState } from "react";

interface UseFetchDataResult<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

export function useFetchData<T>(
  fetchFn: () => Promise<T>,
  initialData: T,
  deps: React.DependencyList = [],
): UseFetchDataResult<T> {
  const [data, setData] = useState<T>(initialData);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const fetchFnRef = useRef(fetchFn);
  fetchFnRef.current = fetchFn;

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchFnRef
      .current()
      .then((result) => {
        if (!cancelled) {
          setData(result);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err?.message || "An error occurred");
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
