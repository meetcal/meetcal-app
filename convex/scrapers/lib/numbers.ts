// Numbers as the Python scrapers read them, shared by the parsers that port
// them: Python's `float(s)` grammar (no "1,000", no "NaN" or "inf"), the
// surrounding whitespace it ignores allowed.

const PY_FLOAT = /^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/;

/** Python's `float(s)`, or null where that raises. */
export function pyFloat(text: string): number | null {
  const trimmed = text.trim();
  return PY_FLOAT.test(trimmed) ? Number(trimmed) : null;
}

/** Python's `int(float(s))`, or null where that raises (a float too large for an int too). */
export function pyInt(text: string): number | null {
  const value = pyFloat(text);
  return value !== null && Number.isFinite(value) ? Math.trunc(value) : null;
}
